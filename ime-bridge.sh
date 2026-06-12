#!/bin/bash
#
# IME Bridge - Default input injection script
# Sends text to the active window via clipboard + paste simulation.

set -euo pipefail

USER_INPUT="${1-}"
[ -z "$USER_INPUT" ] && exit 0

notify() {
    notify-send "输入法桥接" "$1"
}

# ── 1. Find xclip ────────────────────────────────────────────────
# GJS subprocess inherits gnome-shell's restricted PATH, so brew,
# the user-level installs won't be found by `command -v`. Check extra paths.
XCLIP_BIN="$(command -v xclip || true)"
if [ -z "$XCLIP_BIN" ]; then
    # Linuxbrew is common on immutable distros; gnome-shell's PATH won't cover it
    for _bin in \
        "/home/linuxbrew/.linuxbrew/bin/xclip" \
        "$HOME/.linuxbrew/bin/xclip"; do
        if [ -x "$_bin" ]; then
            XCLIP_BIN="$_bin"
            break
        fi
    done
fi

if [ -z "$XCLIP_BIN" ]; then
    notify "未找到 xclip。请先安装 xclip（sudo dnf/apt/pacman install xclip 或 brew install xclip）"
    exit 1
fi

# ── 2. Detect target X display ───────────────────────────────────
GAMESCOPE_DISPLAY=""

# Gamescope has its own Xwayland instance; try that first
while IFS= read -r xw_pid; do
    [ -z "$xw_pid" ] && continue

    ppid="$(ps -o ppid= -p "$xw_pid" 2>/dev/null | tr -d ' ')"
    [ -z "$ppid" ] && continue

    p_args="$(ps -o args= -p "$ppid" 2>/dev/null || true)"
    if echo "$p_args" | grep -iq "gamescope"; then
        xw_args="$(ps -o args= -p "$xw_pid" 2>/dev/null || true)"
        DISP="$(echo "$xw_args" | grep -oE '(^|[[:space:]]):[0-9]+' | tr -d ' ' || true)"
        if [ -n "$DISP" ]; then
            GAMESCOPE_DISPLAY="$DISP"
            break
        fi
    fi
done < <(pgrep Xwayland || true)

# Fallback: pick any non-":0" Xwayland
if [ -z "$GAMESCOPE_DISPLAY" ]; then
    while IFS= read -r xw_pid; do
        [ -z "$xw_pid" ] && continue

        xw_args="$(ps -o args= -p "$xw_pid" 2>/dev/null || true)"
        DISP="$(echo "$xw_args" | grep -oE '(^|[[:space:]]):[0-9]+' | tr -d ' ' || true)"
        if [ -n "$DISP" ] && [ "$DISP" != ":0" ]; then
            GAMESCOPE_DISPLAY="$DISP"
            break
        fi
    done < <(pgrep Xwayland || true)
fi

# Last resort: main display
[ -z "$GAMESCOPE_DISPLAY" ] && GAMESCOPE_DISPLAY=":0"

# ── 3. Write to clipboard ────────────────────────────────────────
if ! printf "%s" "$USER_INPUT" | DISPLAY="$GAMESCOPE_DISPLAY" "$XCLIP_BIN" -selection clipboard 2>/dev/null; then
    notify "无法写入剪贴板 (DISPLAY=$GAMESCOPE_DISPLAY)，请检查 X 服务器状态"
    exit 1
fi

# ── 4. Simulate paste ────────────────────────────────────────────
# Brief wait for focus to return after dialog closes
sleep 0.05

# ydotool is expected to be installed system-wide (sudo dnf/apt/pacman install ydotool)
# and requires its daemon ydotoold to be running. Unlike xclip, we don't search
# alternative paths here — assume it's correctly installed on PATH.
if pgrep ydotoold > /dev/null; then
    # Left Ctrl (29) + V (47)
    ydotool key 29:1 47:1 47:0 29:0
else
    notify "ydotool 后台未运行，请手动在目标窗口内按 Ctrl+V 粘贴"
fi
