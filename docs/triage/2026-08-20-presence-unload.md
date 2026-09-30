# Echo Bug 诊断单：页面关闭在线状态残留

## 1．用户旅程
房间内关闭标签／退出 PWA → 服务端应尽力及时删除本人的 presence，不应依赖约 35 秒过期。

## 2．稳定复现
beforeunload 中发起普通 Supabase Promise；浏览器卸载时通常取消请求。

## 3．单一根因假设
卸载清理错误地把普通异步请求当作 keepalive／beacon 请求。

## 4．验证方法
新增契约：pagehide 使用带鉴权的 fetch keepalive 调 REST delete，普通离房仍走现有完整清理；旧普通 Promise 必红。

## 5．回归矩阵
- 返回大厅
- 关标签
- PWA pagehide
- 无 session token
- 网络失败由过期窗口兜底

## 6．修复结果
新增 `journey-presence-unload.js`，先在旧实现上确认没有独立 pagehide keepalive REST DELETE 契约。卸载清理现在监听 `pagehide`，使用当前 session access token、Supabase anon key 与 REST `DELETE /rest/v1/eh_presence`，设置 `keepalive:true` 尽力发出请求；无 token 时安全跳过，依赖服务端过期窗口兜底。正常 `leaveRoom` 仍调用原有 `leavePresence` Supabase delete 及频道／成员清理路径，没有改成卸载简化路径。

状态不变量：正常离房仍完整清理并等待；pagehide 不等待 Promise、不新建 auth 请求；鉴权 header 使用最新 auth 状态回调维护的 token；切房后 pagehide 只处理当前房；请求失败不阻塞卸载。

本地验证：旧实现该 journey 必红；修复后 journey 与 JS 语法检查通过，并已接入 `scripts/ci-check.sh`。

## 7．发布验证
未发布（本任务要求不改版本号、不提交）。发布后需分别验证返回大厅、关闭标签页和 PWA pagehide 的 Network keepalive 请求，以及无 session token 时不抛异常。
