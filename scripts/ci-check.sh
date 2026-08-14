#!/usr/bin/env bash
# Echo 最小 CI 门禁
# 用法：
#   bash scripts/ci-check.sh
# 退出码：
#   0  全绿
#   1+ 有检查未过（详见输出）
#
# 检查项（P1 最小可行门禁，全部零依赖或只依赖 Node/Python 标准工具）：
#   1. 内联 <script> JavaScript 语法检查（用 node --check）
#   1b. 主聊天输入法行为回归（composition / Enter）
#   1b2. 匿名登录名字保留行为回归
#   1b3. 作曲进度与曲名行为回归
#   1b4. 匿名首次进站完整旅程（旧错误实现反证）
#   1b5. BGM 作曲完整旅程（中间态/禁重入/成功失败恢复）
#   1b6. 主聊天输入法完整旅程（尾随 Enter / 菜单协同 / 高度恢复）
#   1b7. 私密房历史触顶自动续载旅程
#   1b8. 公开房预取后自动补齐最近 500 条旅程
#   1c. BGM 鉴权行为回归（令牌门禁 / 401 单次刷新）
#   1d. Edge Function 安全不变量（鉴权 / 越权 / 输入边界）
#   2. BUILD_VER (index.html) == ver.txt 内容
#   3. SW_VERSION (sw.js) 与 BUILD_VER 一致
#   4. index.html / admin.html 里已知重复 DOM ID 数量没上涨（回归监控）
#   5. innerHTML= / setTimeout / addEventListener 数量没爆炸性增长（回归监控）
#   6. commit 范围检查（只在 CI 环境跑）：本次 diff 是否触碰 >2 个业务领域

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

FAIL=0
warn() { printf '  \033[33m⚠\033[0m %s\n' "$*"; }
pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }
section() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ─────────────────────────────────────────
# 1. 内联 <script> 语法检查
# ─────────────────────────────────────────
section "1. 内联 <script> JavaScript 语法检查"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装（本地：brew install node；CI：actions/setup-node）"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT

  python3 - "$TMP" <<'PY'
import re, sys, pathlib
outdir = pathlib.Path(sys.argv[1])
files = ['index.html', 'admin.html']
manifest = []
for html in files:
    p = pathlib.Path(html)
    if not p.exists():
        continue
    src = p.read_text(encoding='utf-8', errors='replace')
    # 只抓不带 src 的 <script>...</script>
    pat = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)</script>', re.IGNORECASE)
    idx = 0
    for m in pat.finditer(src):
        code = m.group(1).strip()
        if not code:
            continue
        # 跳过 application/json 或 module template 等非 JS
        head = src[max(0, m.start()-200):m.start()]
        if re.search(r'type=["\'](?!(text/javascript|module|application/javascript))', head):
            continue
        idx += 1
        # 用 IIFE 包一层，避免顶层 return / await 之类的假报错，同时保留原声明的报错行号
        wrapper = f'void async function _ci_wrap_{idx}(){{\n{code}\n}}();\n'
        out = outdir / f'{html.replace(".","_")}__{idx}.js'
        out.write_text(wrapper, encoding='utf-8')
        manifest.append(str(out))
(outdir / 'manifest.txt').write_text('\n'.join(manifest), encoding='utf-8')
print(f'extracted {len(manifest)} inline script blocks')
PY

  BAD=0
  while IFS= read -r js; do
    [ -z "$js" ] && continue
    if ! node --check "$js" 2>/tmp/echo-ci-node.err; then
      BAD=$((BAD+1))
      echo "  语法错误：$(basename "$js")"
      sed 's/^/    /' /tmp/echo-ci-node.err
    fi
  done < "$TMP/manifest.txt"

  while IFS= read -r js; do
    [ -z "$js" ] && continue
    if ! node --check "$js" 2>/tmp/echo-ci-node.err; then
      BAD=$((BAD+1))
      echo "  外部脚本语法错误：$js"
      sed 's/^/    /' /tmp/echo-ci-node.err
    fi
  done < <(find js -type f -name '*.js' 2>/dev/null | sort)

  if [ "$BAD" -eq 0 ]; then
    pass "所有内联与本地外部 JavaScript 语法检查通过"
  else
    fail "$BAD 个 JavaScript 语法错误"
  fi
