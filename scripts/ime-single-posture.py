#!/usr/bin/env python3
"""Echo 单姿态 IME 采集（聊天室 / 私信通用）。

与 foldable-ime-probe.py 共用采集手法：设备端 Chrome CDP + adb 物理触摸。
差异：本脚本【不做 unfold/fold 姿态切换】——实测该切换会让当前 AVD 存快照并退出，
故姿态改由外层脚本"每姿态各自启动一次 AVD"来覆盖，避免一次运行里跨姿态把模拟器搞崩。

用法：
  SCENE=room   ECHO_URL=... python3 scripts/ime-single-posture.py
  SCENE=dm     ECHO_URL=... python3 scripts/ime-single-posture.py
环境变量：
  ANDROID_SERIAL (默认 emulator-5556)
  ECHO_CDP       (默认 http://127.0.0.1:9223)
  POSTURE_LABEL  (仅用于报告标注，如 folded / unfolded)
"""
import json, os, re, subprocess, sys, time, urllib.request
from pathlib import Path

SERIAL = os.environ.get("ANDROID_SERIAL", "emulator-5556")
CDP = os.environ.get("ECHO_CDP", "http://127.0.0.1:9223")
URL = os.environ.get("ECHO_URL", "https://slzcn.github.io/echo-hall/?kbdebug=1")
SCENE = os.environ.get("SCENE", "room")   # room | dm
POSTURE = os.environ.get("POSTURE_LABEL", "unknown")
OUT = Path(os.environ.get("ECHO_FOLD_OUT", "/tmp/echo-fold-logs"))
ADB = ["adb", "-s", SERIAL]


def adb(*args, check=True):
    return subprocess.run(ADB + list(args), text=True, capture_output=True, check=check).stdout


def json_cdp():
    pages = json.load(urllib.request.urlopen(CDP + "/json/list", timeout=8))
    return next(p for p in pages if p.get("type") == "page")


def cdp_eval(ws, expression, seq):
    seq += 1
    ws.send(json.dumps({"id": seq, "method": "Runtime.evaluate", "params": {
        "expression": expression, "returnByValue": True, "awaitPromise": True}}))
    while True:
        msg = json.loads(ws.recv())
        if msg.get("id") == seq:
            return msg.get("result", {}).get("result", {}).get("value"), seq


def page_probe(ws, seq, label):
    # 聊天室看 #hall/#cin；私信看 #dmChatDrawer/#dmChatInput。
    expr = """JSON.stringify((()=>{const r=e=>e?e.getBoundingClientRect().toJSON():null;
      const h=document.getElementById('hall'), c=document.getElementById('cin');
      const dd=document.getElementById('dmChatDrawer'), di=document.getElementById('dmChatInput');
      return {label:%s, url:location.href, ready:document.readyState,
        inner:[innerWidth,innerHeight], visual:visualViewport&&{
          width:visualViewport.width,height:visualViewport.height,offsetTop:visualViewport.offsetTop},
        hall:r(h), cin:r(c), dmDrawer:r(dd), dmInput:r(di),
        dmOpen: dd? dd.classList.contains('on'):false,
        active:document.activeElement&&{id:document.activeElement.id,tag:document.activeElement.tagName},
        title:document.title};})())""" % json.dumps(label, ensure_ascii=False)
    value, seq = cdp_eval(ws, expr, seq)
    return json.loads(value), seq


def ime_state():
    text = adb("shell", "dumpsys", "input_method", check=False)
    keys = {}
    for key in ("mInputShown", "mIsInputViewShown", "mSystemReady", "mCurMethodId"):
        m = re.search(r"\b" + re.escape(key) + r"=([^\s]+)", text)
        if m: keys[key] = m.group(1)
    keys["systemui_anr"] = "mNotResponding=true" in adb("shell", "dumpsys", "activity", "processes", check=False)
    return keys


def prepare_chrome():
    adb("shell", "sh", "-c", "echo 'chrome --disable-fre --no-first-run --no-default-browser-check --disable-first-run-experience --remote-debugging-port=9222' > /data/local/tmp/chrome-command-line")
    adb("shell", "am", "force-stop", "com.android.chrome", check=False)
    adb("shell", "am", "start", "-n", "com.android.chrome/com.google.android.apps.chrome.Main", "-d", URL)
    time.sleep(8)
    adb("forward", "--remove", "tcp:9223", check=False)
    adb("forward", "tcp:9223", "localabstract:chrome_devtools_remote")
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            json.load(urllib.request.urlopen(CDP + "/json/version", timeout=3)); return
        except Exception:
            time.sleep(1)
    raise RuntimeError("设备 Chrome CDP 端口未就绪")


def physical_tap(rect, inner, wm_w, wm_h, y_offset=0):
    px = round((rect["left"] + rect["width"] / 2) * wm_w / inner[0])
    py = round(y_offset + (rect["top"] + rect["height"] / 2) * wm_h / inner[1])
    adb("shell", "input", "tap", str(px), str(py))
    return [px, py]


