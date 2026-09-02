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
import {
  getInputSourceManager,
  INPUT_SOURCE_TYPE_IBUS,
} from "resource:///org/gnome/shell/ui/status/keyboard.js";

const SCRIPT_PATH_KEY = "script-path";
const OPEN_DIALOG_KEY = "open-dialog";
const IM_FRAMEWORK_KEY = "im-framework";

const FCITX5_DAEMON = "org.fcitx.Fcitx5";
const IBUS_DAEMON = "org.freedesktop.IBus";

/** Ask the session bus whether a D-Bus name is currently owned. */
function hasDbusName(name) {
  try {
    return Gio.DBus.session
      .call_sync(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        "org.freedesktop.DBus",
        "NameHasOwner",
        new GLib.Variant("(s)", [name]),
        new GLib.VariantType("(b)"),
        Gio.DBusCallFlags.NONE,
        500,
        null,
      )
      .deepUnpack()[0];
  } catch (e) {
    log(`[ime-bridge] Failed to check name owner of ${name}: ${e.message}`);
    return false;
  }
}

/**
 * Whether the session environment declares a given input method module.
 * GNOME (and the IM daemons themselves) export this through
 * GTK_IM_MODULE / QT_IM_MODULE / XMODIFIERS (e.g. `@im=ibus`).
 */