fi

# ─────────────────────────────────────────
# 1b. 主聊天输入法行为回归
# ─────────────────────────────────────────
section "1b. 主聊天输入法行为回归"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行输入法行为测试"
elif node scripts/test-composer-ime.js; then
  pass "composition / Enter / 菜单抢键 7 项行为回归通过"
else
  fail "主聊天输入法行为回归失败"
fi

# ─────────────────────────────────────────
# 1b2. 匿名登录名字保留行为回归
# ─────────────────────────────────────────
section "1b2. 匿名登录名字保留行为回归"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行匿名名字行为测试"
elif node scripts/test-anon-identity.js; then
  pass "匿名登录保留名字 / 残留正式账号重掷 6 项行为回归通过"
else
  fail "匿名名字行为回归失败"
fi

# ─────────────────────────────────────────
# 1b3. 作曲进度与曲名行为回归
# ─────────────────────────────────────────
section "1b3. 作曲进度与曲名行为回归"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行作曲进度与曲名行为测试"
elif node scripts/test-bgm-progress-title.js; then
  pass "作曲进度状态 / 曲名规范 10 项行为回归通过"
else
  fail "作曲进度与曲名行为回归失败"
fi

# ─────────────────────────────────────────
# 1b3d. 斗地主牌型引擎 + 局状态机 + AI 自对弈
# ─────────────────────────────────────────
section "1b3d. 斗地主游戏引擎"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行斗地主引擎测试"
elif node scripts/test-ddz-rules.js >/dev/null && node scripts/test-ddz-engine.js >/dev/null && node scripts/journey-ddz-play.js >/dev/null; then
  pass "斗地主牌型/比较 50 项 + 引擎/AI自对弈40局/回看重放 + /斗地主完整旅程 全部通过"
else
  fail "斗地主回归失败（牌型识别 / 状态机 / AI合法性 / replay一致性 / 命令旅程）"
fi

# ─────────────────────────────────────────
# 1b4. 匿名首次进站完整旅程
# ─────────────────────────────────────────
section "1b4. 匿名首次进站完整旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行匿名首次进站旅程测试"
elif node scripts/journey-anon-first-time.js; then
  pass "匿名首次进站 6 步旅程 + 旧错误实现反证通过"
else
  fail "匿名首次进站旅程回归失败"
fi

# ─────────────────────────────────────────
# 1b5. BGM 作曲完整旅程
# ─────────────────────────────────────────
section "1b5. BGM 作曲完整旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行 BGM 作曲旅程测试"
elif node scripts/journey-bgm-compose.js; then
  pass "BGM 中间态 / 禁重入 / 成功失败恢复 + 旧错误实现反证通过"
else
  fail "BGM 作曲完整旅程回归失败"
fi

# ─────────────────────────────────────────
# 1b6. 主聊天输入法完整旅程
# ─────────────────────────────────────────
section "1b6. 主聊天输入法完整旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行输入法完整旅程测试"
elif node scripts/journey-composer-ime.js; then
  pass "输入法尾随 Enter / 菜单协同 / 高度恢复 + 旧错误实现反证通过"
else
  fail "主聊天输入法完整旅程回归失败"
fi

# ─────────────────────────────────────────
# 1b7. 私密房历史触顶自动续载旅程
# ─────────────────────────────────────────
section "1b7. 私密房历史触顶自动续载旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行历史触顶旅程测试"
elif node scripts/journey-history-scroll.js; then
  pass "历史触顶自动续载 / 防重入 + 旧点击-only 实现反证通过"
else
  fail "私密房历史触顶自动续载旅程失败"
fi

