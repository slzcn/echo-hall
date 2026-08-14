# 2026-08-13 音频 Edge 安全修复待部署

状态：本地安全门禁 11／11 通过；Supabase CLI 缺 management access token，线上尚未部署。

- `supabase/functions/eh-bgm-gen/index.ts` SHA256: `74c204eddeafd711dfb0d7c56a53c2f5c410a6b151a066e49df49d54ca1ace3f`
- `supabase/functions/eh-sing-cover/index.ts` SHA256: `49255bbe0f7d53abb8f88c850c370b10ac83503cd074f4a885aad44be93bda6c`

部署命令：
```bash
SUPABASE_ACCESS_TOKEN=<management-token> supabase functions deploy eh-bgm-gen eh-sing-cover --project-ref cddkniwbhvcbfgkgomtl --use-api --yes
```

部署后验证：
1. 两个函数无 Authorization 均应返回 401。
2. `eh-bgm-gen` 旧 payload 应返回 410 `legacy_endpoint_disabled`。
3. 非房间成员应返回 403。
4. 合法房间成员生成一首 BGM／神曲，确认主流程未回归。
