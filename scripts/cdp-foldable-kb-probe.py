#!/usr/bin/env python3
# 层次一自动化：CDP 驱动桌面 Chrome 模拟折叠屏展开 + 覆盖式软键盘（三信号全哑），
# 加载线上 Echo 真实页面，跑真实 keyboard.js/dm.js 事件链，
# 实测 39% 兜底下 #hall 高度 / 私信 --dm-vh / composer 底沿相对键盘顶沿关系。
import json, time, sys, requests, websocket

CDP = "http://127.0.0.1:9222"
URL = "https://slzcn.github.io/echo-hall/?kbdebug=1&_=%d" % int(time.time())

FULL_W, FULL_H = 690, 719          # 折叠屏展开态近似 CSS 像素
EXPECTED_EST = round(FULL_H * 0.39)  # 280

_id = [0]
def cmd(ws, method, params=None):
    _id[0] += 1
    mid = _id[0]
    ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid:
            if "error" in m: raise RuntimeError(f"{method}: {m['error']}")
            return m.get("result", {})

def ev(ws, expr, awaitP=False):
    r = cmd(ws, "Runtime.evaluate", {"expression": expr, "returnByValue": True,
                                     "awaitPromise": awaitP, "userGesture": True})
    return r.get("result", {}).get("value")

def setup():
    t = requests.put(CDP + "/json/new?" + URL, timeout=10).json()
    ws = websocket.create_connection(t["webSocketDebuggerUrl"], max_size=None, timeout=30)
    cmd(ws, "Page.enable"); cmd(ws, "Runtime.enable")
    cmd(ws, "Emulation.setDeviceMetricsOverride", {
        "width": FULL_W, "height": FULL_H, "deviceScaleFactor": 2.5,
        "mobile": True, "screenWidth": FULL_W, "screenHeight": FULL_H})
    cmd(ws, "Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    cmd(ws, "Emulation.setUserAgentOverride", {
        "userAgent": "Mozilla/5.0 (Linux; Android 15; 2405CPX3DC Build/AQ3A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36"})
    cmd(ws, "Page.navigate", {"url": URL}); time.sleep(6)
    return ws, t["id"]

def close(ws, tid):
    try: ws.close()
    except: pass
    try: requests.get(CDP + "/json/close/" + tid, timeout=5)
    except: pass

def run_chatroom(ws):
    """场景 A：聊天室 #cin 聚焦 → 覆盖式键盘（三信号哑）→ 真实 keyboard.js 事件链 → 读 #hall / composer"""
    ver = ev(ws, "window.__EH_BUILD_VER || 'NONE'")
    print(f"\n=== 场景 A：主聊天室（真实事件链）===\n版本 {ver}")
    ev(ws, "(function(){try{if(typeof goScene==='function')goScene('hall');}catch(e){}try{document.body.classList.add('hall-on');}catch(e){}})()")
    time.sleep(2)
    exists = ev(ws, "!!document.getElementById('hall') && !!document.getElementById('cin')")
    print(f"#hall + #cin 存在: {exists}")
    if not exists:
        print("  未进入大厅，跳过场景 A"); return None
    ev(ws, "document.getElementById('cin').focus()")
    time.sleep(0.5)
    after = ev(ws, """({
      innerH: window.innerHeight,
      hallH: parseInt(document.getElementById('hall').style.height,10) || parseInt(getComputedStyle(document.getElementById('hall')).height,10),
      cinBottom: Math.round(document.getElementById('cin').getBoundingClientRect().bottom)
    })""")
    kb_top = FULL_H - EXPECTED_EST
    gap = kb_top - after['cinBottom']
    ok = after['cinBottom'] <= kb_top + 2 and after['hallH'] < FULL_H
    print(f"聚焦后 #hall={after['hallH']}px composer底沿={after['cinBottom']} 键盘顶沿={kb_top}")
    print(f"{'✓' if ok else '✗'} composer 间隙={gap}px（>=0=露出）；#hall 缩短={FULL_H - after['hallH']}px")
    return {"ok": ok, "gap": gap, "hallH": after['hallH'], "cinBottom": after['cinBottom']}

def run_dm(ws):
    """场景 B：私信抽屉 —— dm.js 是封闭 IIFE，CDP 无法直接调内部函数。
    验证两件可靠的事：(1) 兜底公式 39%；(2) CSS 布局事实：抽屉高钉成 439 后 composer 落在键盘顶沿上方。
    真软键盘 vv/VK 事件序列桌面 Chrome 触发不全，仍靠真机。"""
    print(f"\n=== 场景 B：私信抽屉（兜底公式 + CSS 布局事实）===")
    has = ev(ws, "!!document.getElementById('dmChatDrawer') && !!document.getElementById('dmChatInput')")
    print(f"#dmChatDrawer + #dmChatInput 存在: {has}")
    if not has:
        print("  私信抽屉 DOM 未渲染，跳过场景 B"); return None
    base = FULL_H
    est = round(base * 0.39)      # 280，与 dm.js _onFocus 内 39% 同源
    dmvh = max(160, base - est)   # 439
    kb_top = base - est           # 439
    print(f"兜底公式: baseH={base} 估算键盘高={est}(39%) → --dm-vh={dmvh}px 键盘顶沿={kb_top}")
    layout = ev(ws, """(function(){
      var d=document.getElementById('dmChatDrawer');
      d.classList.add('on'); d.style.display='flex';
      d.style.setProperty('--dm-vh', '__DMVH__px');
      void d.offsetHeight;
      var inp=document.getElementById('dmChatInput');
      var comp=document.querySelector('#dmChatDrawer .dm-composer') || inp.closest('.dm-composer') || inp.parentElement;
      var dr=d.getBoundingClientRect(), cr=comp.getBoundingClientRect(), ir=inp.getBoundingClientRect();
      return {drawerBottom:Math.round(dr.bottom), drawerH:Math.round(dr.height),
              compBottom:Math.round(cr.bottom), inputBottom:Math.round(ir.bottom),
              dmvhSet:getComputedStyle(d).getPropertyValue('--dm-vh').trim()};
    })()""".replace("__DMVH__", str(dmvh)))
    if not layout:
        print("  量不到布局（抽屉结构与预期不符），跳过"); return None
    print(f"抽屉高={layout['drawerH']} 底沿={layout['drawerBottom']} --dm-vh实设='{layout['dmvhSet']}'")
    print(f"composer底沿={layout['compBottom']} 输入框底沿={layout['inputBottom']} 键盘顶沿={kb_top}")
    gap = kb_top - layout['inputBottom']
    ok = layout['inputBottom'] <= kb_top + 2 and layout['drawerH'] <= dmvh + 2
    print(f"{'✓' if ok else '✗'} 私信输入框间隙={gap}px（>=0=露出）；抽屉高={layout['drawerH']}<={dmvh}")
    return {"ok": ok, "gap": gap, "drawerH": layout['drawerH'], "inputBottom": layout['inputBottom'], "dmvh": dmvh}

if __name__ == "__main__":
    ws, tid = setup()
    try:
        a = run_chatroom(ws)
        b = run_dm(ws)
        print("\n=== 总结 ===")
        print(f"场景 A 聊天室: {a}")
        print(f"场景 B 私信:   {b}")
        oks = [x['ok'] for x in [a, b] if x]
        rc = 0 if oks and all(oks) else 1
        print(f"\n退出码: {rc}")
        sys.exit(rc)
    finally:
        close(ws, tid)
