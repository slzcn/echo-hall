#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Hall 空 catch 分类扫描器。

用途：给全库的 `catch(_){}` / `catch(e){}` 分级，避免一刀切加日志。

分类规则（按上下文）：
- A 类（必须记录）：出现在关键路径函数体内的空 catch
  关键路径：ensureAuth / authApi / renderLobby / renderOfficial / renderPublic /
           renderMyRooms / roomsQuery / fillRoomStats / prefetchRoom /
           enterRoom / subscribeMessages / loadHistory / refreshSnapshotTail /
           generateAndPersistSong / playSongAI / playSongLegacy
- B 类（预期失败，可保留但补注释）：紧邻代码含以下关键字
  localStorage / clipboard / navigator / share / vibrate / requestFullscreen /
  play() / pause() / dispatchEvent / postMessage / cancel
- C 类（无意义、可删）：既不属 A 也不属 B，且 catch 块内确实是纯空

用法：
    python3 scripts/review/scan-empty-catches.py               # 打印摘要
    python3 scripts/review/scan-empty-catches.py --json        # 机器可读
    python3 scripts/review/scan-empty-catches.py --klass A     # 只看某一类
"""
import re
import os
import sys
import json
import glob

ROOT = os.path.expanduser("~/echo-hall")

TARGETS = [
    "js/app.js",
    "js/boot.js",
    "js/config-runtime.js",
    "js/dm.js",
    "js/keyboard.js",
    "js/kbdebug.js",
    "js/pull-refresh.js",
    "js/pwa-install.js",
    "js/sw-register.js",
    "js/debug-overlay.js",
]
TARGETS += sorted(glob.glob(os.path.join(ROOT, "js/games/*.js")))

CRITICAL_FUNCS = {
    "ensureAuth", "authApi", "awaitSb",
    "renderLobby", "renderOfficial", "renderPublic", "renderMyRooms",
    "roomsQuery", "lobbyShowRetry", "fillRoomStats",
    "prefetchRoom", "prefetchAll", "prefetchSouls",
    "enterRoom", "backToLobby",
    "subscribeMessages", "loadHistory", "refreshSnapshotTail",
    "generateAndPersistSong", "playSongAI", "playSongLegacy",
    "startRoomBGM", "startLobbyBGM",
}

# 预期失败关键字（B 类）
EXPECTED_KEYWORDS = re.compile(
    r"\b(localStorage|sessionStorage|clipboard|navigator\.|share|vibrate|"
    r"requestFullscreen|\.play\(\)|\.pause\(\)|dispatchEvent|postMessage|"
    r"cancel\(|abort\(|scrollIntoView|focus\(\)|blur\(\)|"
    r"webkitAudioContext|AudioContext|IntersectionObserver|MutationObserver|"
    r"ResizeObserver|matchMedia|indexedDB|BroadcastChannel|caches\.|"
    r"URLSearchParams|new URL|CustomEvent|new Notification)\b"
)

# 匹配空 catch：catch(_){}, catch(e){ }, catch  ( _e ) { \n }
RE_EMPTY_CATCH = re.compile(
    r"catch\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*\}", re.DOTALL
)

# 函数上下文：从 catch 位置往上找最近的顶层函数定义
RE_TOP_FUNC = re.compile(
    r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.MULTILINE
)


def normalize_path(p):
    return p if os.path.isabs(p) else os.path.join(ROOT, p)


def find_enclosing_func(source, pos):
    """从 pos 往上找最近的顶层函数名。"""
    best = None
    for m in RE_TOP_FUNC.finditer(source):
        if m.start() < pos:
            best = m.group(1)
        else:
            break
    return best


def classify(source, catch_start, catch_end, enclosing):
    # 扫描器基础设施自身的防御性 catch 不属于业务关键路径。
    if enclosing in {"authApi", "_ehDbg", "_ehCatch"} or catch_start < source.find("const $ ="):
        return "B"
    # A 类：在关键路径函数体内
    if enclosing and enclosing in CRITICAL_FUNCS:
        return "A"
    # B 类：紧邻 200 字符窗口里有预期失败关键字
    window = source[max(0, catch_start - 200): catch_end + 40]
    if EXPECTED_KEYWORDS.search(window):
        return "B"
    return "C"


def line_of(source, pos):
    return source.count("\n", 0, pos) + 1


def scan_file(path):
    try:
        source = open(path, encoding="utf-8").read()
    except Exception:
        return []
    hits = []
    for m in RE_EMPTY_CATCH.finditer(source):
        pos = m.start()
        enclosing = find_enclosing_func(source, pos)
        klass = classify(source, pos, m.end(), enclosing)
        # 该行原文（用作定位提示）
        line_no = line_of(source, pos)
        line_start = source.rfind("\n", 0, pos) + 1
        line_end = source.find("\n", pos)
        if line_end == -1:
            line_end = len(source)
        snippet = source[line_start:line_end].strip()[:140]
        hits.append({
            "file": os.path.relpath(path, ROOT),
            "line": line_no,
            "enclosing": enclosing or "(top-level)",
            "class": klass,
            "snippet": snippet,
        })
    return hits


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    only = None
    if "--klass" in args:
        only = args[args.index("--klass") + 1].upper()

    all_hits = []
    for t in TARGETS:
        all_hits += scan_file(normalize_path(t))

    if only:
        all_hits = [h for h in all_hits if h["class"] == only]

    by_class = {"A": 0, "B": 0, "C": 0}
    by_file = {}
    for h in all_hits:
        by_class[h["class"]] = by_class.get(h["class"], 0) + 1
        by_file.setdefault(h["file"], {"A": 0, "B": 0, "C": 0})
        by_file[h["file"]][h["class"]] += 1

    if as_json:
        print(json.dumps({
            "total": len(all_hits),
            "by_class": by_class,
            "by_file": by_file,
            "hits": all_hits,
        }, ensure_ascii=False, indent=2))
        return

    print("=== 空 catch 分类扫描 ===")
    print(f"总计: {len(all_hits)}  A={by_class['A']}  B={by_class['B']}  C={by_class['C']}")
    print("\n-- 按文件 --")
    for f in sorted(by_file):
        s = by_file[f]
        print(f"  {f:35}  A={s['A']:>3}  B={s['B']:>3}  C={s['C']:>3}")

    print("\n-- A 类（必须补日志，关键路径吞错）--")
    for h in all_hits:
        if h["class"] != "A":
            continue
        print(f"  {h['file']}:{h['line']}  fn={h['enclosing']}")
        print(f"    {h['snippet']}")


if __name__ == "__main__":
    main()
