# 后台自定义身份列表只显示 UID, 看不到人是谁

## §1 现象
后台 → 身份类型 → 贵宾等自定义档 → 名单区域, 每行只显示裸 UID (如 `9da0cb44-bbd4-...`), 主人/管理员无法一眼看出这是哪个用户, 需要另开人员 tab 一个个粘贴 UID 反查。

## §2 复现步骤
1. 打开 `admin.html` → 身份类型
2. 展开"贵宾"自定义档
3. 名单里的每个成员只显示 `<code>${uid}</code>`, 无昵称、无用户名

## §3 影响范围
- 后台管理员判断"这个贵宾是谁"必须跳出去查, 每次都繁琐
- 主人 20:28 直接反馈: "我看后台看不到这个人的昵称和用户名"
- 21:17 主人明确: "补上吧"

## §4 根因分析
`admin.html:2864` `renderCustomTiers()` 渲染名单时:
```html
<code>${esc(uid)}</code>
```
直接把 UID 铺出来, 没有反查 `eh_users.name` (昵称) / `eh_accounts.username` (用户名)。

**这不是配置问题, 是展示 UX 缺陷**——数据都在, 只是后台没显示。

## §5 修复方案 (最小侵入)
1. 后端 `supabase/functions/eh-admin-api/index.ts` 新增 `GET /user-brief?ids=uid1,uid2,...`
   - 只允许超管/管理员调用 (复用现有 authRole)
   - 从 `eh_users` 取 `id,name,emoji,color`, 从 `eh_accounts` 取 `auth_uid,username`
   - 返回 `{ users: { uid1: {name, username, emoji, color}, ... } }`
2. 前端 `admin.html`:
   - `renderCustomTiers()` 前先调 `/user-brief?ids=...` 一次性拿到 map
   - 名单每行改为: `[emoji] 昵称 @用户名 · UID缩写` (跟搜索下拉一致的形态)
   - 拿不到时降级为原 UID 展示 (不阻断)

## §6 反证测试
- `scripts/journey-admin-vip-list.js` (未来补): 空 map → 显示纯 UID; 有 map → 显示昵称+用户名。

## §7 完成后回填
- 提交 hash
- 版本号
- 后台截图前后对比
