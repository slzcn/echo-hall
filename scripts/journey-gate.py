#!/usr/bin/env python3
"""
journey_gate.py — 用户旅程视角门（改代码前 / 提交前的强制阻塞检查）

对治 anti-pattern: 只测功能点，不测用户旅程
(memory/anti-patterns/2026-08-13-only-test-functions-not-journeys.md)

设计原则：
- 这不是"提醒器"，是"防线"。命中旅程维度但没有对应 journey 测试 / 显式豁免 = exit 1。
- 命中触发词自动识别（不依赖交互），CI / pre-commit 都能用。
- 允许显式豁免：改动的 diff 里包含 `journey-exempt: <理由>`，或提交里带 triage 文档说明。

用法：
  # 检查工作树里的 staged/暂存改动
  python3 scripts/verify/journey_gate.py --repo <repo_root>
  # 或指定 diff 范围
  python3 scripts/verify/journey_gate.py --repo <repo_root> --diff-range HEAD~1..HEAD
  # 交互式：改动前先问自己 4 题（人工模式）
  python3 scripts/verify/journey_gate.py --interactive <topic>

退出码：
  0 = 不命中旅程维度 或 命中且已有 journey 测试/豁免
  1 = 命中旅程维度但缺失 journey 测试和豁免（阻止提交）
  2 = 用法错误
"""
import sys, os, re, subprocess, argparse
from pathlib import Path

def color(s, c):
    codes = {'r':91, 'g':92, 'y':93, 'b':94, 'c':96, 'w':97, 'gray':90, 'bold':1}
    if not sys.stdout.isatty():
        return s
    return f"\033[{codes.get(c,97)}m{s}\033[0m"

# 触发词库：改动内容出现任一即认为命中旅程维度
# 分类是为了解释，不影响判定
TRIGGERS = {
    '身份/登录/权限': [
        r'\brollIdentity\b', r'\bsignInAnonymously\b', r'\bensureAuth\b',
        r'\bloadOrRollIdentity\b', r'\bpaintIdentity\b', r'\bregistered\b',
        r'\busername\b.*=', r'\bme\.name\b', r'\bmyUid\b',
    ],
    'UI 可见状态': [
        r"textContent\s*=", r"innerText\s*=", r"placeholder\s*=",
        r"toast\(", r"classList\.(add|remove|toggle)\(['\"](disabled|loading|active|on)",
        r'data-action\s*=', r'setAttribute\(["\']disabled',
    ],
    '异步/等待/生成': [
        r'\bsendBgm\w*\b', r'\bgenerating\b', r'\bawait\s+fetch\b',
        r'setTimeout\(', r'setInterval\(', r'\.then\(', r'\bPromise\b',
        r'\bpolling\b', r'\bupload\w*\b', r'\bfinally\s*{',
    ],
    '重试/防重复': [
        r'\bretry\b', r'\b_ehBgm\w*\b', r'\bidempotent\b',
        r'if\s*\(.*ing\)', r'return.*already',
    ],
    '房间/切换/多入口': [
        r'\bswitchRoom\b', r'\bbuildBgmMenu\b', r'\bbuildRoom\w*\b',
        r'\bstorage\s+event\b', r"'storage'", r'\bBroadcastChannel\b',
    ],
}

QUESTIONS = [
    ('前后一致性', '改动前用户看到 X，改动后 X 应该保持一致吗？(身份/名字/主题/选中项)'),
    ('状态转换',   '这个操作有中间态吗？(生成中/上传中/等待中) 用户能看到吗？'),
    ('异步反馈',   '这个操作要等超过 500ms 吗？没反馈用户会重复点吗？'),
    ('多入口一致', '这个东西在几个地方显示？改一处其他会不会脱节？'),
]

EXEMPT_MARKER = 'journey-exempt:'


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r.returncode, r.stdout, r.stderr


def get_diff(repo, diff_range):
    if diff_range:
        rc, out, err = run(['git', 'diff', diff_range, '--unified=0'], cwd=repo)
    else:
        rc, out, err = run(['git', 'diff', '--cached', '--unified=0'], cwd=repo)
        if not out.strip():
            # 未 stage：退回工作树 diff
            rc, out, err = run(['git', 'diff', '--unified=0'], cwd=repo)
    if rc != 0:
        print(color(f'git diff 失败: {err}', 'r'))
        sys.exit(2)
    return out


def get_changed_files(repo, diff_range):
    if diff_range:
        rc, out, _ = run(['git', 'diff', '--name-only', diff_range], cwd=repo)
    else:
        rc, out, _ = run(['git', 'diff', '--cached', '--name-only'], cwd=repo)
        if not out.strip():
            rc, out, _ = run(['git', 'diff', '--name-only'], cwd=repo)
    return [x for x in out.strip().split('\n') if x]


def scan_triggers(diff_text):
    """只扫描生产代码文件的新增行，返回 (category, pattern, sample_line)。

    文档、测试和门禁脚本本身不触发，否则写一份 triage 也会误报需要 journey。
    """
    production = (
        re.compile(r'^(?:index|admin)\.html$'),
        re.compile(r'^js/.*\.js$'),
        re.compile(r'^sw\.js$'),
        re.compile(r'^supabase/functions/.*\.(?:ts|js)$'),
    )
    hits = []
    current_file = ''
    for line in diff_text.split('\n'):
        if line.startswith('+++ b/'):
            current_file = line[len('+++ b/'):]
            continue
        if not current_file or not any(p.search(current_file) for p in production):
            continue
        if not line.startswith('+') or line.startswith('+++'):
            continue
        content = line[1:]
        for cat, patterns in TRIGGERS.items():
            for pat in patterns:
                if re.search(pat, content):
                    hits.append((cat, pat, f'{current_file}: {content.strip()[:100]}'))
                    break  # 每行每类只算一次
    return hits


