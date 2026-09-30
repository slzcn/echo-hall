# 游戏灵魂种子脚本说明

## 概述

本脚本把德州扑克 BOT_POOL 的8个花名角色（阿岩、小凶、疯哥、冷面、老练、莽夫、狐狸、铁头）升级为 DB 级「游戏灵魂」。

这8个灵魂 **只用于游戏场景**（`scope='game'`），不会出现在聊天室。聊天灵魂仍然走 `eh_souls` 表 + `auth.users` 体系，两套互不干扰。

## 文件

| 文件 | 说明 |
|------|------|
| `scripts/seed-game-souls.sql` | 建表 + 插入8条灵魂 + 创建视图/函数 |
| `scripts/seed-game-souls.md` | 本说明文档 |

## 8个游戏灵魂

| 花名 | 头像 | archetype | 打法映射 (poker-ai.js SOUL_STYLE) |
|-------|------|-----------|-----------------------------------|
| 阿岩  | 🗿   | cool      | rock（紧）                        |
| 小凶  | 🔥   | sharp     | tag（紧凶）                       |
| 疯哥  | 🤪   | wild      | maniac（疯子）                    |
| 冷面  | 🥶   | cool      | rock（紧）                        |
| 老练  | 🧊   | sharp     | tag（紧凶）                       |
| 莽夫  | 😤   | wild      | maniac（疯子）                    |
| 狐狸  | 🦊   | playful   | lag（松凶）                       |
| 铁头  | 🐗   | warm      | station（跟注站）                 |

## 执行步骤

### 1. 在 Supabase Dashboard 执行 SQL

1. 打开 Supabase Dashboard → SQL Editor
2. 粘贴 `scripts/seed-game-souls.sql` 全部内容
3. 点击 **Run** 执行
4. 脚本可安全重复执行（幂等：表/视图/函数使用 `IF NOT EXISTS`，插入使用 `ON CONFLICT`）

### 2. 修改 `eh_room_souls` RPC

当前 `eh_room_souls` RPC 只返回 `eh_souls` 表的聊天灵魂。执行完上述 SQL 后，需要在 Supabase Dashboard 里找到 `eh_room_souls` 函数定义，在返回结果里 **union** 游戏灵魂视图：

```sql
-- 伪代码：eh_room_souls 函数体修改思路
-- 原来:
select auth_uid, name, emoji, persona, color, emotion
from public.eh_souls
where room_id = p_rid and enabled = true;

-- 改为:
select auth_uid, name, emoji, persona, color, emotion
from public.eh_souls
where room_id = p_rid and enabled = true
union all
select auth_uid, name, emoji, archetype as persona, null as color, null as emotion
from public.eh_game_souls_for_room;
```

> ⚠️ 如果不想改 `eh_room_souls`，也可以创建一个新的 `eh_game_room_souls` RPC，在前端游戏场景下单独调用。

### 3. 在 `app.js` 里标注 TODO

`app.js` 中 `loadRoomSouls()` 函数调用 `eh_room_souls` RPC 的位置已添加 TODO 注释：

```
// TODO: 接入 eh_game_souls，game 场景下合并返回
```

后续接入时，在该 RPC 调用处加入 `scope='game'` 过滤，或在返回结果里合并 `eh_game_souls_for_room` 视图数据。

## 前端接入点

执行 SQL + 修改 RPC 后，前端无需额外改动即可自动生效：

1. **`lobbyCtx.souls`**：`loadRoomSouls()` 拉取 `eh_room_souls` RPC 返回的灵魂列表（现在包含8个游戏灵魂），灌入 `lobbyCtx.souls`
2. **`freeSoulsForSeat()`**（`poker-ui.js`）：从 `lobbyCtx.souls` 过滤已入座的灵魂，返回可用灵魂；游戏灵魂会出现在列表里
3. **点「邀请灵魂来对战」**：用户在招募态点空位 → `fillSeat()` → `acts.seatSoul(seat, auth_uid)` → `eh_gt_seat_soul` RPC → 灵魂入座
4. **`gtSeatArrays()`**（`app.js`）：入座灵魂的 `archetype` 通过 `soulMap[uid]` 查到，传入 `souls[i].archetype`，驱动 `personaFor()` 选择 AI 打法风格

## 与现有体系的关系

| 维度 | 聊天灵魂 (eh_souls) | 游戏灵魂 (eh_game_souls) |
|------|----------------------|--------------------------|
| 表   | `eh_souls`           | `eh_game_souls`          |
| 账号 | `auth.users` 真实账号 | 无（UUID 作为伪 auth_uid）|
| 绑定 | `room_id`（按房分配） | 全局（所有房间可用）      |
| 场景 | 聊天室 + 牌桌        | 仅牌桌（scope='game'）    |
| 开关 | `enabled` 字段       | `enabled` 字段           |

## 验证

执行 SQL 后，运行以下查询确认：

```sql
-- 确认8条游戏灵魂已插入
select * from public.eh_game_souls order by name;

-- 确认视图返回 enabled + scope=game 的灵魂
select * from public.eh_game_souls_for_room;

-- 确认函数返回
select * from public.eh_game_souls_for_room_fn();
```

预期：8行记录，每行包含 `{auth_uid, name, emoji, archetype, scope}`。
