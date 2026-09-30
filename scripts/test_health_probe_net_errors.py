#!/usr/bin/env python3
"""test_health_probe_net_errors.py — 验证 _sb_request 对网络层瞬时抖动的容错。

旧实现必红：URLError 穿透到调用方，整个探针崩溃。
当前实现必绿：_sb_request 返回 (0, b"", dt)，调用方走重试逻辑。

AGENTS.md §1 铁律：旧实现必红、当前实现必绿。
"""
import sys, os, json
from unittest.mock import patch, MagicMock
from urllib.error import URLError
from socket import timeout as socket_timeout

# 把 scripts/ 加入 path 并加载 health-probe.py（文件名含横杠，不能直接 import）
SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
import importlib.util
spec = importlib.util.spec_from_file_location("health_probe", os.path.join(SCRIPTS_DIR, "health-probe.py"))
health_probe = importlib.util.module_from_spec(spec)
sys.modules["health_probe"] = health_probe
spec.loader.exec_module(health_probe)
hp = health_probe


def test_sb_request_catches_urllib_error():
    """旧实现必红：URLError 穿透。当前实现必绿：返回 (0, b'', dt)。"""
    def boom(*a, **kw):
        raise URLError(TimeoutError("SSL handshake timed out"))

    with patch("health_probe.urllib.request.urlopen", side_effect=boom):
        st, raw, dt = hp._sb_request("/rest/v1/eh_rooms?select=id&limit=1", "fakekey")

    assert st == 0, f"expected st=0 for network failure, got {st}"
    assert raw == b"", f"expected empty body, got {raw!r}"
    assert isinstance(dt, float) and dt >= 0, f"expected non-negative float dt, got {dt!r}"
    print("✓ test_sb_request_catches_urllib_error PASSED")


def test_sb_request_catches_socket_timeout():
    """socket.timeout 同属网络层瞬时错误，不应穿透。"""
    def boom(*a, **kw):
        raise socket_timeout("timed out")

    with patch("health_probe.urllib.request.urlopen", side_effect=boom):
        st, raw, dt = hp._sb_request("/rest/v1/eh_rooms?select=id&limit=1", "fakekey")

    assert st == 0, f"expected st=0, got {st}"
    print("✓ test_sb_request_catches_socket_timeout PASSED")


def test_sb_request_still_passes_http_error():
    """HTTPError 必须仍走原路径（返回真实 HTTP 状态码），不能被新 except 拦截。"""
    import urllib.error, io

    fake_resp = MagicMock()
    fake_resp.read.return_value = b'{"error":"unauthorized"}'
    err = urllib.error.HTTPError(
        url="http://x", code=401, msg="Unauthorized",
        hdrs=MagicMock(), fp=io.BytesIO(b'{"error":"unauthorized"}')
    )

    with patch("health_probe.urllib.request.urlopen", side_effect=err):
        st, raw, dt = hp._sb_request("/rest/v1/eh_rooms?select=id&limit=1", "fakekey")

    assert st == 401, f"expected st=401 for HTTPError, got {st}"
    print("✓ test_sb_request_still_passes_http_error PASSED")


def test_business_readonly_retries_on_st0():
    """probe_business_readonly 里 RPC 调用遇到 st==0 应即时重试。"""
    call_count = {"n": 0}
    # 先用一个成功的 _public_anon_key
    fake_key = "test-anon-key"

    def fake_sb_request(path, key, body=None, method=None, timeout=None):
        call_count["n"] += 1
        name = path.split("/")[-1]
        if "eh_public_recent" in path:
            # 第一次 st==0（模拟网络抖动），第二次正常
            if call_count["n"] <= 1:
                return 0, b"", 5.0
            return 200, json.dumps([{"id": "msg1"}, {"id": "msg2"}]).encode(), 1.2
        if "eh_room_souls" in path:
            return 200, json.dumps([{"name": "s1"}]).encode(), 1.0
        if "eh_rooms" in path:
            return 200, json.dumps([{"id": "room1", "name": "test", "kind": "official"}]).encode(), 0.5
        # edge functions / songs / etc
        if "/functions/" in path:
            if "eh-auth" in path: return 400, b"", 0.5
            if "eh-soul-tick" in path: return 200, b"", 0.5
            return 401, b"", 0.5
        if "/rest/v1/eh_rooms" in path:
            return 200, json.dumps([{"id":"room1","name":"test","kind":"official"}]).encode(), 0.5
        if "eh_public_songs" in path:
            return 200, json.dumps([]).encode(), 0.5
        return 200, b"", 0.5

    def fake_get(url, timeout=None):
        if "ver.txt" in url:
            return 200, b"test-ver", 0.1
        if "index.html" in url:
            return 200, b'<div id="hall">ok</div><script>BUILD_VER="test-ver"</script>', 0.1
        if "sw.js" in url:
            return 200, b"var SW_VERSION='eh-sw-v123-test-ver';", 0.1
        if "app.js" in url:
            return 200, b'var SB_ANON="test-anon-key";', 0.1
        if "manifest.json" in url:
            return 200, json.dumps({"items": []}).encode(), 0.1
        return 200, b"", 0.1

    with patch("health_probe._public_anon_key", return_value=fake_key), \
         patch("health_probe._sb_request", side_effect=fake_sb_request), \
         patch("health_probe._get", side_effect=fake_get):
        issues, info = hp.probe_business_readonly()

    # 重试后 eh_public_recent 应该成功（st=200），不应出现在 issues 里
    recent_info = info.get("eh_public_recent", {})
    assert recent_info.get("http") == 200, f"expected retry success http=200, got {recent_info}"
    recent_issues = [i for i in issues if "eh_public_recent" in i]
    assert len(recent_issues) == 0, f"retry should have recovered, but got issues: {recent_issues}"
    print("✓ test_business_readonly_retries_on_st0 PASSED")


if __name__ == "__main__":
    test_sb_request_catches_urllib_error()
    test_sb_request_catches_socket_timeout()
    test_sb_request_still_passes_http_error()
    test_business_readonly_retries_on_st0()
    print("\n✅ All 4 tests PASSED")
