#!/usr/bin/env bash
# 用法: ./bump-version.sh v19
# 一次性更新所有版本号，避免漏改

set -e

if [ -z "$1" ]; then
  echo "用法: ./bump-version.sh <版本号后缀，如 v19>"
  exit 1
fi

DATE=$(date +%Y%m%d)
NEW_VER="${DATE}-$1"
SW_VER="eh-sw-v550-${NEW_VER}"

echo "新版本号: $NEW_VER"

# 1. ver.txt
echo "$NEW_VER" > ver.txt

# 2. sw.js: SW_VERSION
sed -i "s/const SW_VERSION = 'eh-sw-v550-[^']*'/const SW_VERSION = '${SW_VER}'/" sw.js

# 3. index.html: BUILD_VER
sed -i "s/var BUILD_VER='[^']*'/var BUILD_VER='${NEW_VER}'/" index.html

# 4. index.html: ?v= 指纹（所有 ?v=YYYYMMDD-vXX 替换）
sed -i "s/?v=[0-9]\{8\}-v[0-9]*/?v=${NEW_VER}/g" index.html

echo "完成！请检查后 git add -A && git commit -m 'chore: bump version to ${NEW_VER}' && git push"
