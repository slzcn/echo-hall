# 诊断单: 作曲持续 401 — 真根因是 apikey 环境变量名不匹配

- 日期: 2026-08-13 15:58 CST
- 现象: 用户(热血狼/临时用户)多次点作曲, 前端令牌完整(691字符JWT), 仍全 401; 退出重登无效。

## 取证(这次先让后端开口)

给 authenticate() 加 reason 日志后, 15:57 线上函数日志:
```
{"tag":"bgm-auth-fail","reason":"invalid_token","whoStatus":401,"tokenLen":691,
 "tokenHead":"eyJhbGciOiJF","body":"{\"message\":\"Invalid API key\",
 \"hint\":\"Double check your Supabase anon or service_role API key.\"}"}
```

## 单一根因(证据链闭合)

1. 用户令牌是**有效的**(691 字符完整 JWT, 不是缺令牌、不是过期)。
2. 后端调用 `/auth/v1/user` 校验令牌时, `apikey` 头传错 → Supabase 直接回 "Invalid API key" 401,
   **根本没走到校验用户令牌本身**。
3. 代码读 `Deno.env.get("SB_ANON_KEY")`(index.ts:12), 但项目实际配置的 secret 名是
   **`SUPABASE_ANON_KEY`**(管理 API 列出的 secrets 里没有 `SB_ANON_KEY`)。
4. 于是 `SB_ANON=""` → `apikey: SB_ANON || token` fallback 成**用户自己的 token** →
   Supabase 认为这不是合法 apikey → 401 Invalid API key。

## 前几次误判(归入 anti-pattern)

- 误判1: SW/JS 缓存自锁 → 清缓存(白改, 令牌其实一直带着)
- 误判2: 前端"令牌可选" → 强制令牌门禁(有价值但非本 bug 根因)
- 共同错误: **没有第一时间让后端说明它为什么拒绝**; 全靠猜"前端/缓存"。
- 正确第一步(本应最先做): 给 401 加 reason 日志 → 3 分钟现形。

## 单变量修复

只改环境变量读取名, 不动鉴权逻辑本身:
- `SB_ANON`: 读 `SB_ANON_KEY` → 兼容 `SUPABASE_ANON_KEY`(实际存在的名)。
- 顺带 service key 也补 `SUPABASE_SERVICE_ROLE_KEY` 兜底(同类隐患)。
- **去掉 `|| token` 这个危险 fallback**: apikey 缺失时不该拿用户 token 顶, 应直接明确失败,
  否则以后再配错还会被这个 fallback 掩盖成"令牌无效"的假象。

## 验证

- 部署后拉线上函数日志, 用户点一次作曲: 应出现 200(成功入库)或不再是 invalid_token。
- CI: `bash scripts/ci-check.sh` 全绿。
- eh-sing-cover 若有同样 `SB_ANON_KEY` 读法, 一并修。
