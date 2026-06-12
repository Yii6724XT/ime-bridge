import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import GObject from "gi://GObject";
import Meta from "gi://Meta";
import Shell from "gi://Shell";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as ModalDialog from "resource:///org/gnome/shell/ui/modalDialog.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

const SCRIPT_PATH_KEY = "script-path";
const OPEN_DIALOG_KEY = "open-dialog";

const InputDialog = GObject.registerClass(
  class InputDialog extends ModalDialog.ModalDialog {
    _init(extension) {
      super._init({ styleClass: null });
      this._extension = extension;

      this._entry = new St.Entry({
        can_focus: true,
        hint_text: "请输入文本",
        style_class: "prompt-dialog-entry",
        width: 480,
        x_expand: true,
        y_expand: true,
      });

      const clutterText = this._entry.get_clutter_text();
      clutterText.single_line_mode = false;
      clutterText.line_wrap = true;

      this.contentLayout.add_child(
        new St.Label({
          text: "输入法桥接",
          style_class: "prompt-dialog-headline",
          x_align: Clutter.ActorAlign.START,
        }),
      );
      this.contentLayout.add_child(this._entry);

      clutterText.connect("key-press-event", (_actor, event) => {
        const keyval = event.get_key_symbol();

        if (keyval === Clutter.KEY_Escape) {
          this.close();
          return Clutter.EVENT_STOP;
        }

        if (keyval === Clutter.KEY_Alt_L || keyval === Clutter.KEY_Alt_R) {
          this._submit();
          return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
      });
    }

    open(...args) {
      const opened = super.open(...args);
      if (opened) this._entry.grab_key_focus();
      return opened;
    }

    _submit() {
      const text = this._entry.get_text().trim();
      if (!text) {
        this.close();
        return;
      }

      let scriptPath = this._extension
        .getSettings()
        .get_string(SCRIPT_PATH_KEY);
      if (!scriptPath) {
        scriptPath = `${this._extension.path}/ime-bridge.sh`;
      }

      let launcher;

      try {
        launcher = Gio.Subprocess.new(
          ["bash", scriptPath, text],
          Gio.SubprocessFlags.NONE,
        );
      } catch (error) {
        Main.notify("输入法桥接", error.message);
        this.close();
        return;
      }

      launcher.wait_check_async(null, (proc, res) => {
        try {
          proc.wait_check_finish(res);
        } catch (error) {
          Main.notify("输入法桥接", error.message);
        }
      });

      this.close();
    }
  },
);

export default class ImeBridgeExtension extends Extension {
  enable() {
    this._settings = this.getSettings();
    Main.wm.addKeybinding(
      OPEN_DIALOG_KEY,
      this._settings,
      Meta.KeyBindingFlags.NONE,
      Shell.ActionMode.ALL,
      () => this._openDialog(),
    );
  }

  disable() {
    Main.wm.removeKeybinding(OPEN_DIALOG_KEY);
    this._dialog?.destroy();
    this._dialog = null;
    this._settings = null;
  }

  _switchInputSource() {
    try {
      const curResult = Gio.DBus.session.call_sync(
        "org.fcitx.Fcitx5",
        "/controller",
        "org.fcitx.Fcitx.Controller1",
        "CurrentInputMethod",
        null,
        new GLib.VariantType("(s)"),
        Gio.DBusCallFlags.NONE,
        500,
        null,
      );
      const [currentIM] = curResult.deepUnpack();

      const imResult = Gio.DBus.session.call_sync(
        "org.fcitx.Fcitx5",
        "/controller",
        "org.fcitx.Fcitx.Controller1",
        "AvailableInputMethods",
        null,
        new GLib.VariantType("(a(ssssssb))"),
        Gio.DBusCallFlags.NONE,
        500,
        null,
      );

      const methods = imResult.deepUnpack()[0];
      const currentIsIME = methods.some(
        (m) => m[0] === currentIM && m[3] !== "input-keyboard",
      );

      if (currentIsIME) return;

      this._previousIM = currentIM;

      for (const m of methods) {
        const [id, _name, _label, icon, _code, _lang, _enabled] = m;
        if (icon === "input-keyboard") continue;

        Gio.DBus.session.call_sync(
          "org.fcitx.Fcitx5",
          "/controller",
          "org.fcitx.Fcitx.Controller1",
          "SetCurrentIM",
          new GLib.Variant("(s)", [id]),
          null,
          Gio.DBusCallFlags.NONE,
          500,
          null,
        );
        return;
      }
    } catch (e) {
      log(`[ime-bridge] Failed to switch IM: ${e.message}`);
    }
  }

  _restoreInputSource() {
    if (this._previousIM === null || this._previousIM === undefined) return;

    try {
      Gio.DBus.session.call_sync(
        "org.fcitx.Fcitx5",
        "/controller",
        "org.fcitx.Fcitx.Controller1",
        "SetCurrentIM",
        new GLib.Variant("(s)", [this._previousIM]),
        null,
        Gio.DBusCallFlags.NONE,
        500,
        null,
      );
    } catch (e) {
      log(`[ime-bridge] Failed to restore IM: ${e.message}`);
    }

    this._previousIM = null;
  }

  _openDialog() {
    if (this._dialog) {
      this._dialog.close();
      return;
    }

    this._switchInputSource();

    this._dialog = new InputDialog(this);
    this._dialog.connect("closed", () => {
      this._restoreInputSource();
      this._dialog?.destroy();
      this._dialog = null;
    });
    this._dialog.open();
  }
}
