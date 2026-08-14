#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Hall 线上健康探测（双层）。
  第一层（轻，必跑）：curl 主页/ver/关键 JS —— 可达性、响应时间、版本、资源完整。
  第二层（重，CDP 在则跑）：无头 Chrome 开真实页面，抓 console error / 未捕获异常 / 白屏（核心 DOM 缺失）。
退出码：0=全绿，非0=有异常（cron 据此决定是否告警）。异常明细打到 stdout（JSON）。
【铁律】本脚本只探测/报告，绝不改线上代码；功能 bug 走「告警→人分析→改→门禁→真机验收」。
"""
import sys, json, time, urllib.request, urllib.error, ssl

BASE = "https://slzcn.github.io/echo-hall"
JS_ASSETS = ["js/app.js", "js/keyboard.js", "js/dm.js"]
TIMEOUT = 12            # 秒；超过视为“卡死/超时”
SLOW_WARN = 6.0         # 秒；主页响应超过此值记 slow
CTX = ssl.create_default_context()

def _get(url, timeout=TIMEOUT):
    t0 = time.time()
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "echo-health/1.0"})
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
        body = r.read()
        return r.status, body, time.time() - t0

def probe_http():
    issues = []
    info = {}
    ts = int(time.time())
    # 主页
    try:
        st, body, dt = _get(f"{BASE}/?_={ts}")
        info["index"] = {"http": st, "time": round(dt, 3), "bytes": len(body)}
        if st != 200:
            issues.append(f"主页 HTTP={st}")
        if dt > SLOW_WARN:
            issues.append(f"主页响应慢 {round(dt,2)}s（阈值 {SLOW_WARN}s）")
        # 核心标记：页面壳是否还完整（掉了说明构建/部署坏了）
        html = body.decode("utf-8", "ignore")
        for mark in ["id=\"hall\"", "BUILD_VER"]:
            if mark not in html:
                issues.append(f"主页缺关键标记 {mark}（页面壳可能损坏）")
    except (urllib.error.URLError, TimeoutError, Exception) as e:
        issues.append(f"主页不可达/超时：{type(e).__name__} {e}")
        info["index"] = {"error": str(e)}
    # ver.txt
    try:
        st, body, dt = _get(f"{BASE}/ver.txt?_={ts}")
        ver = body.decode("utf-8", "ignore").strip()
        info["ver"] = {"http": st, "value": ver}
        if st != 200 or not ver:
            issues.append(f"ver.txt 异常 HTTP={st} 值='{ver}'")
    except Exception as e:
        issues.append(f"ver.txt 不可达：{e}")
        info["ver"] = {"error": str(e)}
    # 关键 JS 资源
    for a in JS_ASSETS:
        try:
            st, body, dt = _get(f"{BASE}/{a}?_={ts}")
            ok = st == 200 and len(body) > 200
            info[a] = {"http": st, "bytes": len(body)}
            if not ok:
                issues.append(f"{a} 异常 HTTP={st} bytes={len(body)}")
        except Exception as e:
            issues.append(f"{a} 不可达：{e}")
            info[a] = {"error": str(e)}
    return issues, info

def probe_cdp():
    """CDP 在（9222）才跑：真实页面白屏/JS 报错检测。CDP 不在返回 (None, {}) 表示跳过。"""
    try:
        import websocket  # noqa
    except Exception:
        return None, {"skip": "no websocket-client"}
    try:
        st, body, _ = _get("http://127.0.0.1:9222/json/version", timeout=3)
    except Exception:
        return None, {"skip": "CDP 9222 不在"}
    import requests
    tab = None
    target = f"{BASE}/?_={int(time.time())}"
    # Chrome 111+ 要求 PUT 开 tab；老版本用 GET。两种都试。
    for method in ("put", "get"):
        try:
            fn = getattr(requests, method)
            resp = fn("http://127.0.0.1:9222/json/new?" + target, timeout=5)
            if resp.status_code == 200 and resp.text.strip().startswith("{"):
                tab = resp.json(); break
        except Exception:
            continue
    if not tab:
        return None, {"skip": "CDP 开 tab 失败（PUT/GET 均不通）"}
    try:
        ws_url = tab["webSocketDebuggerUrl"]; tab_id = tab["id"]
    except Exception as e:
        return None, {"skip": f"CDP tab 结构异常 {e}"}
    import websocket
    errs = []
    try:
        ws = websocket.create_connection(ws_url, timeout=8)
        mid = [0]
        def send(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            return mid[0]
        send("Runtime.enable"); send("Log.enable"); send("Page.enable")
        t_end = time.time() + 7
        while time.time() < t_end:
            try:
                ws.settimeout(max(0.2, t_end - time.time()))
                msg = json.loads(ws.recv())
            except Exception:
                break
            m = msg.get("method")
            if m == "Runtime.exceptionThrown":
                d = msg["params"]["exceptionDetails"]
                errs.append("JS异常: " + (d.get("exception", {}).get("description") or d.get("text", ""))[:200])
            elif m == "Runtime.consoleAPICalled" and msg["params"].get("type") == "error":
                a = msg["params"].get("args", [])
                errs.append("console.error: " + (a[0].get("value", "") if a else "")[:200])
            elif m == "Log.entryAdded" and msg["params"]["entry"].get("level") == "error":
                errs.append("Log.error: " + msg["params"]["entry"].get("text", "")[:200])
        # 白屏检测：核心 DOM 是否存在
        r = send("Runtime.evaluate", {"expression": "!!document.getElementById('hall') && document.body && document.body.childElementCount>0", "returnByValue": True})
        white = None
        t2 = time.time() + 3
        while time.time() < t2:
            try:
                ws.settimeout(0.3); msg = json.loads(ws.recv())
            except Exception:
                continue
            if msg.get("id") == r:
                white = not bool(msg.get("result", {}).get("result", {}).get("value"))
                break
        ws.close()
        try: requests.get(f"http://127.0.0.1:9222/json/close/{tab_id}", timeout=3)
        except Exception: pass
        info = {"js_errors": errs, "white_screen": white}
        issues = []
        if white:
            issues.append("白屏：核心 DOM(#hall) 未渲染")
        # 只报真正的运行时异常/error，不报 warn
        if errs:
            issues.append(f"页面运行时报错 {len(errs)} 条：" + " | ".join(errs[:3]))
        return issues, info
    except Exception as e:
        try: ws.close()
        except Exception: pass
        return None, {"skip": f"CDP 探测异常 {e}"}

def main():
    all_issues = []
    http_issues, http_info = probe_http()
    all_issues += http_issues
    cdp_issues, cdp_info = probe_cdp()
    if cdp_issues is not None:
        all_issues += cdp_issues
    out = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "ok": len(all_issues) == 0,
        "issues": all_issues,
        "http": http_info,
        "cdp": cdp_info,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0 if out["ok"] else 1)

if __name__ == "__main__":
    main()
