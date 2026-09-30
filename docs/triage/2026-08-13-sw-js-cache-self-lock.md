# 诊断单: 作曲持续 401 — SW/JS 缓存自锁导致新前端换不上

- 日期: 2026-08-13 15:40 CST
- 报告人: 用户(热血狼, uid 9da0cb44-...)"退出之后也不行"
- 现象: 15:37/14:57 多次点作曲, 线上 eh-bgm-gen 全部 POST 401, OPTIONS 200

## 单一根因假设

前端令牌鉴权(commit 572a9bb)已上线且后端已强制鉴权, 但用户浏览器仍在跑**旧版 app.js**,
请求不带 Authorization → 后端 401。旧 JS 换不上的机制是**缓存自锁**:

1. `sw.js`: `js/*.js` 走 `JS_CACHE`(cache-first, 永久, 故意不随 SW_VERSION 清), 只按 URL `?v=` 指纹区分。
2. 换代要靠 `index.html` 引用新指纹 `app.js?v=20260813-audioauth` 才会 miss→下载新版。
3. 但 `index.html` 属 `SHELL_CACHE`; 若旧 SW 未 activate, 页面拿到的仍是旧 `index.html` → 仍引用旧指纹 → 命中旧 `app.js`。
4. 小米/移动浏览器对 SW 更新不积极, `reg.update()` 可能长时间不换代 → **自锁**。

## 证据

- 线上日志: 15:37:23 / 15:37:12 / 14:58:20 / 14:57:21 / 14:57:15 / 14:57:05 POST 均 401, OPTIONS 均 200。
- `n_bgm_today=0`: 没有任何一次请求走到落库, 全部卡在鉴权前。
- 401 目前无法区分"无 Authorization 头(旧 JS)"与"token 失效(新 JS)"——后端两分支都返 401。

## 单变量修复

只动缓存换代链, 不碰鉴权逻辑本身:

1. **后端 401 可区分**: `auth_required`(无头) vs `invalid_token`(有头无效)。已是两个 error 值,
   仅需确保日志能读到 → 保持现状, 加一次带标记的复现。
2. **前端换代硬保险**: `js/*.js` 的 `JS_CACHE` 命中前, 若请求指纹 `?v=` 与当前 `SW_VERSION`
   内嵌的 BUILD_VER 不一致, 强制走网络(network-first)而非吃旧缓存。让"新 SW 一旦 activate,
   旧指纹 JS 立即失效"。
3. **index.html 始终 network-first**(已是), 保证换代后引用新指纹。

## 验证

- 部署后拉线上 `sw.js` 确认新逻辑存在。
- 用户重开一次, 线上日志出现 200(成功)或 `invalid_token`(登录态问题, 另行处理)即证换代成功。
- CI: `bash scripts/ci-check.sh` 全绿; 版本三处同步。
