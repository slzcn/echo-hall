#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Hall 线上健康探测（双层）。
  第一层（轻，必跑）：curl 主页/ver/关键 JS —— 可达性、响应时间、版本、资源完整。
  第二层（重，CDP 在则跑）：无头 Chrome 开真实页面，抓 console error / 未捕获异常 / 白屏（核心 DOM 缺失）。
退出码：0=全绿，非0=有异常（cron 据此决定是否告警）。异常明细打到 stdout（JSON）。
本脚本只负责产出可信探测结果；异常闭环由定时巡检 agent 按「归因→修复→门禁→部署→复测」执行。
"""
import sys, json, time, urllib.request, urllib.error, ssl, re, os
import socket

BASE = "https://slzcn.github.io/echo-hall"
JS_ASSETS = ["js/app.js", "js/keyboard.js", "js/dm.js"]
SB_URL = "https://cddkniwbhvcbfgkgomtl.supabase.co"
SB_SLOW = 3.0            # 秒；Supabase REST 响应超此值记 slow
TIMEOUT = 12            # 秒；超过视为“卡死/超时”
SLOW_WARN = 6.0         # 秒；主页响应超过此值记 slow
CTX = ssl.create_default_context()
TREND_FILE = os.path.expanduser("~/.openclaw/workspace/memory/echo-health-trend.json")
EDGE_SLOW = 8.0          # Edge Function 探活响应阈值（serverless 冷启动 5-8s 属正常，>8s 才告警）
RPC_SLOW = 3.0           # 关键业务只读查询阈值

# 无用户手势的自动化首屏里，Chrome 按规范拒绝 vibrate。这是能力降级，不是页面故障。
EXPECTED_BROWSER_NOISE = (
    "Blocked call to navigator.vibrate because user hasn't tapped",
)

def _is_expected_browser_noise(text):
    return any(marker in (text or "") for marker in EXPECTED_BROWSER_NOISE)

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

def _public_anon_key():
    """从线上公开 app.js 临时取 anon key；只驻留内存，不写磁盘、不输出。"""
    _, body, _ = _get(f"{BASE}/js/app.js?_={int(time.time())}")
    m = re.search(rb"\bSB_ANON\s*=\s*['\"]([^'\"]+)", body)
    if not m:
        raise RuntimeError("线上 app.js 找不到 SB_ANON")
    return m.group(1).decode("ascii")

def _sb_request(path, key, body=None, method=None, timeout=TIMEOUT):
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "User-Agent": "echo-health/1.0"}
    req = urllib.request.Request(SB_URL + path, data=data, headers=headers, method=method)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            raw = r.read(); return r.status, raw, time.time()-t0
    except urllib.error.HTTPError as e:
        raw = e.read(); return e.code, raw, time.time()-t0
    except (urllib.error.URLError, TimeoutError, socket.timeout, OSError) as e:
        # 网络层瞬时抖动（SSL握手超时、DNS失败、TCP RST等）：返回哨兵 st=0，不抛
        return 0, b"", time.time()-t0

def probe_business_readonly():
    """只读合成探针：公开房、历史、灵魂、登录/生成 Edge 鉴权、母版与音频资源。无生产写入。"""
    issues, info = [], {}
    try:
        key = _public_anon_key()
    except Exception as e:
        return [f"业务探针无法读取公开客户端配置：{e}"], {"error": str(e)}
    # 公开房列表 + 选择一个官方房作为后续只读探针目标。
    st, raw, dt = _sb_request("/rest/v1/eh_rooms?select=id,name,kind&kind=eq.official&limit=1", key)
    rooms = []
    try: rooms = json.loads(raw.decode("utf-8")) if st == 200 else []
    except Exception: pass
    info["official_rooms"] = {"http": st, "time": round(dt,3), "count": len(rooms)}
    if st != 200 or not rooms:
        issues.append(f"官方房列表异常 HTTP={st} count={len(rooms)}（用户大厅可能空白）")
        return issues, info
    rid, room_name = rooms[0].get("id"), rooms[0].get("name")
    info["probe_room"] = {"id": rid, "name": room_name}
    # 历史与灵魂两个关键 RPC。
    for name, payload in (("eh_public_recent", {"rid":rid,"lim":2,"hide_recalled":True}), ("eh_room_souls", {"rid":rid})):
        st, raw, dt = _sb_request(f"/rest/v1/rpc/{name}", key, payload, "POST")
        # 网络层瞬时抖动（st==0）：等 1s 后即时重试一次，避免单点 SSL 握手超时误报
        if st == 0:
            time.sleep(1)
            st, raw, dt = _sb_request(f"/rest/v1/rpc/{name}", key, payload, "POST")
        count = None
        try:
            obj=json.loads(raw.decode("utf-8")); count=len(obj) if isinstance(obj,list) else None
        except Exception: pass
        info[name] = {"http":st,"time":round(dt,3),"rows":count}
        if st != 200: issues.append(f"关键 RPC {name} 异常 HTTP={st}（进房/历史可能卡住）")
        elif dt > RPC_SLOW: issues.append(f"关键 RPC {name} 响应慢 {round(dt,2)}s")
    # Edge Functions：故意使用无效/缺失业务参数，预期得到明确 4xx；5xx/超时才代表函数异常。
    # method=None → POST；"OPTIONS" 走 CORS 预检，只验连通，不真触发函数执行（用于付费/写库/AI 函数）。
    edge_cases = (
      ("eh-auth", "/functions/v1/eh-auth/resolve", {}, {400}, None),
      ("eh-bgm-gen", "/functions/v1/eh-bgm-gen", {}, {401}, None),
      ("eh-sing-cover", "/functions/v1/eh-sing-cover", {}, {401}, None),
      # eh-soul-tick 会真触发灵魂 AI tick；用 OPTIONS 预检只探连通，不真唤醒执行，避免探测拖出冷启动 5s+
      ("eh-soul-tick", "/functions/v1/eh-soul-tick", None, {200, 204}, "OPTIONS"),
      ("eh-admin-api", "/functions/v1/eh-admin-api", {}, {401}, None),
    )
    for name,path,payload,expected,method in edge_cases:
        try:
            st, raw, dt = _sb_request(path,key,payload,method or "POST",timeout=15)
            # Edge Function 5xx 瞬时抖动（Supabase 冷启动偶发 503）：等 2s 重试一次
            if st >= 500:
                time.sleep(2)
                st, raw, dt = _sb_request(path,key,payload,method or "POST",timeout=15)
            info[name]={"http":st,"time":round(dt,3),"method":method or "POST"}
            if st >= 500 or st not in expected: issues.append(f"Edge Function {name} 探活异常 HTTP={st}（预期 {sorted(expected)}）")
            elif dt > EDGE_SLOW: issues.append(f"Edge Function {name} 冷启动/响应慢 {round(dt,2)}s")
        except Exception as e:
            info[name]={"error":str(e)}; issues.append(f"Edge Function {name} 不可达/超时：{e}")
    # 母版清单 + 取第一条真实 MP3 资源，覆盖静态音频链路。
    try:
        st, raw, dt = _get(f"{BASE}/masters/manifest.json?_={int(time.time())}")
        manifest=json.loads(raw.decode("utf-8")); items=manifest.get("items",[])
        info["master_manifest"]={"http":st,"time":round(dt,3),"items":len(items)}
        if st != 200 or not items: issues.append("音频母版清单不可用/为空（翻唱入口可能失效）")
        else:
            url=items[0].get("url")
            audio_url=f"{BASE}/{url}?_={int(time.time())}"
            req=urllib.request.Request(audio_url,headers={"Range":"bytes=0-4095","User-Agent":"echo-health/1.0"})
            t0=time.time()
            with urllib.request.urlopen(req,timeout=TIMEOUT,context=CTX) as ar:
                ast=ar.status; audio=ar.read(4096); ctype=ar.headers.get("Content-Type",""); adt=time.time()-t0
            info["master_audio"]={"http":ast,"time":round(adt,3),"sample_bytes":len(audio),"content_type":ctype}
            if ast not in (200,206) or len(audio)<1000 or "audio" not in ctype: issues.append(f"音频母版资源异常 HTTP={ast} sample={len(audio)} type={ctype}")
    except Exception as e:
        info["master_manifest"]={"error":str(e)}; issues.append(f"音频母版链路异常：{e}")
    # 历史用户生成歌曲（eh-song 桶）抽样可播放：不真生成，只验证已有产物可读。
    # 走 eh_public_songs RPC 拿最近公开歌曲 url，取第一首 Range 采样验证文件完整。
    try:
        st, raw, dt = _sb_request("/rest/v1/rpc/eh_public_songs", key, {"p_limit": 5, "p_room": None}, "POST", timeout=RPC_SLOW+6)
        songs = []
        try: songs = json.loads(raw.decode("utf-8")) if raw else []
        except Exception: songs = []
        n = len(songs) if isinstance(songs, list) else 0
        info["user_songs"] = {"http": st, "time": round(dt,3), "rows": n}
        if st != 200:
            issues.append(f"历史歌曲列表 eh_public_songs 异常 HTTP={st}")
        elif n > 0:
            song = songs[0] if isinstance(songs[0], dict) else {}
            song_url = song.get("url") or song.get("song_url") or song.get("audio_url") or song.get("file_url")
            if song_url:
                full = song_url if song_url.startswith("http") else f"{BASE}/{song_url.lstrip('/')}"
                full = full + ("&" if "?" in full else "?") + f"_={int(time.time())}"
                try:
                    sreq=urllib.request.Request(full,headers={"Range":"bytes=0-4095","User-Agent":"echo-health/1.0"})
                    st0=time.time()
                    with urllib.request.urlopen(sreq,timeout=TIMEOUT,context=CTX) as sr:
                        sst=sr.status; sbytes=sr.read(4096); sctype=sr.headers.get("Content-Type",""); sdt=time.time()-st0
                    info["user_song_audio"]={"http":sst,"time":round(sdt,3),"sample_bytes":len(sbytes),"content_type":sctype}
                    if sst not in (200,206) or len(sbytes)<1000 or "audio" not in sctype:
                        issues.append(f"历史生成歌曲不可播放 HTTP={sst} sample={len(sbytes)} type={sctype}")
                except Exception as e:
                    # SSL/TCP握手偶发超时，单次重试：成功则记录抖动，不告警
                    info["user_song_audio"]={"error":str(e)}
                    try:
                        time.sleep(1.5)
                        sreq2=urllib.request.Request(full+"&retry=1",headers={"Range":"bytes=0-4095","User-Agent":"echo-health/1.0"})
                        st0=time.time()
                        with urllib.request.urlopen(sreq2,timeout=TIMEOUT,context=CTX) as sr2:
                            sst2=sr2.status; sbytes2=sr2.read(4096); sctype2=sr2.headers.get("Content-Type",""); sdt2=time.time()-st0
                        if sst2 in (200,206) and len(sbytes2)>=1000 and "audio" in sctype2:
                            info["user_song_audio"]={"http":sst2,"time":round(sdt2,3),"sample_bytes":len(sbytes2),"content_type":sctype2,"recovered":True}
                        else:
                            issues.append(f"历史生成歌曲不可播放(retry) HTTP={sst2} sample={len(sbytes2)} type={sctype2}")
                    except Exception as e2:
                        issues.append(f"历史生成歌曲抽样异常：{e} | retry: {e2}")
    except Exception as e:
        info["user_songs"]={"error":str(e)}  # 无公开歌曲不告警（空站初期属正常）
    return issues, info

def probe_supabase():
    """业务级：Supabase REST 健康查询测延迟/可达（后端挂了 = 聊天室消息/历史全挂）。"""
    issues = []
    info = {}
    ts = int(time.time())
    # 打 REST 根并带公开 anon key。无 key 的 401 也代表服务在线，但会让报告看起来像故障。
    try:
        key = _public_anon_key()
        req = urllib.request.Request(
            f"{SB_URL}/rest/v1/eh_rooms?select=id&limit=1",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "User-Agent": "echo-health/1.0",
            },
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
        elif st != 200:
            issues.append(f"Supabase REST 只读探测异常 HTTP={st}（带公开 anon key）")
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
    failed_resources = []
    request_urls = {}
    try:
        ws = websocket.create_connection(ws_url, timeout=8)
        mid = [0]
        def send(method, params=None):
            mid[0] += 1
            ws.send(json.dumps({"id": mid[0], "method": method, "params": params or {}}))
            return mid[0]
        send("Runtime.enable"); send("Log.enable"); send("Page.enable"); send("Network.enable"); send("Performance.enable")
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
                text = (a[0].get("value", "") if a else "")
                if not _is_expected_browser_noise(text):
                    errs.append("console.error: " + text[:200])
            elif m == "Log.entryAdded" and msg["params"]["entry"].get("level") == "error":
                text = msg["params"]["entry"].get("text", "")
                # Chrome 会把同一次 Network.loadingFailed 再写一条 Log.error；网络失败统一在下方重试后判断。
                # 无手势 vibrate 拒绝属于浏览器预期能力降级，不计入故障。
                if "net::ERR_" not in text and not _is_expected_browser_noise(text):
                    errs.append("Log.error: " + text[:200])
            elif m == "Network.requestWillBeSent":
                p = msg.get("params", {})
                req = p.get("request", {})
                request_urls[p.get("requestId")] = {"url": req.get("url"), "method": req.get("method", "GET")}
            elif m == "Network.loadingFailed":
                p=msg.get("params",{}); err=p.get("errorText") or "资源加载失败"
                # 新导航/主动取消媒体预加载会产生 ERR_ABORTED，不是线上资源故障。
                if not p.get("canceled") and err != "net::ERR_ABORTED":
                    req_meta = request_urls.get(p.get("requestId")) or {}
                    failed_resources.append({"error": err[:120], "url": req_meta.get("url"), "method": req_meta.get("method", "GET")})
            elif m == "Network.responseReceived":
                p=msg.get("params",{}); resp=p.get("response",{}); status=int(resp.get("status") or 0)
                if status >= 400:
                    req_meta = request_urls.get(p.get("requestId")) or {}
                    failed_resources.append({
                        "error": f"HTTP {status}",
                        "url": str(resp.get("url", ""))[:500] or None,
                        "method": req_meta.get("method", "GET"),
                    })
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
        # 首屏性能与内存基线；不把单点堆内存当“泄漏”，只记录供趋势比较。
        perf_expr = "JSON.stringify((()=>{const n=performance.getEntriesByType('navigation')[0];return {dom:n?Math.round(n.domContentLoadedEventEnd):null,load:n?Math.round(n.loadEventEnd):null,resources:performance.getEntriesByType('resource').length,heap:(performance.memory?Math.round(performance.memory.usedJSHeapSize/1048576):null),nodes:document.getElementsByTagName('*').length}})())"
        rp = send("Runtime.evaluate", {"expression":perf_expr,"returnByValue":True})
        perf = {}
        tp=time.time()+3
        while time.time()<tp:
            try: ws.settimeout(0.3); msg=json.loads(ws.recv())
            except Exception: continue
            if msg.get("id")==rp:
                try: perf=json.loads(msg.get("result",{}).get("result",{}).get("value") or "{}")
                except Exception: perf={}
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
        # CDN/本地链路偶发断连不等于资源损坏。失败 URL 独立重试一次，成功则仅记录，不告警。
        persistent_failures, recovered_resources = [], []
        seen = set()
        for item in failed_resources:
            url = item.get("url")
            marker = (item.get("error"), url)
            if marker in seen:
                continue
            seen.add(marker)
            if not url or not url.startswith(("http://", "https://")):
                persistent_failures.append(item)
                continue
            # POST/PATCH/DELETE 不能改成 GET 重放：会丢鉴权和 body，制造 401/405 等伪二次错误。
            if item.get("method", "GET").upper() not in ("GET", "HEAD"):
                persistent_failures.append(item)
                continue
            try:
                retry_url = url + ("&" if "?" in url else "?") + f"health_retry={int(time.time())}"
                st, _, _ = _get(retry_url)
                if st < 400:
                    recovered_resources.append(item)
                else:
                    persistent_failures.append({**item, "retry_http": st})
            except Exception as e:
                persistent_failures.append({**item, "retry_error": str(e)[:120]})
        info = {
            "js_errors": errs,
            "failed_resources": persistent_failures,
            "recovered_resources": recovered_resources,
            "white_screen": white,
            "realtime_ws": rt_state,
            "performance": perf,
        }
        issues = []
        if white:
            issues.append("白屏：核心 DOM(#hall) 未渲染")
        # 只报真正的运行时异常/error，不报 warn
        if errs:
            issues.append(f"页面运行时报错 {len(errs)} 条：" + " | ".join(errs[:3]))
        if persistent_failures:
            summary = [f"{x.get('error')} {x.get('url') or '(URL未知)'}" for x in persistent_failures[:3]]
            issues.append(f"资源加载持续失败 {len(persistent_failures)} 条：" + " | ".join(summary))
        if perf.get("load") and perf["load"] > 10000:
            issues.append(f"首屏 load 过慢 {perf['load']}ms（阈值 10000ms）")
        if rt_state and rt_state != "open":
            issues.append(f"Realtime WebSocket 连接异常：{rt_state}（聊天室实时消息可能不推送）")
        return issues, info
    except Exception as e:
        try: ws.close()
        except Exception: pass
        return None, {"skip": f"CDP 探测异常 {e}"}


def _drop_cold_outliers(vals):
    """剔除冷加载/初初初期快照异常点：低于中位数 85% 的样本视为探针抓早了，从趋势判断中排除。
    这样即使个别样本因 CDP 时机波动读出小值，也不会跟稳定平台一起被误判成"连续增长"。"""
    if not vals: return []
    s = sorted(vals)
    n = len(s)
    med = s[n//2] if n%2 else (s[n//2-1]+s[n//2])/2
    if not med: return list(vals)
    thr = med * 0.85
    return [v for v in vals if v >= thr]


def update_trend(http_info, cdp_info, business_info):
    """保留最近 48 个样本；只对连续/趋势异常告警，避免单点网络抖动误报。"""
    issues=[]
    try:
        os.makedirs(os.path.dirname(TREND_FILE), exist_ok=True)
        try: history=json.load(open(TREND_FILE,encoding="utf-8"))
        except Exception: history=[]
        perf=(cdp_info or {}).get("performance") or {}
        sample={
          "ts":int(time.time()), "index_s":(http_info.get("index") or {}).get("time"),
          "load_ms":perf.get("load"), "heap_mb":perf.get("heap"), "nodes":perf.get("nodes"),
          "rpc_s":(business_info.get("eh_public_recent") or {}).get("time")
        }
        history=(history+[sample])[-48:]
        tmp=TREND_FILE+".tmp"
        with open(tmp,"w",encoding="utf-8") as f: json.dump(history,f,ensure_ascii=False,indent=2)
        os.replace(tmp,TREND_FILE)
        last3=history[-3:]
        if len(last3)==3 and all((x.get("load_ms") or 0)>10000 for x in last3): issues.append("首屏连续 3 次 load 超过 10 秒（性能持续退化）")
        if len(last3)==3 and all((x.get("index_s") or 0)>6 for x in last3): issues.append("主页连续 3 次响应超过 6 秒（CDN/网络持续变慢）")
        # 只有样本均有效、剔除首屏冷加载异常点后严格单调递增、总增幅明显才告警；单点 heap 不判泄漏。
        # 8/26 修：旧逻辑用 >= 允许 plateau，[3629,5464,5464,5464,5464,5464] 被误判成“增长”，
        # 实际上 3629 只是探针恰好在页面 init 中期抓的冷快照。真泄漏是每次样本都比上一次高，不是稳定平台。
        last6=[x for x in history[-6:] if x.get("heap_mb") is not None and x.get("nodes") is not None]
        if len(last6)==6:
            heaps=[x["heap_mb"] for x in last6]; nodes=[x["nodes"] for x in last6]
            heaps_f=_drop_cold_outliers(heaps)
            nodes_f=_drop_cold_outliers(nodes)
            # 堆：至少剩 5 个样本且严格递增
            if len(heaps_f)>=5 and all(b>a for a,b in zip(heaps_f,heaps_f[1:])) and heaps_f[-1]-heaps_f[0]>=30:
                issues.append(f"JS 堆内存连续增长 {heaps_f[0]}→{heaps_f[-1]}MB（疑似内存泄漏）")
            # DOM：同样规则
            if len(nodes_f)>=5 and all(b>a for a,b in zip(nodes_f,nodes_f[1:])) and nodes_f[-1]-nodes_f[0]>=1000:
                issues.append(f"DOM 节点连续增长 {nodes_f[0]}→{nodes_f[-1]}（疑似页面泄漏）")
        return issues,{"samples":len(history),"latest":sample}
    except Exception as e:
        return [f"性能趋势记录失败：{e}"],{"error":str(e)}

def main():
    all_issues = []
    http_issues, http_info = probe_http()
    all_issues += http_issues
    ver_issues, ver_info = probe_version_consistency()
    all_issues += ver_issues
    sb_issues, sb_info = probe_supabase()
    all_issues += sb_issues
    biz_issues, biz_info = probe_business_readonly()
    all_issues += biz_issues
    cdp_issues, cdp_info = probe_cdp()
    if cdp_issues is not None:
        all_issues += cdp_issues
    trend_issues, trend_info = update_trend(http_info, cdp_info, biz_info)
    all_issues += trend_issues
    out = {
        "ts": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "ok": len(all_issues) == 0,
        "issues": all_issues,
        "http": http_info,
        "version": ver_info,
        "supabase": sb_info,
        "business": biz_info,
        "cdp": cdp_info,
        "trend": trend_info,
    }
    print(json.dumps(out, ensure_ascii=False, indent=2))
    sys.exit(0 if out["ok"] else 1)

if __name__ == "__main__":
    main()
