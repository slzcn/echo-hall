# eh-admin-api Edge Function

部署目标: Supabase project `cddkniwbhvcbfgkgomtl` (slzcn-apps) 的 Edge Function `eh-admin-api`。

部署命令:
```
export SUPABASE_ACCESS_TOKEN=<management token>
cd <含 supabase/functions/eh-admin-api/index.ts 的目录>
supabase functions deploy eh-admin-api --project-ref cddkniwbhvcbfgkgomtl --no-verify-jwt
```

## 版本
- **v21 (2026-07-14 20:30)**: 修召唤"在房未勾选"+"重复召唤出两个" bug。
  官方漫游灵魂(狼姐)进房只写 eh_members/presence 不写 eh_souls, 而召唤 on 判断/查重
  只看 eh_souls → 误判。三处改动把口径统一为 eh_members(谁真在房):
  1. soul-summonables 的 on: 查 eh_members 同名可召唤灵魂
  2. soul-summon 查重: 漫游灵魂在场返回"无需重复召唤", 不建第二个, 不碰全局身份
  3. 撤销: 无驻守记录但漫游在场 → 删本房 members/presence(请离开), 不删全局 auth 身份
- v20: authUid + blurb + soul-summon on:false 撤销
