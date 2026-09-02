import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const SCRIPT_PATH_KEY = 'script-path';
const OPEN_DIALOG_KEY = 'open-dialog';
const IM_FRAMEWORK_KEY = 'im-framework';

const IM_FRAMEWORK_KEYS = ['auto', 'fcitx5', 'ibus'];
const IM_FRAMEWORK_LABELS = ['自动检测', 'Fcitx5', 'IBus'];

export default class ImeBridgePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const scriptEntry = new Gtk.Entry({
            hexpand: true,
            text: settings.get_string(SCRIPT_PATH_KEY),
            valign: Gtk.Align.CENTER,
        });
        scriptEntry.connect('changed', entry => {
            settings.set_string(SCRIPT_PATH_KEY, entry.get_text());
        });

        const scriptRow = new Adw.ActionRow({
            title: '脚本路径',
            subtitle: '输入桥接脚本的绝对路径',
        });
        scriptRow.add_suffix(scriptEntry);

        const frameworkModel = new Gtk.StringList();
        IM_FRAMEWORK_LABELS.forEach(label => frameworkModel.append(label));

        const frameworkRow = new Adw.ComboRow({
            title: '输入框架',
            subtitle: '自动检测系统上正在运行的输入框架，也可手动指定',
            model: frameworkModel,
        });
        const frameworkSelected = () => {
            const index = IM_FRAMEWORK_KEYS.indexOf(settings.get_string(IM_FRAMEWORK_KEY));
            return Math.max(0, index);
        };
        frameworkRow.selected = frameworkSelected();
        frameworkRow.connect('notify::selected', row => {
            settings.set_string(IM_FRAMEWORK_KEY, IM_FRAMEWORK_KEYS[row.selected]);
        });

        const shortcutRow = new Adw.ActionRow({
            title: '全局快捷键',
            subtitle: '点击右侧按钮后直接按下新快捷键，Esc 取消，BackSpace 清除',
        });
        shortcutRow.add_suffix(this._createShortcutButton(settings, OPEN_DIALOG_KEY));

        const group = new Adw.PreferencesGroup({
            title: 'IME Bridge',
        });
        group.add(scriptRow);
        group.add(frameworkRow);
        group.add(shortcutRow);

        const page = new Adw.PreferencesPage();
        page.add(group);

        window.set_default_size(640, 320);
        window.add(page);
    }

    _createShortcutButton(settings, key) {
        const button = new Gtk.Button({
            valign: Gtk.Align.CENTER,
        });

        const setLabelFromSettings = () => {
            const accel = settings.get_strv(key)[0] ?? '';
            if (!accel) {
                button.set_label('未设置');
                return;
            }
            const [ok, keyval, modifier] = Gtk.accelerator_parse(accel);
            button.set_label(ok ? Gtk.accelerator_get_label(keyval, modifier) : accel);
        };

        const startEditing = () => {
            button.set_label('按下快捷键...');
        };

        const stopEditing = () => {
            button._controller = null;
            setLabelFromSettings();
        };

        setLabelFromSettings();

        button.connect('clicked', () => {
            if (button._controller) {
                button.remove_controller(button._controller);
                stopEditing();
                return;
            }

            startEditing();

            const controller = new Gtk.EventControllerKey();
            button._controller = controller;
            button.add_controller(controller);

            let debounceTimeoutId = null;
            const connectId = controller.connect('key-pressed', (_ctrl, keyval, keycode, state) => {
                if (debounceTimeoutId)
                    clearTimeout(debounceTimeoutId);

                const mask = state & Gtk.accelerator_get_default_mod_mask();

                if (mask === 0) {
                    switch (keyval) {
                    case Gdk.KEY_Escape:
                        button.remove_controller(controller);
                        controller.disconnect(connectId);
                        stopEditing();
                        return Gdk.EVENT_STOP;
                    case Gdk.KEY_BackSpace:
                        settings.set_strv(key, []);
                        button.remove_controller(controller);
                        controller.disconnect(connectId);
                        stopEditing();
                        return Gdk.EVENT_STOP;
                    default:
                        return Gdk.EVENT_STOP;
                    }
                }

                const selectedShortcut = Gtk.accelerator_name_with_keycode(
                    null,
                    keyval,
                    keycode,
                    mask
                );

                debounceTimeoutId = setTimeout(() => {
                    settings.set_strv(key, [selectedShortcut]);
                    button.remove_controller(controller);
                    controller.disconnect(connectId);
                    stopEditing();
                }, 150);

                return Gdk.EVENT_STOP;
            });
        });

        return button;
    }
}
