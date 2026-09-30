#!/usr/bin/env python3
"""Echo Hall Android 折叠屏真 IME 探针。

前提：先运行 scripts/run-foldable-avd.sh pixel 5556。
通过设备端 Chrome CDP + adb 物理触摸验证：
- Echo 页面就绪、进入官方聊天室；
- 真实 textarea 获得焦点；
- Android IME 是否实际显示；
- visualViewport 是否缩高、输入框是否位于键盘顶端之上；
- fold / unfold / posture 之后页面是否仍可读。

注意：CDP element.focus() 不算真实 IME 验证，本脚本只在 adb 物理触摸后采集 IME 结论。
"""
import json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

SERIAL = os.environ.get("ANDROID_SERIAL", "emulator-5556")
CDP = os.environ.get("ECHO_CDP", "http://127.0.0.1:9223")
URL = os.environ.get("ECHO_URL", "https://slzcn.github.io/echo-hall/?kbdebug=1")
OUT = Path(os.environ.get("ECHO_FOLD_OUT", "/tmp/echo-fold-logs"))
ADB = ["adb", "-s", SERIAL]


def adb(*args, check=True):
    return subprocess.run(ADB + list(args), text=True, capture_output=True, check=check).stdout


def json_cdp():
    pages = json.load(urllib.request.urlopen(CDP + "/json/list", timeout=8))
    return next(p for p in pages if p.get("type") == "page")