function envUses(framework) {
  const module = framework === "ibus" ? "ibus" : "fcitx";
  for (const key of ["GTK_IM_MODULE", "QT_IM_MODULE", "XMODIFIERS"]) {
    const value = GLib.getenv(key);
    if (value && value.includes(module))
      return true;
  }
  return false;
}

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

      if (!GLib.file_test(scriptPath, GLib.FileTest.EXISTS)) {
        Main.notify("输入法桥接", `脚本不存在：${scriptPath}`);
        this.close();
        return;
      }

      if (!GLib.file_test(scriptPath, GLib.FileTest.IS_REGULAR)) {
        Main.notify("输入法桥接", `脚本路径不是普通文件：${scriptPath}`);
        this.close();
        return;
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

    this._imFramework = null;
    this._previousFcitxIm = null;
    this._ibusPrevSourceId = null;
    this._ibusSwitched = false;

    log(`[ime-bridge] IM framework detected: ${this._detectImFramework()}`);
  }

  disable() {
    Main.wm.removeKeybinding(OPEN_DIALOG_KEY);

    // Restore the input source before tearing the dialog down, in case
    // the extension is disabled while the dialog is still open.
    if (this._dialog) {
      this._restoreInputSource();
      this._dialog.destroy();
      this._dialog = null;
    }

    this._settings = null;
  }

  /**
   * Figure out which input method framework is in use:
   *   1. explicit user choice from the settings;
   *   2. whatever daemon is running on the session bus
   *      (env vars break the tie when both are running);
   *   3. env vars alone (daemon may still be starting up).
   * Returns "fcitx5", "ibus" or "none".
   */
  _detectImFramework() {
    const override = this._settings.get_string(IM_FRAMEWORK_KEY);
    if (override === "fcitx5" || override === "ibus")
      return override;

    const fcitxRunning = hasDbusName(FCITX5_DAEMON);
    const ibusRunning = hasDbusName(IBUS_DAEMON);
    const fcitxEnv = envUses("fcitx5");
    const ibusEnv = envUses("ibus");

    if (fcitxRunning && !ibusRunning)
      return "fcitx5";
    if (ibusRunning && !fcitxRunning)
      return "ibus";
    if (fcitxRunning && ibusRunning) {
      // Both daemons alive: trust the environment, fall back to the
      // historically supported framework when it is ambiguous.
      if (fcitxEnv && !ibusEnv)
        return "fcitx5";
      if (ibusEnv && !fcitxEnv)
        return "ibus";
      return "fcitx5";
    }
    if (fcitxEnv)
      return "fcitx5";
    if (ibusEnv)
      return "ibus";
    return "none";
  }

  /**
   * Prepare the input method for the dialog.
   *
   * - Fcitx5 is switched right away, before the dialog steals focus
   *   (the switch is applied by Fcitx5 itself to the focused window).
   * - IBus engines are driven by GNOME Shell's input source manager,
   *   and Shell may re-apply its own source when the dialog window
   *   gains focus (per-window sources). Remember the state *now*, then
   *   do the actual switch once the dialog is fully open and focused.
   */
  _switchInputSource() {
    switch (this._imFramework) {
      case "fcitx5":
        this._switchFcitxToIme();
        break;
      case "ibus": {
        this._ibusSwitched = false;
        const current = getInputSourceManager().currentSource;
        this._ibusPrevSourceId = current ? current.id : null;
        this._dialog.connect("opened", () => this._switchIbusToIme());
        break;
      }
      default:
        log(`[ime-bridge] No supported IM framework found (${this._imFramework})`);
    }
  }

  _restoreInputSource() {
    switch (this._imFramework) {
      case "fcitx5":
        this._restoreFcitx();
        break;
      case "ibus":
        this._restoreIbus();
        break;
    }
    this._imFramework = null;
  }

  // ── Fcitx5 backend (driven directly over D-Bus) ────────────────

  _fcitxCall(method, replyType, signature, params) {
    return Gio.DBus.session.call_sync(
      FCITX5_DAEMON,
      "/controller",
      "org.fcitx.Fcitx.Controller1",
      method,
      params ? new GLib.Variant(signature, params) : null,
      replyType ? new GLib.VariantType(replyType) : null,
      Gio.DBusCallFlags.NONE,
      500,
      null,
    );
  }

  _switchFcitxToIme() {
    try {
      const curResult = this._fcitxCall("CurrentInputMethod", "(s)");
      const [currentIM] = curResult.deepUnpack();

      const imResult = this._fcitxCall(
        "AvailableInputMethods",
        "(a(sssssssb))",
      );

      const methods = imResult.deepUnpack()[0];
      const currentIsIME = methods.some(
        (m) => m[0] === currentIM && m[3] !== "input-keyboard",
      );

      if (currentIsIME) return;

      this._previousFcitxIm = currentIM;

      for (const m of methods) {
        const [id, _name, _label, icon] = m;
        if (icon === "input-keyboard") continue;

        this._fcitxCall("SetCurrentIM", null, "(s)", [id]);
        return;
      }
    } catch (e) {
      log(`[ime-bridge] Failed to switch IM: ${e.message}`);
    }
  }

  _restoreFcitx() {
    if (this._previousFcitxIm === null || this._previousFcitxIm === undefined)
      return;

    try {
      this._fcitxCall(
        "SetCurrentIM",
        null,
        "(s)",
        [this._previousFcitxIm],
      );
    } catch (e) {
      log(`[ime-bridge] Failed to restore IM: ${e.message}`);
    }

    this._previousFcitxIm = null;
  }

  // ── IBus backend (via GNOME Shell input sources) ───────────────

  _inputSources() {
    return Object.values(getInputSourceManager().inputSources);
  }

  _switchIbusToIme() {
    if (!this._dialog)
      return;

    const current = getInputSourceManager().currentSource;

    // Already typing with an IME: nothing to switch.
    if (current && current.type === INPUT_SOURCE_TYPE_IBUS)
      return;

    const sources = this._inputSources();
    const ime = sources.find((s) => s.type === INPUT_SOURCE_TYPE_IBUS);

    if (!ime) {
      log("[ime-bridge] No IBus input source configured in GNOME");
      return;
    }

    ime.activate(false);
    this._ibusSwitched = true;
  }

  _restoreIbus() {
    if (!this._ibusSwitched)
      return;

    this._ibusSwitched = false;
    const prevId = this._ibusPrevSourceId;
    this._ibusPrevSourceId = null;

    if (prevId === null || prevId === undefined)
      return;

    try {
      const prev = this._inputSources().find((s) => s.id === prevId);
      if (prev)
        prev.activate(false);
      else
        log(`[ime-bridge] Previous input source "${prevId}" no longer exists`);
    } catch (e) {
      log(`[ime-bridge] Failed to restore input source: ${e.message}`);
    }
  }

  // ── Dialog handling ────────────────────────────────────────────

  _openDialog() {
    if (this._dialog) {
      this._dialog.close();
      return;
    }

    this._imFramework = this._detectImFramework();
    this._dialog = new InputDialog(this);

    this._switchInputSource();

    this._dialog.connect("closed", () => {
      this._restoreInputSource();
      this._dialog?.destroy();
      this._dialog = null;
    });
    this._dialog.open();
  }
}
