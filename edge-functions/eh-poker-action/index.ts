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

// ═══════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════

interface Card { rank: number; suit: string; label: string; id: string; }
interface Player {
  id: string; seat: number; name: string; isAI: boolean;
  stack: number; start: number; hole: Card[];
  folded: boolean; allin: boolean; sitOut: boolean;
  committed: number; street: number; acted: boolean;
  uid?: string;
}
interface GameState {
  variant: string; phase: string; seed: number; n: number;
  button: number; sb: number; bb: number;
  players: Player[]; board: Card[];
  _deck: { cards: Card[]; cursor: number };
  street: string; currentBet: number; minRaise: number;
  aggressor: number | null; toAct: number; pot: number;
  raiseCount: number;  // 本街加注次数(含开注), 每街重置; 上限 MAX_RAISES_PER_STREET
  result: any; log: any[];
  sbSeat?: number; bbSeat?: number;
}
interface EvalResult { cat: number; tie: number[]; name: string; }
interface LegalActions {
  toAct: boolean; toCall?: number; canCheck?: boolean; canCall?: boolean;
  callAmount?: number; canBet?: boolean; canRaise?: boolean;
  minRaiseTo?: number; maxRaiseTo?: number; canFold?: boolean; canAllin?: boolean;
}
interface GameOpts {
  names: string[]; isAI?: boolean[]; uids?: string[];
  stacks?: number[]; sb?: number; bb?: number;
  startStack?: number; button?: number; seed?: number; actionBias?: number;
}

// ═══════════════════════════════════════════════════════════════
// 牌模型 + 洗牌（移植自 deck.js + poker-engine.js）
// ═══════════════════════════════════════════════════════════════

const SUITS = ['♠','♥','♣','♦'] as const;
const SUIT_KEY: Record<string, string> = { '♠':'s','♥':'h','♣':'c','♦':'d' };
const LABEL: Record<number, string> = { 11:'J', 12:'Q', 13:'K', 14:'A' };

function pokerCard(rank: number, suit: string): Card {
  return { rank, suit, label: LABEL[rank] || String(rank), id: SUIT_KEY[suit] + rank };
}
function pokerDeck(): Card[] {
  const cs: Card[] = [];
  for (let r = 2; r <= 14; r++) for (const s of SUITS) cs.push(pokerCard(r, s));
  return cs;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function freshSeed(): number {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  } catch { return ((Date.now() ^ (Math.random()*0xffffffff)) >>> 0); }
}

function shuffle(cards: Card[], seed?: number): { seed: number; cards: Card[] } {
  const s = (typeof seed === 'number') ? (seed >>> 0) : freshSeed();
  const rng = mulberry32(s);
  const out = cards.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = out[i]; out[i] = out[j]; out[j] = t;
  }
  return { seed: s, cards: out };
}

const DEFAULT_ACTION_BIAS = 0.55;

