#!/usr/bin/env bash
# 用法: ./bump-version.sh v19
# 一次性更新所有版本号，避免漏改。
# ★SW 模式串不得写死 eh-sw-v550- — 当前线上海量已到 v642+，写死后 sed 不命中且静默跳过
#   会只改 ver.txt/index 而 SW 不换代(C6)。改为正则匹配任意 eh-sw-v<数字>-，未命中即失败。

set -euo pipefail

if [ -z "${1:-}" ]; then
  echo "用法: ./bump-version.sh <版本号后缀，如 v19>"
  exit 1
fi

DATE=$(date +%Y%m%d)
NEW_VER="${DATE}-$1"
# 从现有 SW_VERSION 抽出序号并 +1；抽不到则沿用模式占位并警告
CUR_SW_LINE=$(grep -E "const SW_VERSION = 'eh-sw-v[0-9]+-" sw.js | head -1 || true)
if [ -z "$CUR_SW_LINE" ]; then
  echo "错误: sw.js 未找到 SW_VERSION = 'eh-sw-vNNN-...' 模式" >&2
  exit 1
fi
CUR_NUM=$(echo "$CUR_SW_LINE" | sed -E "s/.*eh-sw-v([0-9]+)-.*/\1/")
if [ -z "$CUR_NUM" ]; then
  echo "错误: 无法从 SW_VERSION 解析序号: $CUR_SW_LINE" >&2
  exit 1
fi
NEW_NUM=$((CUR_NUM + 1))
SW_VER="eh-sw-v${NEW_NUM}-${NEW_VER}"

echo "新版本号: $NEW_VER"
echo "SW 版本:  $SW_VER (v${CUR_NUM} → v${NEW_NUM})"

fail_if_unchanged() {
  local file="$1" pattern="$2" label="$3"
  if ! grep -qE "$pattern" "$file"; then
    echo "错误: ${file} 中未找到 ${label} (pattern: ${pattern})" >&2
    exit 1
  fi
}

# 1. ver.txt
echo "$NEW_VER" > ver.txt

# 2. sw.js: SW_VERSION（任意 eh-sw-vN- 前缀）
fail_if_unchanged sw.js "const SW_VERSION = 'eh-sw-v[0-9]+-" "SW_VERSION"
sed -i '' -E "s/const SW_VERSION = 'eh-sw-v[0-9]+-[^']*'/const SW_VERSION = '${SW_VER}'/" sw.js
grep -q "const SW_VERSION = '${SW_VER}'" sw.js || { echo "错误: sw.js SW_VERSION 未写入 ${SW_VER}" >&2; exit 1; }

# 3. index.html: BUILD_VER
fail_if_unchanged index.html "var BUILD_VER='" "BUILD_VER"
sed -i '' -E "s/var BUILD_VER='[^']*'/var BUILD_VER='${NEW_VER}'/" index.html
grep -q "var BUILD_VER='${NEW_VER}'" index.html || { echo "错误: index.html BUILD_VER 未写入" >&2; exit 1; }

# 4. index.html: ?v= 指纹
sed -i '' -E "s/\?v=[0-9]{8}-v[0-9]*/?v=${NEW_VER}/g" index.html

# 5. js/app.js: __EH_APP_VER（与 BUILD_VER / app.js?v= 三方一致, CI 3b 门禁）
if grep -q "__EH_APP_VER" js/app.js; then
  sed -i '' -E "s/window\.__EH_APP_VER = '[^']*'/window.__EH_APP_VER = '${NEW_VER}'/" js/app.js
  grep -q "__EH_APP_VER = '${NEW_VER}'" js/app.js || { echo "错误: app.js __EH_APP_VER 未写入" >&2; exit 1; }
  echo "已同步 __EH_APP_VER = ${NEW_VER}"
else
  echo "警告: js/app.js 无 __EH_APP_VER，跳过（CI 3b 可能失败）" >&2
fi

echo "完成！请检查后 git add -A && git commit -m 'chore: bump version to ${NEW_VER}' && git push"