# ─────────────────────────────────────────
# 1b8. 公开房预取后自动补齐最近 500 条旅程
# ─────────────────────────────────────────
section "1b8. 公开房最近 500 条自动补齐旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行公开房历史补齐旅程"
elif node scripts/journey-public-history-cap.js; then
  pass "预取 48 条后补齐 500 条 / 幂等 / 锚点 / 防串房 + 旧实现反证通过"
else
  fail "公开房最近 500 条自动补齐旅程失败"
fi

# ─────────────────────────────────────────
# 1b9. 正式用户改名跟随历史旅程
# ─────────────────────────────────────────
section "1b9. 正式用户改名跟随历史旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行改名跟随旅程测试"
elif node scripts/journey-rename-follow.js; then
  pass "在场改名历史跟随 / 匿名-离场定格 / 灵魂链隔离 + 断回补反证通过"
else
  fail "正式用户改名跟随历史旅程失败"
fi

# ─────────────────────────────────────────
# 1b10. 后台自定义身份名单昵称/用户名旅程
# ─────────────────────────────────────────
section "1b10. 后台身份名单可识别成员旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行后台身份名单旅程"
elif node scripts/journey-admin-tier-members.js; then
  pass "后台身份名单 7 步旅程 + UID-only 旧实现反证通过"
else
  fail "后台身份名单可识别成员旅程失败"
fi

# ─────────────────────────────────────────
# 1b11. 键盘收起残留清零旅程
# ─────────────────────────────────────────
section "1b11. 覆盖式键盘收起 estimatedKbH 清零旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行键盘收起残留旅程"
elif node scripts/journey-kb-collapse.js; then
  pass "键盘收起残留旅程通过：当前实现绿、空实现必红"
else
  fail "键盘收起残留旅程失败"
fi

# ─────────────────────────────────────────
# 1b16. 覆盖式键盘空 resize 旅程
# ─────────────────────────────────────────
section "1b16. 覆盖式键盘空 resize 保留估算旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行覆盖式键盘空 resize 旅程"
elif node scripts/journey-kb-overlay-empty-resize.js; then
  pass "覆盖式键盘空 resize 保留估算、真实缩高切真值，旧实现必红"
else
  fail "覆盖式键盘空 resize 旅程失败"
fi

# ─────────────────────────────────────────
# 1b17. 安卓折叠屏无信号 IME 安全余量旅程
# ─────────────────────────────────────────
section "1b17. 安卓折叠屏无信号 IME 安全余量旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行无信号 IME 安全余量旅程"
elif node scripts/journey-kb-ime-visual-gap.js; then
  pass "聊天室 / 私信无信号键盘估算余量 + 真实信号路径回归通过"
else
  fail "安卓折叠屏无信号 IME 安全余量旅程失败"
fi

# ─────────────────────────────────────────
# 1b12. 历史翻阅到顶终态旅程
# ─────────────────────────────────────────
section "1b12. 公开房封顶 / 私密房到最早终态旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行历史翻阅终态旅程"
elif node scripts/journey-history-end-state.js; then
  pass "公开房封顶 / 私密房到最早均有显式终态，旧静默实现必红"
else
  fail "历史翻阅终态旅程失败"
fi

# ─────────────────────────────────────────
# 1b13. 右侧抽屉无轨滚动旅程
# ─────────────────────────────────────────
section "1b13. 个人空间 / 房主设置 / 私信收件箱无轨滚动旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行抽屉滚动条旅程"
elif node scripts/journey-drawer-scrollbar.js; then
  pass "三个右侧抽屉仍可滚且跨浏览器隐藏轨道，旧实现必红"
else
  fail "右侧抽屉无轨滚动旅程失败"
fi

# ─────────────────────────────────────────
# 1b14. 横竖屏 VK 双减旅程
# ─────────────────────────────────────────
section "1b14. 键盘弹起中横竖屏切换 VK 双减旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行横竖屏 VK 双减旅程"
elif node scripts/journey-kb-orientation.js; then
  pass "未聚焦转屏 / 键盘弹起中转屏 / 收键盘刷新基线三场景通过，旧实现必红"
