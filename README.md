# IME Bridge
该扩展通过全局快捷键打开一个 GNOME Shell 输入框，收集输入并转发给一个自定义脚本。专门针对那些无法使用输入法的顽固场景。

扩展会在打开输入框前**自动检测系统上正在使用的输入框架**并切换到中文输入法（打开前对于 Fcitx5，打开完成时对于 IBus），输入框关闭后自动恢复之前的输入法/输入源：

- **Fcitx5**：通过 `org.fcitx.Fcitx5` D-Bus 接口直接切换
- **IBus**：通过 GNOME Shell 的输入源机制切换（会激活你在系统设置里配置的第一个 IBus 输入源）

检测顺序：设置中的手动指定 → 会话总线上正在运行的输入法守护进程（`org.fcitx.Fcitx5` / `org.freedesktop.IBus`，两者同时运行时参考 `GTK_IM_MODULE` / `QT_IM_MODULE` / `XMODIFIERS` 环境变量）→ 环境变量 → 无可用框架（此时不切换，直接打开输入框）。

如果不设置自定义脚本的话，该扩展也提供了一个默认脚本，用途是将输入粘贴到 gamescope 内的 X 剪切板（优先）或者其他 X 剪切板（次要）。脚本依赖 [xclip](https://github.com/astrand/xclip) 和 [ydotool](https://github.com/ReimuNotMoe/ydotool) 工作。

## 使用方法

1. 按下热键打开输入框，此时会切换到中文输入法
2. 输入文本，然后按下 `Alt` 提交（按 `Esc` 取消）
3. 文本将会作为第一个命令行参数传递给自定义脚本

## 安装

### 前置条件

- GNOME Shell 50（其他版本未测试）
- Fcitx5 或 IBus 已安装并正常运行

如果要使用扩展自带的脚本，还需要确保 xclip 和 ydotool 均已安装，且 ydotoold 正在运行

### 当前仅支持源码安装

```sh
git clone --depth 1 https://github.com/Yii6724XT/ime-bridge ~/.local/share/gnome-shell/extensions/ime-bridge@yii6724xt
```

安装完成之后注销，重新登录，并通过你的扩展管理器启用扩展。

## 配置

扩展自带了配置界面，可以设置触发热键、输入框架（默认「自动检测」，可手动指定 Fcitx5 或 IBus）和自定义脚本的路径（绝对路径）。提交键 `Alt` 不可更改。