def check_journey_coverage(repo, changed_files, diff_text):
    """检查提交里是否有 journey-*.js 新增/修改，或明确豁免"""
    journey_touched = [f for f in changed_files if re.search(r'journey[-_].*\.(js|py|ts)$', f)]
    exempt_reasons = re.findall(EXEMPT_MARKER + r'\s*(.+)', diff_text)
    # 也检查 triage 文档
    triage = [f for f in changed_files if 'triage/' in f and f.endswith('.md')]
    return {
        'journey_files': journey_touched,
        'exempt': exempt_reasons,
        'triage': triage,
    }


def interactive_mode(topic):
    print()
    print(color('═'*70, 'c'))
    print(color(f'  用户旅程视角门 (人工模式): {topic}', 'bold'))
    print(color('═'*70, 'c'))
    print()
    triggered = []
    for i, (tag, q) in enumerate(QUESTIONS, 1):
        print(color(f'━━━ 问题 {i}/4: {tag} ━━━', 'c'))
        print(color(f'   {q}', 'w'))
        while True:
            ans = input(color('   命中吗？(y/n): ', 'y')).strip().lower()
            if ans in ('y', 'n'):
                break
        if ans == 'y':
            evidence = ''
            while not evidence:
                evidence = input(color('   一句证据(用户看到什么): ', 'y')).strip()
            triggered.append((tag, evidence))
        print()
    if not triggered:
        print(color('  ✓ 4 项都不涉及用户旅程', 'g'))
        return 0
    print(color(f'  ⚠ 命中 {len(triggered)} 项，必须新增 journey 测试或写显式豁免:', 'r'))
    for tag, ev in triggered:
        print(color(f'    · [{tag}] {ev}', 'y'))
    print()
    print(color('  在 diff 里添加 "journey-exempt: <理由>" 或提交对应的 journey-*.js 测试', 'y'))
    return 1


def scan_mode(repo, diff_range):
    diff_text = get_diff(repo, diff_range)
    if not diff_text.strip():
        print(color('  没有 diff，跳过旅程门', 'gray'))
        return 0
    changed = get_changed_files(repo, diff_range)
    hits = scan_triggers(diff_text)
    coverage = check_journey_coverage(repo, changed, diff_text)

    print()
    print(color('═'*70, 'c'))
    print(color('  journey_gate 扫描结果', 'bold'))
    print(color('═'*70, 'c'))
    print(color(f'  改动文件数: {len(changed)}', 'w'))
    print(color(f'  命中旅程触发词: {len(hits)}', 'y' if hits else 'gray'))

    if not hits:
        print(color('  ✓ 未命中任何旅程触发词，通过', 'g'))
        return 0

    by_cat = {}
    for cat, pat, sample in hits:
        by_cat.setdefault(cat, []).append((pat, sample))
    print()
    for cat, items in by_cat.items():
        print(color(f'  [{cat}] {len(items)} 处', 'y'))
        for pat, sample in items[:3]:
            print(color(f'    · {sample}', 'gray'))
        if len(items) > 3:
            print(color(f'    ... 另外 {len(items)-3} 处', 'gray'))

    print()
    print(color('  覆盖检查:', 'c'))
    ok = False
    if coverage['journey_files']:
        print(color(f'    ✓ 提交含 journey 测试: {coverage["journey_files"]}', 'g'))
        ok = True
    if coverage['exempt']:
        print(color(f'    ✓ 显式豁免: {coverage["exempt"]}', 'g'))
        ok = True
    if not ok:
        print(color('    ✗ 未发现 journey-*.js 测试改动，也未发现 "journey-exempt: <理由>" 标记', 'r'))
        print(color('    ✗ 此次改动命中用户旅程维度，禁止直接提交。', 'r'))
        print()
        print(color('    补救方式二选一：', 'y'))
        print(color('      1) 新增 scripts/journey-<topic>.js 覆盖上述维度', 'w'))
        print(color('      2) 在 diff 里加一行注释: journey-exempt: <理由>', 'w'))
        return 1

    print()
    print(color('  ✓ 旅程门通过', 'g'))
    return 0


def main():
    p = argparse.ArgumentParser(description='用户旅程视角门')
    p.add_argument('--repo', default='.', help='仓库根目录')
    p.add_argument('--diff-range', default='', help='git diff 范围，如 HEAD~1..HEAD')
    p.add_argument('--interactive', metavar='TOPIC', help='交互式模式')
    args = p.parse_args()

    if args.interactive:
        sys.exit(interactive_mode(args.interactive))

    repo = Path(args.repo).resolve()
    if not (repo / '.git').exists():
        print(color(f'  {repo} 不是 git 仓库', 'r'))
        sys.exit(2)
    sys.exit(scan_mode(str(repo), args.diff_range))


if __name__ == '__main__':
    main()