def cdp_eval(ws, expression, seq):
    import websocket
    seq += 1
    ws.send(json.dumps({"id": seq, "method": "Runtime.evaluate", "params": {
        "expression": expression, "returnByValue": True, "awaitPromise": True
    }}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == seq:
            result = msg.get("result", {}).get("result", {})
            if "exceptionDetails" in msg.get("result", {}):
                raise RuntimeError("页面 CDP 执行异常")
            return result.get("value"), seq


def page_probe(ws, seq, label):
    expr = """JSON.stringify((()=>{const r=e=>e?e.getBoundingClientRect().toJSON():null;
      const h=document.getElementById('hall'), c=document.getElementById('cin');
      return {label:%s, url:location.href, ready:document.readyState,
        inner:[innerWidth,innerHeight], visual:visualViewport&&{
          width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop},
        hall:r(h), cin:r(c), active:document.activeElement&&{
          id:document.activeElement.id,tag:document.activeElement.tagName},
        title:document.title};})())""" % json.dumps(label, ensure_ascii=False)
    value, seq = cdp_eval(ws, expr, seq)
    return json.loads(value), seq


def ime_state():
    text = adb("shell", "dumpsys", "input_method")
    keys = {}
    for key in ("mInputShown", "mIsInputViewShown", "mSystemReady", "mCurMethodId"):
        m = re.search(r"\b" + re.escape(key) + r"=([^\s]+)", text)
        if m: keys[key] = m.group(1)
    keys["systemui_anr"] = "mNotResponding=true" in adb("shell", "dumpsys", "activity", "processes", check=False)
    return keys


def prepare_chrome():
    adb("shell", "echo", "chrome --disable-fre --no-first-run --no-default-browser-check --disable-first-run-experience --remote-debugging-port=9222", ">", "/data/local/tmp/chrome-command-line", check=False)
    # 部分 adb shell 不解释重定向；用 sh -c 保底。
    adb("shell", "sh", "-c", "echo 'chrome --disable-fre --no-first-run --no-default-browser-check --disable-first-run-experience --remote-debugging-port=9222' > /data/local/tmp/chrome-command-line")
    adb("shell", "am", "force-stop", "com.android.chrome", check=False)
    adb("shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main", "-d", URL)
    time.sleep(8)
    adb("forward", "--remove", "tcp:9223", check=False)
    adb("forward", "tcp:9223", "localabstract:chrome_devtools_remote")
    # 等 CDP socket 真正响应。
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            json.load(urllib.request.urlopen(CDP + "/json/version", timeout=3))
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("设备 Chrome CDP 端口未就绪")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    state = {"serial": SERIAL, "url": URL, "cases": [], "ok": False}
    if ime_state().get("systemui_anr"):
        raise RuntimeError("SystemUI ANR，当前 AVD 无效，拒绝给出产品键盘结论")
    prepare_chrome()
    try:
        import websocket
        page = json_cdp()
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    except Exception as e:
        raise RuntimeError(f"设备 Chrome CDP 不可用：{e}")
    seq = 0
    try:
        value, seq = cdp_eval(ws, "location.href = " + json.dumps(URL) + "; true", seq)
        time.sleep(5)
        page = json_cdp()
        ws.close(); ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
        for _ in range(30):
            snap, seq = page_probe(ws, seq, "lobby")
            if snap["ready"] == "complete" and snap["title"]:
                break
            time.sleep(1)
        state["cases"].append({"label": "lobby", "page": snap, "ime": ime_state()})
        # 匿名入口和官方房间都走真实网页点击处理器。
        _, seq = cdp_eval(ws, "document.getElementById('enterBtn')?.click(); true", seq)
        time.sleep(4)
        _, seq = cdp_eval(ws, "(()=>{const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent.trim()==='闲聊广场'); if(e)e.click(); return !!e})()", seq)
        time.sleep(5)
        before, seq = page_probe(ws, seq, "room-before-ime")
        state["cases"].append({"label": "room-before-ime", "page": before, "ime": ime_state()})
        if not before.get("cin") or before["cin"]["width"] < 1:
            raise RuntimeError("聊天室输入框未出现")
        # CSS viewport 842x517 与 Pixel Fold 应用区 2208x1682 对应，点击中心落在真实 textarea。
        physical_x = round((before["cin"]["left"] + before["cin"]["width"] / 2) * 2208 / before["inner"][0])
        physical_y = round(158 + (before["cin"]["top"] + before["cin"]["height"] / 2) * 1682 / before["inner"][1])
        adb("shell", "input", "tap", str(physical_x), str(physical_y))
        time.sleep(2)
        after, seq = page_probe(ws, seq, "room-after-physical-tap")
        after_ime = ime_state()
        state["cases"].append({"label": "room-after-physical-tap", "page": after, "ime": after_ime, "tap": [physical_x, physical_y]})
        state["ime_test_valid"] = not after_ime.get("systemui_anr") and after_ime.get("mSystemReady") == "true"
        state["keyboard_shown"] = after_ime.get("mInputShown") == "true" or after_ime.get("mIsInputViewShown") == "true"
        state["keyboard_layout_ok"] = bool(after.get("visual") and after["visual"]["height"] < before["visual"]["height"] and after.get("cin") and after["cin"]["bottom"] <= after["visual"]["height"] + 2)
        # 姿态转换：使用 Android Emulator 官方 console 命令，不把静态 resize 当折叠验证。
        for command, label in (("unfold", "after-unfold"), ("fold", "after-fold")):
            subprocess.run(ADB + ["emu", command], check=True, capture_output=True, text=True)
            time.sleep(3)
            state["cases"].append({"label": label, "page": page_probe(ws, seq, label)[0], "ime": ime_state()})
        state["ok"] = bool(state["ime_test_valid"] and state["keyboard_shown"] and state["keyboard_layout_ok"])
    finally:
        try: ws.close()
        except Exception: pass
    out = OUT / ("foldable-ime-" + time.strftime("%Y%m%d-%H%M%S") + ".json")
    out.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"ok": state["ok"], "ime_test_valid": state.get("ime_test_valid"), "keyboard_shown": state.get("keyboard_shown"), "keyboard_layout_ok": state.get("keyboard_layout_ok"), "report": str(out)}, ensure_ascii=False, indent=2))
    return 0 if state["ok"] else 1


if __name__ == "__main__":
    try: sys.exit(main())
    except Exception as e:
        print(json.dumps({"ok": False, "environment_error": str(e)}, ensure_ascii=False, indent=2))
        sys.exit(2)