// 每街(下注轮)加注上限: 含开注, 超过后只能跟注/过牌/弃牌/全下(全下不受限)
const MAX_RAISES_PER_STREET = 2;
function holePlayable(a: Card, b: Card): boolean {
  if (a.rank === b.rank) return true;
  if (a.suit === b.suit) return true;
  const hi = Math.max(a.rank, b.rank), lo = Math.min(a.rank, b.rank);
  if (hi - lo <= 2) return true;
  if (lo >= 11) return true;
  if (hi === 14 && lo >= 10) return true;
  return false;
}
function coordinatedWith(a: Card, x: Card): boolean {
  if (x.rank === a.rank) return true;
  if (x.suit === a.suit) return true;
  return Math.abs(x.rank - a.rank) <= 2;
}
function shuffleIdx(arr: number[], rng: () => number): number[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function arrangeActionDeck(cards: Card[], n: number, rng: () => number, strength: number): Card[] {
  if (!(strength > 0)) return cards;
  const muckStart = 2 * n + 8;
  if (muckStart >= cards.length) return cards;
  const consumed = new Set<number>();
  const seatIdx = shuffleIdx(Array.from({ length: n }, (_, i) => i), rng);
  for (const i of seatIdx) {
    const a = cards[i];
    const b = cards[n + i];
    if (holePlayable(a, b)) continue;
    if (rng() >= strength) continue;
    const pool = shuffleIdx(
      Array.from({ length: cards.length - muckStart }, (_, k) => muckStart + k), rng);
    for (const m of pool) {
      if (consumed.has(m)) continue;
      if (coordinatedWith(a, cards[m])) {
        const t = cards[n + i]; cards[n + i] = cards[m]; cards[m] = t;
        consumed.add(m);
        break;
      }
    }
  }
  return cards;
}

// ═══════════════════════════════════════════════════════════════
// 牌型评估（移植自 poker-eval.js）
// ═══════════════════════════════════════════════════════════════

const CAT = { SF:8, QUADS:7, FULL:6, FLUSH:5, STRAIGHT:4, TRIPS:3, TWO_PAIR:2, PAIR:1, HIGH:0 } as const;
const CAT_NAME: Record<number, string> = { 8:'同花顺', 7:'四条', 6:'葫芦', 5:'同花', 4:'顺子', 3:'三条', 2:'两对', 1:'一对', 0:'高牌' };

function straightHigh(rankSet: Set<number>): number {
  const p: Record<number, boolean> = {};
  rankSet.forEach(r => { p[r] = true; if (r === 14) p[1] = true; });
  for (let hi = 14; hi >= 5; hi--) {
    if (p[hi] && p[hi-1] && p[hi-2] && p[hi-3] && p[hi-4]) return hi;
  }
  return 0;
}
function mkEval(cat: number, tie: number[], name?: string): EvalResult {
  return { cat, tie, name: name || CAT_NAME[cat] };
}
function evaluate(cards: Card[]): EvalResult {
  if (!cards || cards.length < 5) throw new Error('poker-eval: need 5+ cards');
  const byRank: Record<number, number> = {}, bySuit: Record<string, number[]> = {};
  for (const c of cards) {
    byRank[c.rank] = (byRank[c.rank] || 0) + 1;
    (bySuit[c.suit] = bySuit[c.suit] || []).push(c.rank);
  }
  let flushSuit: string | null = null;
  for (const s in bySuit) { if (bySuit[s].length >= 5) { flushSuit = s; break; } }
  if (flushSuit) {
    const sf = straightHigh(new Set(bySuit[flushSuit]));
    if (sf) return mkEval(CAT.SF, [sf], sf === 14 ? '皇家同花顺' : '同花顺');
  }
  const ranks = Object.keys(byRank).map(Number);
  const groups = ranks.slice().sort((a, b) => (byRank[b] - byRank[a]) || (b - a));
  const c0 = byRank[groups[0]];
  if (c0 === 4) {
    const quad = groups[0];
    const kickerPool = ranks.filter(r => r !== quad);
    const kicker = kickerPool.length ? Math.max(...kickerPool) : 0;
    return mkEval(CAT.QUADS, [quad, kicker]);
  }
  if (c0 === 3) {
    for (let i = 1; i < groups.length; i++) {
      if (byRank[groups[i]] >= 2) return mkEval(CAT.FULL, [groups[0], groups[i]]);
    }
  }
  if (flushSuit) {
    const top5 = bySuit[flushSuit].slice().sort((a, b) => b - a).slice(0, 5);
    return mkEval(CAT.FLUSH, top5);
  }
  const sh = straightHigh(new Set(ranks));
  if (sh) return mkEval(CAT.STRAIGHT, [sh]);
  if (c0 === 3) {
    const trip = groups[0];
    const ks = ranks.filter(r => r !== trip).sort((a, b) => b - a).slice(0, 2);
    return mkEval(CAT.TRIPS, [trip, ...ks]);
  }
  const pairs = ranks.filter(r => byRank[r] === 2).sort((a, b) => b - a);
  if (pairs.length >= 2) {
    const kicker = Math.max(...ranks.filter(r => r !== pairs[0] && r !== pairs[1]));
    return mkEval(CAT.TWO_PAIR, [pairs[0], pairs[1], kicker]);
  }
  if (pairs.length === 1) {
    const ks = ranks.filter(r => r !== pairs[0]).sort((a, b) => b - a).slice(0, 3);
    return mkEval(CAT.PAIR, [pairs[0], ...ks]);
  }
  const top5 = ranks.slice().sort((a, b) => b - a).slice(0, 5);
  return mkEval(CAT.HIGH, top5);
}
function compareEval(a: EvalResult, b: EvalResult): number {
  if (a.cat !== b.cat) return a.cat < b.cat ? -1 : 1;
  const n = Math.max(a.tie.length, b.tie.length);
  for (let i = 0; i < n; i++) {
    const x = a.tie[i] || 0, y = b.tie[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

// ═══════════════════════════════════════════════════════════════
// 引擎状态机（移植自 poker-engine.js）
// ═══════════════════════════════════════════════════════════════

const NEXT_STREET: Record<string, string> = { preflop:'flop', flop:'turn', turn:'river', river:'showdown' };
const STREET_DEAL: Record<string, number> = { flop:3, turn:1, river:1 };

function seatOrderFrom(state: GameState, start: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.n; i++) out.push((start + i) % state.n);
  return out;
}
function drawCard(state: GameState): Card { return state._deck.cards[state._deck.cursor++]; }
function syncPot(state: GameState) { state.pot = state.players.reduce((s, p) => s + p.committed, 0); }
function contenders(state: GameState): Player[] { return state.players.filter(p => !p.folded); }

function needsActionFrom(state: GameState, from: number): number {
  const liveActors = state.players.filter(p => !p.folded && !p.allin && p.stack > 0).length;
  for (let i = 0; i < state.n; i++) {
    const s = (from + i) % state.n, p = state.players[s];
    if (p.folded || p.allin || p.stack === 0) continue;
    if (p.acted && p.street === state.currentBet) continue;
    if (liveActors <= 1 && (state.currentBet - p.street) === 0) continue;
    return s;
  }
  return -1;
}

function postBlind(state: GameState, seat: number, amount: number, kind: string) {
  const p = state.players[seat];
  const put = Math.min(amount, p.stack);
  p.stack -= put; p.street += put; p.committed += put;
  if (p.stack === 0) p.allin = true;
  state.log.push({ t:'blind', seat, kind, amount: put });
}

function createGame(opts: GameOpts): GameState {
  opts = opts || {};
  const names = opts.names || ['你','对手'];
  const n = names.length;
  if (n < 2) throw new Error('need_2_players');
  const isAI = opts.isAI || names.map((_, i) => i !== 0);
  const sb = opts.sb || 5, bb = opts.bb || 10;
  const startStack = opts.startStack || 2000;
  const stacks = opts.stacks || names.map(() => startStack);
  let button = (typeof opts.button === 'number') ? (opts.button % n) : 0;

  const shuffled = shuffle(pokerDeck(), opts.seed);
  const seed = shuffled.seed;
  const cards = shuffled.cards;
  const actionBias = (opts.actionBias != null) ? +opts.actionBias : DEFAULT_ACTION_BIAS;
  arrangeActionDeck(cards, n, mulberry32((seed ^ 0x9e3779b9) >>> 0), actionBias);

  const players: Player[] = names.map((nm, seat) => {
    const stk = stacks[seat];
    const sitOut = !(stk > 0);
    return {
      id: ('p' + seat),
      seat, name: nm || ('席' + seat), isAI: !!isAI[seat],
      stack: sitOut ? 0 : stk, start: sitOut ? 0 : stk,
      hole: [], folded: sitOut, allin: false, sitOut, committed: 0, street: 0, acted: false,
      uid: opts.uids ? opts.uids[seat] : undefined,
    };
  });

  const seatedCount = players.filter(p => !p.sitOut).length;
  if (seatedCount < 2) throw new Error('need_2_seated');
  const nextSeated = (from: number) => {
    for (let i = 0; i < n; i++) { const s = (from + i) % n; if (!players[s].sitOut) return s; }
    return -1;
  };
  if (players[button].sitOut) button = nextSeated(button);

  const state: GameState = {
    variant: 'nlhe', phase: 'preflop', seed, n, button, sb, bb,
    players, board: [],
    _deck: { cards, cursor: 0 },
    street: 'preflop', currentBet: 0, minRaise: bb, aggressor: null,
    toAct: -1, pot: 0, raiseCount: 0, result: null,
    log: [{ t:'deal', seed, button, sb, bb, n, stacks: stacks.slice(), names: names.slice(), actionBias }],
  };

  const order = seatOrderFrom(state, (button + 1) % n).filter(s => !state.players[s].sitOut);
  for (let round = 0; round < 2; round++)
    for (const s of order) state.players[s].hole.push(drawCard(state));

  let sbSeat: number, bbSeat: number, firstToAct: number;
  if (seatedCount === 2) { sbSeat = button; bbSeat = nextSeated((button + 1) % n); firstToAct = button; }
  else { sbSeat = nextSeated((button + 1) % n); bbSeat = nextSeated((sbSeat + 1) % n); firstToAct = nextSeated((bbSeat + 1) % n); }
  state.sbSeat = sbSeat; state.bbSeat = bbSeat;
  postBlind(state, sbSeat, sb, 'sb');
  postBlind(state, bbSeat, bb, 'bb');
  state.currentBet = Math.max(state.players[sbSeat].street, state.players[bbSeat].street);
  state.minRaise = bb;
  state.toAct = needsActionFrom(state, firstToAct);
  syncPot(state);
  if (state.toAct === -1) runout(state);
  return state;
}

function putChips(state: GameState, p: Player, amt: number) {
  const put = Math.min(amt, p.stack);
  p.stack -= put; p.street += put; p.committed += put;
  if (p.stack === 0) p.allin = true;
}

function legalActions(state: GameState, seat: number): LegalActions {
  const p = state.players[seat];
  if (state.phase === 'over' || state.phase === 'showdown' || seat !== state.toAct || p.folded || p.allin)
    return { toAct: false };
  const toCall = state.currentBet - p.street;
  const canCheck = toCall === 0;
  const canCall = toCall > 0;
  const callAmount = Math.min(toCall, p.stack);
  const maxTo = p.street + p.stack;
  let canBet = false, canRaise = false, minTo = 0;
  const raiseCapped = state.raiseCount >= MAX_RAISES_PER_STREET;
  if (state.currentBet === 0) {
    canBet = p.stack > 0 && !raiseCapped;
    minTo = Math.min(state.bb, maxTo);
  } else if (p.stack > toCall) {
    canRaise = !raiseCapped;
    minTo = Math.min(state.currentBet + state.minRaise, maxTo);
  }
  return {
    toAct: true, toCall, canCheck, canCall, callAmount,
    canBet, canRaise, minRaiseTo: minTo, maxRaiseTo: maxTo,
    canFold: true, canAllin: p.stack > 0,
  };
}

function winByFold(state: GameState): any {
  const w = contenders(state)[0];
  w.stack += state.pot;
  return settle(state, {
    wentToShowdown: false, board: state.board.map(c => c.id),
    pots: [{ amount: state.pot, winners: [w.seat] }], winnersBySeat: [w.seat],
  });
}

function buildSidePots(state: GameState): { amount: number; eligible: number[] }[] {
  const commits = state.players.map(p => p.committed).filter(v => v > 0);
  const levels = [...new Set(commits)].sort((a, b) => a - b);
  const pots: { amount: number; eligible: number[] }[] = [];
  let prev = 0;
  for (const lv of levels) {
    let amount = 0; const eligible: number[] = [];
    for (const p of state.players) {
      if (p.committed >= lv) amount += (lv - prev);
      if (p.committed >= lv && !p.folded) eligible.push(p.seat);
    }
    if (amount > 0) pots.push({ amount, eligible });
    prev = lv;
  }
  return pots;
}

function distributePot(state: GameState, amount: number, winners: number[]) {
  const each = Math.floor(amount / winners.length);
  let rem = amount - each * winners.length;
  for (const s of winners) state.players[s].stack += each;
  if (rem > 0) {
    const order = seatOrderFrom(state, (state.button + 1) % state.n).filter(s => winners.includes(s));
    for (let i = 0; i < rem; i++) state.players[order[i % order.length]].stack += 1;
  }
}