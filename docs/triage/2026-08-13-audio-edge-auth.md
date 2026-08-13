# 音频生成 Edge Function 未鉴权与资源边界缺失

## §1 现象（Reproducibility）

- `eh-bgm-gen` 对无 `userId/roomKind/roomName` 的旧 payload 直接调用 MiniMax 并写 Storage，无需身份和每日额度。
- `eh-sing-cover` 所有 POST 路径均无需身份；任意 HTTPS 母版和大体积 base64 会被 Edge 拉取/解码并调用 MiniMax。
- 前端调用 `eh-sing-cover` 时未传当前用户访问令牌。

## §2 稳定复现

- 静态控制流可稳定证明：两个函数在鉴权前进入外部生成调用。
- 新增 `scripts/test-edge-auth.js` 校验安全不变量：鉴权函数存在且在生成前执行、旧 BGM 入口关闭、翻唱验证房间成员、前端传 Authorization、母版域名和大小受限。

## §3 单一根因假设

- **根因**：把浏览器 CORS 和 payload 中的 `userId` 当成授权边界，同时为兼容旧调用保留了匿名生成分支；安全约束没有成为统一入口中间件。
- **证伪实验**：所有 POST 在解析业务字段后、调用外部 API 前统一验证 JWT；匿名测试必须返回 401，错用户/非房间成员返回 403。

## §4 修复方案

- `eh-bgm-gen`：所有用户生成只接受已验证 JWT；关闭无身份旧接口。
- `eh-sing-cover`：统一 JWT 校验；带 `roomId` 时校验调用者是房间成员；限制 JSON/base64/远程音频大小；母版 URL 仅允许本站发布域；Storage 上传补 `apikey`。
- `js/app.js`：翻唱请求传当前 Supabase session access token。
- 不修改音频生成算法、歌词规则和 UI。

## §5 回归矩阵

| 场景 | 预期 |
|---|---|
| 无 Authorization | 401 |
| 错误/过期 token | 401 |
| payload.userId 与 JWT 不一致 | 403 |
| 非房间成员翻唱 | 403 |
| 旧 BGM payload | 410 |
| 非白名单 masterUrl | 400 |
| 超大 body/base64/远程音频 | 413 |
| 合法用户正常生成 | 保持原流程 |

## §6 提交约束

- 本提交只处理生成接口安全边界，不混房间竞态、视觉和架构重构。
- 前端资源指纹和三处版本同步。
- CI、静态安全不变量测试、TypeScript 语法/格式检查通过。

## §7 修后确认

- 待修复后回填。