else
  fail "横竖屏 VK 双减旅程失败"
fi

# ─────────────────────────────────────────
# 1b15. 折叠屏键盘展开 / 收折旅程
# ─────────────────────────────────────────
section "1b15. 折叠屏键盘弹起时展开收折旅程"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行折叠屏键盘旅程"
elif node scripts/journey-kb-foldable.js; then
  pass "折叠屏展开重建基线、普通手机不污染、收折不双减、估算路径通过，旧实现必红"
else
  fail "折叠屏键盘展开收折旅程失败"
fi

# ─────────────────────────────────────────
# 1c. BGM 鉴权行为回归
# ─────────────────────────────────────────
section "1c. BGM 鉴权行为回归"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行 BGM 鉴权行为测试"
elif node scripts/test-bgm-auth.js; then
  pass "令牌门禁 / roomId / 401 单次刷新 7 项行为回归通过"
else
  fail "BGM 鉴权行为回归失败"
fi

# ─────────────────────────────────────────
# 1d. Edge Function 安全不变量
# ─────────────────────────────────────────
section "1d. Edge Function 安全不变量"

if ! command -v node >/dev/null 2>&1; then
  fail "node 未安装，无法运行 Edge 安全测试"
elif [ ! -f supabase/functions/eh-bgm-gen/index.ts ] || [ ! -f supabase/functions/eh-sing-cover/index.ts ]; then
  warn "私密 Edge Function 源码不在公开仓库；公开 CI 跳过，本地部署前必须运行 scripts/test-edge-auth.js"
elif node scripts/test-edge-auth.js; then
  pass "音频生成鉴权 / 越权 / 输入边界 11 项安全不变量通过"
else
  fail "Edge Function 安全不变量失败"
fi

# ─────────────────────────────────────────
# 2. BUILD_VER == ver.txt
# ─────────────────────────────────────────
section "2. BUILD_VER (index.html) == ver.txt"

if [ ! -f ver.txt ]; then
  fail "ver.txt 不存在"