def wm_size():
    m = re.search(r"Physical size:\s*(\d+)x(\d+)", adb("shell", "wm", "size"))
    return (int(m.group(1)), int(m.group(2))) if m else (2208, 1840)


def main():
    import websocket
    OUT.mkdir(parents=True, exist_ok=True)
    state = {"serial": SERIAL, "url": URL, "scene": SCENE, "posture": POSTURE, "cases": [], "ok": False}
    if ime_state().get("systemui_anr"):
        raise RuntimeError("SystemUI ANR，当前 AVD 无效，拒绝给出产品键盘结论")
    wm_w, wm_h = wm_size()
    state["wm_size"] = [wm_w, wm_h]
    prepare_chrome()
    page = json_cdp()
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=10, suppress_origin=True)
    seq = 0
    try:
        for _ in range(30):
            snap, seq = page_probe(ws, seq, "lobby")
            if snap["ready"] == "complete" and snap["title"]:
                break
            time.sleep(1)
        state["cases"].append({"label": "lobby", "page": snap, "ime": ime_state()})
        # 匿名进入 + 进官方房
        _, seq = cdp_eval(ws, "document.getElementById('enterBtn')?.click(); true", seq)
        time.sleep(4)
        _, seq = cdp_eval(ws, "(()=>{const e=[...document.querySelectorAll('*')].find(x=>x.children.length===0&&x.textContent.trim()==='闲聊广场'); if(e)e.click(); return !!e})()", seq)
        time.sleep(5)

        if SCENE == "dm":
            # 打开与灵魂/任意成员的私信：优先点在线成员头像→私信入口；兜底用 kbdebug 暴露的打开钩子。
            opened, seq = cdp_eval(ws, "(()=>{ if(window.__ehOpenAnyDM) return window.__ehOpenAnyDM(); const b=document.querySelector('[data-act=\"dm\"],.dm-open,#dmInboxBtn'); if(b){b.click();return 'clicked-btn';} return 'no-hook'; })()", seq)
            time.sleep(3)
            state["dm_open_via"] = opened
            before, seq = page_probe(ws, seq, "dm-before-ime")
            state["cases"].append({"label": "dm-before-ime", "page": before, "ime": ime_state()})
            target = before.get("dmInput")
            if not target or target.get("width", 0) < 1:
                raise RuntimeError("私信输入框未出现（dm_open_via=%s）" % opened)
        else:
            before, seq = page_probe(ws, seq, "room-before-ime")
            state["cases"].append({"label": "room-before-ime", "page": before, "ime": ime_state()})
            target = before.get("cin")
            if not target or target.get("width", 0) < 1:
                raise RuntimeError("聊天室输入框未出现")

        tap = physical_tap(target, before["inner"], wm_w, wm_h, y_offset=round(wm_h*0.086))
        time.sleep(2)
        label = ("dm" if SCENE == "dm" else "room") + "-after-physical-tap"
        after, seq = page_probe(ws, seq, label)
        after_ime = ime_state()
        state["cases"].append({"label": label, "page": after, "ime": after_ime, "tap": tap})
        after_target = after.get("dmInput") if SCENE == "dm" else after.get("cin")
        state["ime_test_valid"] = (not after_ime.get("systemui_anr")) and after_ime.get("mSystemReady") == "true"
        state["keyboard_shown"] = after_ime.get("mInputShown") == "true" or after_ime.get("mIsInputViewShown") == "true"
        # 键盘弹起后：可视高应缩小，且输入框底边在可视区内（不被键盘遮）
        state["keyboard_layout_ok"] = bool(
            after.get("visual") and before.get("visual")
            and after["visual"]["height"] < before["visual"]["height"]
            and after_target and after_target["bottom"] <= after["visual"]["height"] + 3)
        state["ok"] = bool(state["ime_test_valid"] and state["keyboard_shown"] and state["keyboard_layout_ok"])
    finally:
        try: ws.close()
        except Exception: pass
    out = OUT / ("ime-%s-%s-%s.json" % (SCENE, POSTURE, time.strftime("%Y%m%d-%H%M%S")))
    out.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"scene": SCENE, "posture": POSTURE, "ok": state["ok"],
        "ime_test_valid": state.get("ime_test_valid"), "keyboard_shown": state.get("keyboard_shown"),
        "keyboard_layout_ok": state.get("keyboard_layout_ok"), "report": str(out)}, ensure_ascii=False, indent=2))
    return 0 if state["ok"] else 1


if __name__ == "__main__":
    try: sys.exit(main())
    except Exception as e:
        print(json.dumps({"ok": False, "environment_error": str(e)}, ensure_ascii=False, indent=2))
        sys.exit(2)
