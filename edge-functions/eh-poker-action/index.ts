// eh-poker-action — 德州扑克服务端权威引擎（方案 A2）
// ============================================================
// 所有德州逻辑跑在 Supabase Edge Function（Deno/TS），客户端只负责渲染和发送操作。
// 入参: { table_id, action, amount?, uid }
// action: 'start_hand' | 'fold' | 'check' | 'call' | 'raise' | 'allin'
//
// 流程:
//   1. 验证 JWT → 提取 uid
//   2. 读 eh_game_tables（座位布局）+ eh_hand_state（当前手牌状态）
//   3. 反序列化引擎状态
//   4. 执行玩家操作
//   5. 若轮到 AI → 连续执行 AI 决策直到轮到真人或手牌结束
//   6. 序列化写回 eh_hand_state
//   7. 广播脱敏快照（不含 deck/hole_cards）到 Realtime 频道
//   8. 返回脱敏快照
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
