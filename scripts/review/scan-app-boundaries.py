#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Echo Hall 重构基线扫描器 — 边界分析。

用途：在拆分 js/app.js 前后运行，客观记录代码边界，防止“靠感觉判断重构是否成功”。
不修改任何业务代码，纯静态分析。

产出：
- 顶层函数清单（名称 + 起始行 + 行数）
- 顶层全局变量清单（let/const/var + window.xxx=）
- 跨文件被引用的符号（哪些 app.js 函数被别处调用 = 拆分后必须保留的对外接口）
- 关键路径函数是否存在（renderLobby / ensureAuth / enterRoom 等）

用法：
    python3 scripts/review/scan-app-boundaries.py                # 打印摘要
    python3 scripts/review/scan-app-boundaries.py --json         # 机器可读
    python3 scripts/review/scan-app-boundaries.py --target js/app.js
"""
import re
import os
import sys
import json
import glob

ROOT = os.path.expanduser("~/echo-hall")

# 拆分后必须对外保留的关键路径函数（方案里点名的）
CRITICAL_FUNCS = [
    "ensureAuth", "authApi", "awaitSb",
    "renderLobby", "renderOfficial", "renderPublic", "renderMyRooms",
    "roomsQuery", "lobbyShowRetry", "fillRoomStats",
    "prefetchRoom", "prefetchAll",
    "enterRoom", "backToLobby",
    "subscribeMessages", "loadHistory", "refreshSnapshotTail",
    "initBgmUI", "buildBgmMenu", "setBgm", "startRoomBGM", "startLobbyBGM",
    "playSongAI", "playSongLegacy", "generateAndPersistSong",
]

# 匹配顶层函数定义（行首无缩进）
RE_TOP_FUNC = re.compile(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(")
# 匹配顶层 const/let/var 赋值（含箭头函数与普通值）
RE_TOP_VAR = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=")
# 匹配 const xxx = (async )?function(...) 或 const xxx = (...)=> 形式的函数
RE_TOP_CONST_FUNC = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)")
# 匹配 window.xxx = 挂载
RE_WIN_ASSIGN = re.compile(r"^\s*window\.([A-Za-z_$][\w$]*)\s*=")


def read_lines(path):
    with open(path, encoding="utf-8") as f:
        return f.readlines()


def scan_top_functions(lines):
    """扫描顶层函数：名称、起始行、粗略行数。

    用 finditer 遍历所有匹配点（不靠指针跳转），避免花括号计数失败时漏量后面的函数。
    行数估算不追求精确（因为深度回归只交付接口清单，不需要用行数做判断），
    仅作为“长函数排行榜”参考，允许 +/- 5行 的偏差。
    """
    funcs = []
    # 把所有行合并成带行号的行列表，方便定位
    src = "".join(lines)
    line_starts = [0]
    for line in lines:
        line_starts.append(line_starts[-1] + len(line))

    def pos_to_line(pos):
        # 二分查找
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= pos:
                lo = mid
            else:
                hi = mid - 1
        return lo + 1  # 1-based

    seen = set()  # (name, line) 去重
    # 预编译：多行模式、行首区分大小写
    combined_func = re.compile(r"^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(", re.MULTILINE)
    combined_const = re.compile(r"^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\s*\(|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)", re.MULTILINE)

    for regex in (combined_func, combined_const):
        for m in regex.finditer(src):
            name = m.group(1)
            start_line = pos_to_line(m.start())
            key = (name, start_line)
            if key in seen:
                continue
            seen.add(key)
            # 行数估算：从匹配行往后找下一个行首 "}"
            j = start_line
            depth = lines[start_line - 1].count("{") - lines[start_line - 1].count("}")
            while j < len(lines):
                if j > start_line - 1:
                    depth += lines[j].count("{") - lines[j].count("}")
                if depth <= 0 and "}" in lines[j]:
                    break
                j += 1
            funcs.append({"name": name, "line": start_line, "lines": max(1, j - start_line + 2)})

    funcs.sort(key=lambda x: x["line"])
    return funcs


def scan_globals(lines):
    top_vars, win_assigns = [], []
    for idx, line in enumerate(lines, 1):
        mv = RE_TOP_VAR.match(line)
        if mv:
            top_vars.append({"name": mv.group(1), "line": idx})
        mw = RE_WIN_ASSIGN.match(line)
        if mw:
            win_assigns.append({"name": mw.group(1), "line": idx})
    return top_vars, win_assigns


def scan_cross_refs(target_funcs, other_files):
    """统计 target 里定义的函数，被哪些其他文件引用（拆分后必须保留对外接口）。"""
    names = {f["name"] for f in target_funcs}
    refs = {}
    for f in other_files:
        try:
            text = open(f, encoding="utf-8").read()
        except Exception:
            continue
        for name in names:
            # 词边界调用/引用
            if re.search(r"\b" + re.escape(name) + r"\b", text):
                refs.setdefault(name, []).append(os.path.relpath(f, ROOT))
    return refs


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    target = "js/app.js"
    if "--target" in args:
        target = args[args.index("--target") + 1]
    target_path = os.path.join(ROOT, target)
    if not os.path.exists(target_path):
        print(f"目标不存在: {target_path}", file=sys.stderr)
        sys.exit(2)

    lines = read_lines(target_path)
    funcs = scan_top_functions(lines)
    top_vars, win_assigns = scan_globals(lines)

    # 其他 JS/HTML 文件（用于跨文件引用分析）
    others = [
        p for p in glob.glob(os.path.join(ROOT, "js/**/*.js"), recursive=True)
        if os.path.abspath(p) != os.path.abspath(target_path)
    ]
    others += glob.glob(os.path.join(ROOT, "*.html"))
    cross = scan_cross_refs(funcs, others)

    critical_present = {name: any(f["name"] == name for f in funcs) for name in CRITICAL_FUNCS}

    result = {
        "target": target,
        "total_lines": len(lines),
        "top_function_count": len(funcs),
        "top_var_count": len(top_vars),
        "window_assign_count": len(win_assigns),
        "longest_functions": sorted(funcs, key=lambda x: -x["lines"])[:15],
        "critical_funcs_present": critical_present,
        "cross_referenced_funcs": cross,
    }

    if as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"=== 边界扫描: {target} ===")
    print(f"总行数: {result['total_lines']}")
    print(f"顶层函数: {result['top_function_count']}  顶层变量: {result['top_var_count']}  window挂载: {result['window_assign_count']}")
    print("\n-- 最长的 15 个函数 --")
    for f in result["longest_functions"]:
        print(f"  {f['lines']:>4} 行  L{f['line']:<5} {f['name']}")
    print("\n-- 关键路径函数是否存在 --")
    for name, present in critical_present.items():
        mark = "OK" if present else "缺失"
        print(f"  [{mark}] {name}")
    print("\n-- 被其他文件引用的 app.js 函数(拆分后必须保留对外接口) --")
    for name, files in sorted(cross.items()):
        print(f"  {name}  <-  {', '.join(sorted(set(files)))}")
    if not cross:
        print("  (无跨文件引用)")


if __name__ == "__main__":
    main()
