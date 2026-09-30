#!/usr/bin/env bash
# 启动 Echo 折叠屏 Android AVD。
# 用法：scripts/run-foldable-avd.sh [pixel|resizable] [端口]
set -euo pipefail

ROOT="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-/usr/local/share/android-commandlinetools}}"
JAVA_HOME="${JAVA_HOME:-/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home}"
export ANDROID_HOME="$ROOT" ANDROID_SDK_ROOT="$ROOT" JAVA_HOME
export PATH="$JAVA_HOME/bin:$ROOT/cmdline-tools/latest/bin:$ROOT/platform-tools:$ROOT/emulator:$PATH"

kind="${1:-pixel}"
port="${2:-5556}"
case "$kind" in
  pixel) avd="echo_pixel_fold_api34" ;;
  resizable) avd="echo_resizable_api34" ;;
  *) echo "用法：$0 [pixel|resizable] [端口]" >&2; exit 2 ;;
esac

command -v emulator >/dev/null || { echo "缺少 emulator" >&2; exit 1; }
command -v adb >/dev/null || { echo "缺少 adb" >&2; exit 1; }
"$JAVA_HOME/bin/java" -version >/dev/null 2>&1 || { echo "Java 17 不可用：$JAVA_HOME" >&2; exit 1; }

# 只处理这个专用 AVD 的残留锁，不触碰其他 AVD。
avd_dir="$HOME/.android/avd/$avd.avd"
if pgrep -f -- "-avd[[:space:]]+$avd([[:space:]]|$)" >/dev/null 2>&1; then
  echo "已有 $avd 实例在运行；请使用已有实例，或先关闭它。" >&2
  exit 3
fi
for lock in "$avd_dir/hardware-qemu.ini.lock" "$avd_dir/multiinstance.lock"; do
  if [ -e "$lock" ]; then
    mv "$lock" "/tmp/$(basename "$lock").$avd.$$.stale"
  fi
done

mkdir -p /tmp/echo-fold-logs
log="/tmp/echo-fold-logs/$avd-$port.log"
nohup emulator -avd "$avd" -port "$port" -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -memory 2048 -no-snapshot-load \
  >"$log" 2>&1 &
pid=$!
echo "$pid" > "/tmp/echo-fold-logs/$avd-$port.pid"
serial="emulator-$port"

adb -s "$serial" wait-for-device
for _ in $(seq 1 120); do
  [ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break
  sleep 2
done
[ "$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] || {
  echo "AVD 启动超时：$log" >&2; exit 1;
}

adb -s "$serial" shell settings put secure show_ime_with_hard_keyboard 1
adb -s "$serial" shell ime list -s | grep -q . || { echo "Android IME 服务不可用" >&2; exit 1; }
if adb -s "$serial" shell dumpsys activity processes | grep -A20 'com.android.systemui/u0a' | grep -q 'mNotResponding=true'; then
  echo "SystemUI ANR，拒绝把该环境用于键盘结论：$log" >&2
  exit 4
fi

echo "AVD=$avd"
echo "SERIAL=$serial"
echo "LOG=$log"
adb -s "$serial" shell wm size
adb -s "$serial" shell wm density
adb -s "$serial" shell ime list -s