else
  VER_TXT="$(tr -d '[:space:]' < ver.txt)"
  BUILD_VER="$(grep -oE 'BUILD_VER *= *["'\'']([^"'\'']+)' index.html | head -1 | sed -E 's/.*["'\'']//')"
  if [ -z "$BUILD_VER" ]; then
    fail "index.html 里没找到 BUILD_VER"
  elif [ "$BUILD_VER" = "$VER_TXT" ]; then
    pass "BUILD_VER=$BUILD_VER 与 ver.txt 一致"
  else
    fail "BUILD_VER=$BUILD_VER 与 ver.txt=$VER_TXT 不一致（提交前用一个脚本同步这两处）"
  fi
fi

# ─────────────────────────────────────────
# 3. SW_VERSION 与 BUILD_VER 一致
# ─────────────────────────────────────────
section "3. SW_VERSION (sw.js) 与 BUILD_VER 一致"

if [ ! -f sw.js ]; then
  warn "sw.js 不存在，跳过"
else
  SW_VERSION="$(grep -oE 'SW_VERSION *= *["'\'']([^"'\'']+)' sw.js | head -1 | sed -E 's/.*["'\'']//')"
  if [ -z "$SW_VERSION" ]; then
    fail "sw.js 里没找到 SW_VERSION"
  elif [ -z "${BUILD_VER:-}" ]; then
    warn "BUILD_VER 未知，跳过对比"
  elif printf '%s' "$SW_VERSION" | grep -qF "$BUILD_VER"; then
    pass "SW_VERSION=$SW_VERSION 已包含 BUILD_VER=$BUILD_VER 标记"
  else
    fail "SW_VERSION=$SW_VERSION 未包含 BUILD_VER=$BUILD_VER 标记（sw.js 发版时忘了跟 index.html 一起升 → 版本自愈死循环风险）"
  fi
fi

# ─────────────────────────────────────────
# 4. 重复 DOM ID 数量回归监控
# ─────────────────────────────────────────
section "4. 重复 DOM ID 数量（回归监控）"

# 基线：7/29 审计时点。任一 id 数量 > 基线 = 报警
python3 - <<'PY'
import re, sys, pathlib
baselines = {
    ('index.html', 'cntLed'): 3,
    ('index.html', 'meEmail'): 3,
}
warned = 0
for (fname, idname), base in baselines.items():
    p = pathlib.Path(fname)
    sources = [p, *sorted(pathlib.Path('js').glob('*.js'))] if fname == 'index.html' else [p]
    src = '\n'.join(x.read_text(encoding='utf-8', errors='replace') for x in sources if x.exists())
    hits = len(re.findall(r'''id=['"]''' + re.escape(idname) + r'''['"]''', src))
    if hits > base:
        print(f'  ✗ #{idname} 在 {fname} 出现 {hits} 次（基线 {base}）— 又新增了重复 ID 生成点')
        warned += 1
    else:
        print(f'  ✓ #{idname}: {hits} 次（≤ 基线 {base}）')
sys.exit(warned)
PY
if [ $? -ne 0 ]; then FAIL=$((FAIL+1)); fi

# ─────────────────────────────────────────
# 5. 危险 API 使用密度监控（爆炸性增长报警）
# ─────────────────────────────────────────
section "5. 危险 API 使用密度（回归监控）"

python3 - <<'PY'
import re, pathlib, sys
# 基线：7/29 审计时点 index.html；8/7 私信模块 dm.js 上线后 rebase innerHTML/addEventListener
baselines = {
    r'\.innerHTML\s*=': ('innerHTML=', 103, 10),
    r'\bsetTimeout\s*\(': ('setTimeout', 127, 15),
    r'\baddEventListener\s*\(': ('addEventListener', 108, 10),
    r'\.style\.\w+\s*=': ('element.style=', 131, 15),
}
sources = [pathlib.Path('index.html'), *sorted(pathlib.Path('js').glob('*.js'))]
src = '\n'.join(p.read_text(encoding='utf-8', errors='replace') for p in sources if p.exists())
warned = 0
for pat, (name, base, allow) in baselines.items():
    raw_hits = len(re.findall(pat, src))
    hits = raw_hits
    note = ''
    # compositionstart/end 两个监听器由 scripts/test-composer-ime.js 做行为回归，
    # 从“无语义的危险 API 密度”中扣除；不是放宽总阈值。
    if name == 'addEventListener':
        approved = len(re.findall(r"cin\.addEventListener\('composition(?:start|end)'", src))
        if approved != 2:
            print(f'  ✗ composition 行为门禁预期 2 个监听器，实际 {approved} 个')
            warned += 1
        hits = raw_hits - approved
        note = f'（原始 {raw_hits}，扣除行为测试覆盖的 composition {approved} 处）'
    limit = base + allow
    if hits > limit:
        print(f'  ✗ {name}: {hits} 处{note}（基线 {base}，允许 +{allow}，超限 {hits - limit}）')
        warned += 1
    else:
        print(f'  ✓ {name}: {hits} 处{note}（基线 {base}，上限 {limit}）')
sys.exit(warned)
PY
if [ $? -ne 0 ]; then FAIL=$((FAIL+1)); fi

# ─────────────────────────────────────────
# 6. 提交范围检查（CI-only）
# ─────────────────────────────────────────
section "6. 提交范围检查"

if [ "${CI:-}" = "true" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
  # 找出本次 push 触碰的文件
  BASE="${GITHUB_BASE_SHA:-HEAD~1}"
  if git rev-parse --verify "$BASE" >/dev/null 2>&1; then
    CHANGED="$(git diff --name-only "$BASE" HEAD)"
  else
    CHANGED="$(git diff --name-only HEAD~1 HEAD 2>/dev/null || true)"
  fi
  # 领域判定：版本同步只改 BUILD_VER / ADMIN_VER / SW_VERSION 时不算业务改动；
  # 一旦同一文件还包含真实业务行，仍按对应领域计数，避免用版本号掩盖混合提交。
  CHANGED_DIFF="$(git diff "$BASE" HEAD --unified=0 2>/dev/null || true)"
  readarray -t DOMAINS < <(python3 - "$CHANGED_DIFF" <<'PY'
import re, sys

diff=sys.argv[1]
current=''
meaningful={}
for line in diff.splitlines():
    if line.startswith('+++ b/'):
        current=line[6:]
        meaningful.setdefault(current, False)
        continue
    if not current or line.startswith(('+++','---','@@')):
        continue
    if not line.startswith(('+','-')):
        continue
    text=line[1:].strip()
    if not text:
        continue
    if current=='index.html' and re.fullmatch(r"(?:var\s+)?BUILD_VER\s*=\s*['\"][^'\"]+['\"]\s*;?", text):
        continue
    if current=='admin.html' and re.fullmatch(r"(?:var\s+)?ADMIN_VER\s*=\s*['\"][^'\"]+['\"]\s*;?", text):
        continue
    if current=='sw.js' and re.fullmatch(r"(?:const\s+)?SW_VERSION\s*=\s*['\"][^'\"]+['\"]\s*;?", text):
        continue
    if current in ('ver.txt','ver-admin.txt'):
        continue
    meaningful[current]=True

domains=[]
if meaningful.get('index.html'): domains.append('index')
if meaningful.get('sw.js'): domains.append('sw')
if any(meaningful.get(f,False) for f in meaningful if f.startswith('sql/')): domains.append('sql')
if meaningful.get('admin.html'): domains.append('admin')
print('\n'.join(domains))
PY
)
  domains=${#DOMAINS[@]}
  if [ "$domains" -ge 3 ]; then
    fail "本次 diff 同时触碰 $domains 个业务领域（index/sw/sql/admin）— 拆分成原子提交"
  else
    pass "本次 diff 触碰 $domains 个业务领域（版本同步文件不计入业务领域）"
  fi
else
  pass "本地运行，跳过 diff 范围检查（CI 环境会启用）"
fi

# ─────────────────────────────────────────
# 7. 用户旅程门（生产代码命中状态/异步/身份维度时强制 journey 覆盖）
# ─────────────────────────────────────────
section "7. 用户旅程覆盖门"

if [ ! -f scripts/journey-gate.py ]; then
  fail "scripts/journey-gate.py 缺失；能力门禁不能静默放行"
else
  if [ "${CI:-}" = "true" ] || [ -n "${GITHUB_ACTIONS:-}" ]; then
    JOURNEY_RANGE="${GITHUB_BASE_SHA:-HEAD~1}..HEAD"
    if python3 scripts/journey-gate.py --repo . --diff-range "$JOURNEY_RANGE"; then
      pass "本次生产代码改动满足用户旅程覆盖要求"
    else
      fail "本次生产代码命中用户旅程维度，但缺 journey 测试或明确豁免"
    fi
  else
    # 本地使用 staged/工作树 diff；没有 diff 时脚本会自行通过。
    if python3 scripts/journey-gate.py --repo .; then
      pass "本地改动满足用户旅程覆盖要求"
    else
      fail "本地改动命中用户旅程维度，但缺 journey 测试或明确豁免"
    fi
  fi
fi

# ─────────────────────────────────────────
section "结果"
if [ "$FAIL" -eq 0 ]; then
  printf '\033[32m全部检查通过 ✅\033[0m\n'
  exit 0
else
  printf '\033[31m有 %d 项检查未通过 ❌\033[0m\n' "$FAIL"
  printf '（本地：先修完再提交；CI：本次 push 被门禁挡下）\n'
  exit 1
fi
