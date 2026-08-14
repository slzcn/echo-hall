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
SB_URL = "https://cddkniwbhvcbfgkgomtl.supabase.co"
SB_SLOW = 3.0            # 秒；Supabase REST 响应超此值记 slow
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

def probe_version_consistency():
    """版本一致性：线上 ver.txt / index.html BUILD_VER / sw.js SW_VERSION 三处必须一致。
       不一致=发布断层（部分文件未刷新/部署半途），告警让人工重发（不自动改线上）。"""
    issues = []
    info = {}
    ts = int(time.time())
    try:
        _, vb, _ = _get(f"{BASE}/ver.txt?_={ts}"); ver = vb.decode("utf-8", "ignore").strip()
        _, ib, _ = _get(f"{BASE}/index.html?_={ts}"); html = ib.decode("utf-8", "ignore")
        _, sb, _ = _get(f"{BASE}/sw.js?_={ts}"); swjs = sb.decode("utf-8", "ignore")
        import re
        m_build = re.search(r"BUILD_VER\s*=\s*'([^']+)'", html)
        m_sw = re.search(r"SW_VERSION\s*=\s*'([^']+)'", swjs)
        build = m_build.group(1) if m_build else None
        swv = m_sw.group(1) if m_sw else None
        info = {"ver.txt": ver, "BUILD_VER": build, "SW_VERSION": swv}
        if not build or build != ver:
            issues.append(f"版本不一致：index.html BUILD_VER='{build}' ≠ ver.txt='{ver}'（发布可能未完成/部分文件未刷新）")
        if not swv or (ver and ver not in (swv or "")):
            issues.append(f"版本不一致：sw.js SW_VERSION='{swv}' 未包含 ver.txt='{ver}'（SW 可能仍缓旧壳）")
    except Exception as e:
        issues.append(f"版本一致性探测失败：{e}")
        info = {"error": str(e)}
    return issues, info

def probe_supabase():
    """业务级：Supabase REST 健康查询测延迟/可达（后端挂了 = 聊天室消息/历史全挂）。"""
    issues = []
    info = {}
    ts = int(time.time())
    # 打 REST 根（带 anon key），200/401/404 都算服务在（只看网络可达+延迟）；超时/5xx=后端异常。
    try:
        req = urllib.request.Request(
            f"{SB_URL}/rest/v1/?_={ts}",
            headers={"User-Agent": "echo-health/1.0"},
        )
        t0 = time.time()
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT, context=CTX) as r:
                st = r.status; r.read()
        except urllib.error.HTTPError as he:
            st = he.code                       # 4xx 也是“服务在”
        dt = time.time() - t0
        info["rest"] = {"http": st, "time": round(dt, 3)}
        if st >= 500:
            issues.append(f"Supabase REST 5xx HTTP={st}（后端异常，聊天室可能收发消息失败）")
        elif dt > SB_SLOW:
            issues.append(f"Supabase REST 响应慢 {round(dt,2)}s（阈值 {SB_SLOW}s，用户可能感觉卡）")
    except (urllib.error.URLError, TimeoutError, Exception) as e:
        issues.append(f"Supabase 后端不可达/超时：{type(e).__name__} {e}（聊天室整体不可用）")
        info["rest"] = {"error": str(e)}
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
        # Chrome 151 的 /json/new 可能只创建空 tab，不保证按 URL 导航；显式导航，避免在 about:blank 上取不到线上 app.js。
        send("Page.navigate", {"url": f"{BASE}/?_={int(time.time())}"})
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
        # 业务级：Python 临时读取线上公开 app.js 的 anon key，仅用于一次 Realtime 握手；不落盘、不输出。
        try:
            _, app_body, _ = _get(f"{BASE}/js/app.js?_={int(time.time())}")
            import re
            m = re.search(rb"\bSB_ANON\s*=\s*['\"]([^'\"]+)", app_body)
            public_key = m.group(1).decode("ascii") if m else None
        except Exception:
            public_key = None
        if not public_key:
            rt_state = "public-key-not-found"
        else:
            key_literal = json.dumps(public_key)
            ws_expr = (
                "new Promise(function(res){try{"
                "var u='wss://cddkniwbhvcbfgkgomtl.supabase.co/realtime/v1/websocket?apikey='+encodeURIComponent(" + key_literal + ")+'&vsn=1.0.0';"
                "var s=new WebSocket(u),done=false;"
                "var to=setTimeout(function(){if(!done){done=true;try{s.close()}catch(e){}res('timeout')}},6000);"
                "s.onopen=function(){if(!done){done=true;clearTimeout(to);try{s.close()}catch(e){}res('open')}};"
                "s.onerror=function(){if(!done){done=true;clearTimeout(to);res('error')}};"
                "}catch(e){res('exc:'+e.message)}})"
            )
            rw = send("Runtime.evaluate", {"expression": ws_expr, "awaitPromise": True, "returnByValue": True})
            rt_state = None
            t3 = time.time() + 8
            while time.time() < t3:
                try:
                    ws.settimeout(0.4); msg = json.loads(ws.recv())
                except Exception:
                    continue
                if msg.get("id") == rw:
                    rt_state = msg.get("result", {}).get("result", {}).get("value")
                    break
        ws.close()
        try: requests.get(f"http://127.0.0.1:9222/json/close/{tab_id}", timeout=3)
        except Exception: pass
        info = {"js_errors": errs, "white_screen": white, "realtime_ws": rt_state}
        issues = []
        if white:
            issues.append("白屏：核心 DOM(#hall) 未渲染")
        # 只报真正的运行时异常/error，不报 warn
        if errs:
            issues.append(f"页面运行时报错 {len(errs)} 条：" + " | ".join(errs[:3]))
        if rt_state and rt_state != "open":
            issues.append(f"Realtime WebSocket 连接异常：{rt_state}（聊天室实时消息可能不推送）")
        return issues, info
    except Exception as e:
        try: ws.close()
        except Exception: pass
        return None, {"skip": f"CDP 探测异常 {e}"}

def main():
    all_issues = []
    http_issues, http_info = probe_http()
    all_issues += http_issues
    ver_issues, ver_info = probe_version_consistency()
    all_issues += ver_issues
    sb_issues, sb_info = probe_supabase()
    all_issues += sb_issues
    cdp_issues, cdp_info = probe_cdp()
    if cdp_issues is not None:
        all_issues += cdp_issues
    out = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "ok": len(all_issues) == 0,
        "issues": all_issues,
        "http": http_info,
        "version": ver_info,
        "supabase": sb_info,
        "cdp": cdp_info,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0 if out["ok"] else 1)

if __name__ == "__main__":
    main()
