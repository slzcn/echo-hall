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
#   1c. Edge Function 安全不变量（鉴权 / 越权 / 输入边界）
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
# 1c. Edge Function 安全不变量
# ─────────────────────────────────────────
section "1c. Edge Function 安全不变量"

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
  # 简单分领域：keyboard=index.html 里 kb/vv 区域；bgm=bgm 关键词；pwa=sw.js/manifest；db=sql/
  # 这里只做一个粗糙提示：如果 index.html + sw.js + sql/ 都动了，很可能又是「混合提交」
  hit_index=$(echo "$CHANGED" | grep -c '^index\.html$' || true)
  hit_sw=$(echo "$CHANGED"    | grep -c '^sw\.js$'      || true)
  hit_sql=$(echo "$CHANGED"   | grep -c '^sql/'          || true)
  hit_admin=$(echo "$CHANGED" | grep -c '^admin\.html$'  || true)
  domains=$(( (hit_index>0) + (hit_sw>0) + (hit_sql>0) + (hit_admin>0) ))
  if [ "$domains" -ge 3 ]; then
    fail "本次 diff 同时触碰 $domains 个领域（index/sw/sql/admin）— 拆分成原子提交"
  else
    pass "本次 diff 触碰 $domains 个领域（≤2 视为原子提交）"
  fi
else
  pass "本地运行，跳过 diff 范围检查（CI 环境会启用）"
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
