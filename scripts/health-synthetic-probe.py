#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Echo Hall 每日消息闭环探测。

固定探测身份 + 固定私密探测房：Realtime 订阅 → 写消息 → REST 读回 →
Realtime 收到 → 服务端精确硬清理 → 验证归零。

安全不变量：
- 凭据只从 ~/.openclaw/credentials 读取，不进仓库、不输出。
- 只允许固定 room_id / uid、文本前缀 [EH_PROBE:、本轮 message id。
- 每轮最多写 1 条；清理失败即失败，下一轮先清理 stale 再写。
- 绝不触碰正常房间、正常账号、音频生成或收费接口。
"""
import json, os, ssl, sys, time, urllib.error, urllib.parse, urllib.request, uuid

CRED = os.path.expanduser("~/.openclaw/credentials/echo-health-probe.json")
SB_SECRETS = os.path.expanduser("~/.openclaw/credentials/supabase.secrets.json")
PREFIX = "[EH_PROBE:"
TIMEOUT = 15
CTX = ssl.create_default_context()


def request(url, headers, body=None, method=None, timeout=TIMEOUT):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as r:
            raw = r.read()
            return r.status, raw, time.time()
    except urllib.error.HTTPError as e:
        return e.code, e.read(), time.time()


def load_creds():
    st = os.stat(CRED)
    if st.st_mode & 0o077:
        raise RuntimeError("探测凭据权限不安全，必须 chmod 600")
    probe = json.load(open(CRED, encoding="utf-8"))
    sec = json.load(open(SB_SECRETS, encoding="utf-8"))["vc_sim"]
    required = ("url", "anon_key", "uid", "room_id", "access_token", "refresh_token")
    if any(not probe.get(k) for k in required):
        raise RuntimeError("探测凭据字段不完整")
    if probe["url"] != sec["url"]:
        raise RuntimeError("探测凭据项目与服务端项目不一致")
    return probe, sec


def save_probe(probe):
    tmp = CRED + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(probe, f)
    os.replace(tmp, CRED)
    os.chmod(CRED, 0o600)


def refresh_session(probe):
    headers = {"apikey": probe["anon_key"], "Content-Type": "application/json"}
    url = probe["url"] + "/auth/v1/token?grant_type=refresh_token"
    st, raw, _ = request(url, headers, {"refresh_token": probe["refresh_token"]}, "POST")
    if st != 200:
        raise RuntimeError(f"探测身份 session 刷新失败 HTTP={st}")
    data = json.loads(raw.decode("utf-8"))
    probe["access_token"] = data["access_token"]
    probe["refresh_token"] = data.get("refresh_token") or probe["refresh_token"]
    probe["refreshed_at"] = int(time.time())
    save_probe(probe)
    return probe


def headers(key, token=None, prefer=None):
    h = {"apikey": key, "Authorization": "Bearer " + (token or key), "Content-Type": "application/json", "User-Agent": "echo-health-synthetic/1.0"}
    if prefer:
        h["Prefer"] = prefer
    return h


def strict_cleanup(probe, sec, message_ids=None, stale=False):
    """服务端硬清理；所有选择器同时绑定固定房、固定用户、固定前缀。"""
    base = probe["url"] + "/rest/v1/eh_messages"
    filters = [
        "room_id=eq." + urllib.parse.quote(probe["room_id"]),
        "user_id=eq." + urllib.parse.quote(probe["uid"]),
        "text=like." + urllib.parse.quote(PREFIX + "*"),
    ]
    if message_ids:
        if len(message_ids) > 20:
            raise RuntimeError("清理上限超过 20，拒绝执行")
        filters.append("id=in.(" + ",".join(str(int(x)) for x in message_ids) + ")")
    elif stale:
        cutoff = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 3600))
        filters.append("created_at=lt." + urllib.parse.quote(cutoff))
    else:
        raise RuntimeError("清理必须指定本轮 message_ids 或 stale 模式")
    st, raw, _ = request(base + "?" + "&".join(filters), headers(sec["service_role_key"]), None, "DELETE")
    if st not in (200, 204):
        raise RuntimeError(f"严格清理失败 HTTP={st}")


def direct_read(probe, token, message_id):
    q = "/rest/v1/eh_messages?select=id,room_id,user_id,text,kind&id=eq.%s&room_id=eq.%s&user_id=eq.%s" % (
        message_id, urllib.parse.quote(probe["room_id"]), urllib.parse.quote(probe["uid"])
    )
    st, raw, _ = request(probe["url"] + q, headers(probe["anon_key"], token), None, "GET")
    if st != 200:
        raise RuntimeError(f"消息读回失败 HTTP={st}")
    rows = json.loads(raw.decode("utf-8"))
    return rows


def realtime_subscribe(websocket_mod, ws_url, token, room_id, topic, ref="1"):
    """新建连接并订阅固定探测房；返回已 SUBSCRIBED 的 websocket。"""
    ws = websocket_mod.create_connection(ws_url, timeout=8)
    join = {
        "topic": topic, "event": "phx_join", "ref": ref, "join_ref": ref,
        "payload": {"access_token": token, "config": {"broadcast": {"ack": False, "self": False}, "presence": {"key": ""}, "postgres_changes": [{"event": "INSERT", "schema": "public", "table": "eh_messages", "filter": "room_id=eq." + room_id}]}}
    }
    ws.send(json.dumps(join))
    deadline = time.time() + 8
    while time.time() < deadline:
        ws.settimeout(max(0.2, deadline - time.time()))
        msg = json.loads(ws.recv())
        if msg.get("event") == "phx_reply" and msg.get("ref") == ref and msg.get("payload", {}).get("status") == "ok":
            return ws
    try: ws.close()
    except Exception: pass
    raise RuntimeError("Realtime 探测房订阅超时/失败")


def run():
    try:
        import websocket
    except Exception as e:
        raise RuntimeError(f"缺 websocket-client：{e}")
    probe, sec = load_creds()
    probe = refresh_session(probe)
    token = probe["access_token"]

    # 每轮开头只清理超过 1 小时的固定探针残留；若服务端清理失败，不继续写。
    strict_cleanup(probe, sec, stale=True)

    run_id = time.strftime("%Y%m%dT%H%M%S", time.localtime()) + "-" + uuid.uuid4().hex[:8]
    text = f"{PREFIX}{run_id}]"
    ws_url = probe["url"].replace("https://", "wss://") + "/realtime/v1/websocket?apikey=" + urllib.parse.quote(probe["anon_key"]) + "&vsn=1.0.0"
    topic = "realtime:echo-health-" + run_id
    ws = realtime_subscribe(websocket, ws_url, token, probe["room_id"], topic, "1")
    # 主动断开后重连/重新订阅，覆盖弱网或手机后台后的基础恢复能力。
    ws.close()
    reconnect_start = time.time()
    ws = realtime_subscribe(websocket, ws_url, token, probe["room_id"], topic + "-reconnect", "2")
    reconnect_ms = round((time.time() - reconnect_start) * 1000)

    payload = {"room_id": probe["room_id"], "user_id": probe["uid"], "name": "健康探针", "emoji": "🧪", "color": "#22C55E", "text": text, "kind": "msg"}
    t0 = time.time()
    st, raw, _ = request(probe["url"] + "/rest/v1/eh_messages?select=id", headers(probe["anon_key"], token, "return=representation"), payload, "POST")
    if st not in (200, 201):
        ws.close(); raise RuntimeError(f"探测消息写入失败 HTTP={st}")
    rows = json.loads(raw.decode("utf-8")); mid = int(rows[0]["id"])
    write_ms = round((time.time() - t0) * 1000)

    try:
        read_rows = direct_read(probe, token, mid)
        rest_ok = len(read_rows) == 1 and read_rows[0].get("text") == text
        realtime_ok = False
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                ws.settimeout(max(0.2, deadline - time.time())); msg = json.loads(ws.recv())
            except Exception:
                continue
            if msg.get("event") == "postgres_changes":
                data = msg.get("payload", {}).get("data", {})
                rec = data.get("record", {})
                if str(rec.get("id")) == str(mid) and rec.get("text") == text:
                    realtime_ok = True; break
        if not rest_ok:
            raise RuntimeError("消息写入后 REST 读回不一致")
        if not realtime_ok:
            raise RuntimeError("消息写入后 Realtime 10 秒内未收到同 ID")
    finally:
        try: ws.close()
        except Exception: pass
        strict_cleanup(probe, sec, message_ids=[mid])

    verify = direct_read(probe, token, mid)
    if verify:
        raise RuntimeError("探测消息硬清理后仍可读")
    return {"ok": True, "run_id": run_id, "reconnect_ms": reconnect_ms, "write_ms": write_ms, "rest_readback": True, "realtime_delivery": True, "cleanup": True}


if __name__ == "__main__":
    try:
        print(json.dumps(run(), ensure_ascii=False, indent=2)); sys.exit(0)
    except Exception as e:
        print(json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False, indent=2)); sys.exit(1)
