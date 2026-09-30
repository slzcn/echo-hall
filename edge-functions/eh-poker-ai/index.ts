/**
 * eh-poker-ai — 德州扑克灵魂 LLM 增强（方案B 决策 + 方案C 对话）
 * ------------------------------------------------------------
 * LLM 调用策略（两级降级）：
 *   1. MIMO 推理模型 mimo-v2.6-pro-ultraspeed（8s 超时）
 *   2. 返回 null，调用方用规则引擎兜底
 *
 * 两种请求:
 *   type=decision → 方案B: LLM 做扑克决策，覆盖规则引擎
 *   type=taunt     → 方案C: 生成一句符合性格的中文短句
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: any, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const MIMO_TIMEOUT_MS = 8000      // ultraspeed 推理模型 8 秒超时

// ── 性格描述（archetype → 扑克风格 prompt 片段） ──────────────
const ARCHETYPE_DESC: Record<string, string> = {
  warm: '随和暖场型：偏保守跟注，不爱大加注，喜欢陪对手玩',
  cool: '清冷冷静型：极其保守，只玩强牌，冷静弃牌不犹豫',
  sharp: '精准凶悍型：紧凶风格，紧而敢加注，精准计算价值',
  wild: '激进疯狂型：极度松凶，疯狂加注诈唬，不惧 all-in',
  playful: '松凶调皮型：松而敢打，调皮搅局，偶尔诈唬',
}

// ── 牌面格式化辅助（输入格式: rank+suit, 如 "Ah"=红桃A, "Td"=方片10） ──
function cardStr(c: string): string {
  if (!c || c.length < 2) return c || '?'
  const suitMap: Record<string, string> = { s: '♠', h: '♥', c: '♣', d: '♦' }
  const suit = c.slice(-1)
  const rank = c.slice(0, -1)
  const rankLabel: Record<string, string> = { T: '10', t: '10' }
  return (suitMap[suit] || suit) + (rankLabel[rank] || rank)
}
function cardsStr(cards: string[]): string {
  return (cards || []).map(cardStr).join(' ')
}

// ── 调用 LLM（mimo 推理模型，降级 null） ──
// maxTokens 由调用方指定：taunt=150（短文字，留 reasoning token 空间），decision=500（JSON 决策）
async function callLLM(
  messages: { role: string; content: string }[],
  maxTokens: number = 2048,
): Promise<{ text: string | null; debug: string }> {
  const debugLog: string[] = []

  const mimoKey = Deno.env.get('MIMO_API_KEY') || Deno.env.get('MIFY_KEY') || ''
  if (!mimoKey) {
    debugLog.push('no_mimo_key')
    return { text: null, debug: debugLog.join('; ') }
  }

  // model 名直接用环境变量，不加任何前缀
  const model = Deno.env.get('MIMO_MODEL') || 'mimo-v2.6-pro-ultraspeed'

  // endpoint 逻辑：优先用 MIMO_BASE_URL，处理末尾斜杠和已有路径
  let endpoint: string
  const baseUrl = (Deno.env.get('MIMO_BASE_URL') || '').replace(/\/+$/, '')
  if (baseUrl.endsWith('/chat/completions')) {
    endpoint = baseUrl
  } else if (baseUrl) {
    endpoint = baseUrl + '/chat/completions'
  } else {
    endpoint = 'https://api.xiaomimimo.com/v1/chat/completions'
  }

  debugLog.push(`mimo_endpoint=${endpoint}`)
  debugLog.push(`mimo_model=${model}`)

  const reqBody = { model, messages, temperature: 0.8, max_tokens: maxTokens, stream: false }

  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), MIMO_TIMEOUT_MS)
    const r = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${mimoKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    debugLog.push(`mimo_status=${r.status}`)
    if (!r.ok) {
      const errTxt = await r.text().catch(() => '?')
      debugLog.push(`mimo_err=${errTxt.slice(0, 120)}`)
      return { text: null, debug: debugLog.join('; ') }
    }
    const j = await r.json()
    // OpenAI 兼容格式: 只取 content 字段（推理模型的 reasoning_content 是内部推理过程，不取）
    const text = j?.choices?.[0]?.message?.content
      || j?.choices?.[0]?.delta?.content
      || j?.data?.[0]?.output
      || null
    if (text) return { text: String(text).trim(), debug: debugLog.join('; ') }
    debugLog.push(`mimo_no_text:${JSON.stringify(j).slice(0, 150)}`)
    return { text: null, debug: debugLog.join('; ') }
  } catch (e: any) {
    debugLog.push(`mimo_ex:${String(e?.name || e?.message || e).slice(0, 80)}`)
    return { text: null, debug: debugLog.join('; ') }
  }
}

// ── 方案B: 决策 prompt ───────────────────────────────────────
function buildDecisionPrompt(req: any): { role: string; content: string }[] {
  const archDesc = ARCHETYPE_DESC[req.archetype] || ARCHETYPE_DESC.sharp
  const hole = cardsStr(req.holeCards)
  const board = cardsStr(req.communityCards)
  const street = req.street || 'flop'
  const pot = req.pot || 0
  const toCall = req.toCall || 0
  const myStack = req.myStack || 0
  const position = req.position || 'MP'
  const history = (req.actionHistory || []).join('; ') || '无'

  const sys = `你是专业德州扑克玩家。你的性格是：${archDesc}。你的名字叫"${req.name || '灵魂'}"。
现在请你根据以下牌局信息，以这个性格做出决策。直接输出 JSON，不要输出思考过程。格式：{"action":"fold|check|call|raise|allin","amount":数字,"confidence":0到1}
- amount 仅在 raise/bet/allin 时需要，表示总投入额（不是增量）
- confidence 是你对这个决策的信心程度
- 只输出 JSON，不要输出任何解释或推理过程`

  const user = `当前局面:
- 我的手牌: ${hole}
- 公共牌: ${board || '（无）'}
- 阶段: ${street}
- 底池: ${pot}
- 需要跟注: ${toCall}
- 我的筹码: ${myStack}
- 位置: ${position}
- 行动历史: ${history}

请做出你的决策，直接输出 JSON，不要输出思考过程。`

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]
}

// ── 方案C: 对话 prompt ──────────────────────────────────────
function buildTauntPrompt(req: any): { role: string; content: string }[] {
  const archDesc = ARCHETYPE_DESC[req.archetype] || ARCHETYPE_DESC.sharp
  const action = req.action || 'call'
  const amount = req.amount || 0
  const street = req.street || 'flop'
  const pot = req.pot || 0

  const actionDesc: Record<string, string> = {
    fold: '弃牌了',
    check: '过牌了',
    call: '跟注了',
    bet: `下注${amount}`,
    raise: `加注到${amount}`,
    allin: `全下${amount}！`,
  }
  const actText = actionDesc[action] || action

  const sys = `你是一个德州扑克玩家的灵魂，性格：${archDesc}。你的名字叫"${req.name || '灵魂'}"${req.emoji || ''}。
你刚做了一个动作，请说一句符合你性格的话。要求：
- 中文，10字以内
- 符合性格的语气
- 不要解释，直接输出这一句话
- 不要加引号`

  const user = `你刚在${street}阶段${actText}，当前底池${pot}。说一句话：`

  return [
    { role: 'system', content: sys },
    { role: 'user', content: user },
  ]
}

// ── 解析决策 JSON ───────────────────────────────────────────
function parseDecision(raw: string): { action: string; amount?: number; confidence?: number } | null {
  if (!raw) return null
  try {
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return null
    const j = JSON.parse(m[0])
    const validActions = ['fold', 'check', 'call', 'bet', 'raise', 'allin']
    if (!j.action || !validActions.includes(j.action)) return null
    return {
      action: j.action,
      amount: typeof j.amount === 'number' ? j.amount : undefined,
      confidence: typeof j.confidence === 'number' ? Math.max(0, Math.min(1, j.confidence)) : 0.5,
    }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405)

  let body: any
  try { body = await req.json() } catch { return json({ ok: false, error: 'invalid_json' }, 400) }
  if (!body || !body.type) return json({ ok: false, error: 'missing_type' }, 400)

  // ── 方案B: 决策请求（max_tokens=500，推理模型需要留 reasoning token 空间） ──
  if (body.type === 'decision') {
    const messages = buildDecisionPrompt(body)
    const { text: raw, debug } = await callLLM(messages, 500)
    if (!raw) return json({ ok: false, error: 'llm_timeout', fallback: true, debug })
    const parsed = parseDecision(raw)
    if (!parsed) return json({ ok: false, error: 'parse_failed', raw: raw.slice(0, 200), fallback: true, debug })
    return json({ ok: true, ...parsed })
  }

  // ── 方案C: 对话请求（max_tokens=150，taunt 只需短文字） ──
  if (body.type === 'taunt') {
    const messages = buildTauntPrompt(body)
    const { text: raw, debug } = await callLLM(messages, 150)
    if (!raw) return json({ ok: false, error: 'llm_timeout', text: '', debug })
    let text = raw.replace(/^["'"「『]|["'"」』]$/g, '').replace(/\n/g, '').trim()
    if (text.length > 20) text = text.slice(0, 20)
    return json({ ok: true, text })
  }

  return json({ ok: false, error: 'unknown_type' }, 400)
})
