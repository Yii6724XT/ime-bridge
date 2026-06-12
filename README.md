# IME Bridge
该扩展通过全局快捷键打开一个 GNOME Shell 输入框，收集输入并转发给一个自定义脚本。专门针对哪些无法使用输入法的顽固场景。

## 使用方法

1. 按下热键打开输入框，此时会切换到中文输入法
2. 输入文本，然后按下 `Alt` 提交（按 `Esc` 取消）
3. 文本将会作为第一个命令行参数传递给自定义脚本

## 安装

### 前置条件

- GNOME Shell 50（其他版本未测试）
- Fcitx5 已经安装并正常运行
- 不支持 iBus

### 当前仅支持源码安装

```sh
git clone --depth 1 https://github.com/Yii6724XT/ime-bridge ~/.local/share/gnome-shell/extensions/ime-bridge@yii6724xt
```

安装完成之后注销，重新登录，并通过你的扩展管理器启用扩展。

## 配置

扩展自带了配置界面，可以设置触发热键和自定义脚本的路径（绝对路径）。提交键 `Alt` 不可更改。
