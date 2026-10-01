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
    const kicker = Math.max(...ranks.filter(r => r !== quad));
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
    toAct: -1, pot: 0, result: null,
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
  if (state.currentBet === 0) {
    canBet = p.stack > 0;
    minTo = Math.min(state.bb, maxTo);
  } else if (p.stack > toCall) {
    canRaise = true;
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

function settle(state: GameState, extra: any): any {
  state.phase = 'over';
  const delta: Record<number, number> = {};
  for (const p of state.players) delta[p.seat] = p.stack - p.start;
  state.result = Object.assign({
    button: state.button, delta,
    stacks: state.players.reduce((o: Record<number, number>, p) => (o[p.seat] = p.stack, o), {}),
  }, extra);
  state.log.push(Object.assign({ t:'over' }, state.result));
  return { ok: true, over: true, result: state.result };
}

function dealStreet(state: GameState, street: string) {
  drawCard(state);
  const k = STREET_DEAL[street];
  for (let i = 0; i < k; i++) state.board.push(drawCard(state));
}

function showdown(state: GameState): any {
  state.phase = 'showdown'; state.street = 'showdown';
  const live = contenders(state);
  const evals: Record<number, EvalResult> = {};
  for (const p of live) evals[p.seat] = evaluate(p.hole.concat(state.board));

  const pots = buildSidePots(state);
  const winnersBySeat = new Set<number>();
  for (const pot of pots) {
    const eligible = pot.eligible.filter(s => !state.players[s].folded);
    if (!eligible.length) continue;
    let best: number | null = null;
    for (const s of eligible) { if (best === null || compareEval(evals[s], evals[best]) > 0) best = s; }
    const winners = eligible.filter(s => compareEval(evals[s], evals[best!]) === 0);
    distributePot(state, pot.amount, winners);
    (pot as any).winners = winners.slice();
    (pot as any).handName = evals[best!].name;
    winners.forEach(s => winnersBySeat.add(s));
  }

  const reveal: Record<number, any> = {};
  for (const p of live) reveal[p.seat] = { hole: p.hole.map(c => c.id), hand: evals[p.seat].name, cat: evals[p.seat].cat };
  return settle(state, {
    wentToShowdown: true, board: state.board.map(c => c.id),
    pots: pots.map(p => ({ amount: p.amount, eligible: p.eligible.slice(), winners: (p as any).winners || [], handName: (p as any).handName })),
    winnersBySeat: [...winnersBySeat], reveal,
  });
}

function advanceStreet(state: GameState): any {
  for (const p of state.players) { p.street = 0; p.acted = false; }
  state.currentBet = 0; state.minRaise = state.bb; state.aggressor = null;
  const ns = NEXT_STREET[state.street];
  if (ns === 'showdown') return showdown(state);
  dealStreet(state, ns);
  state.street = ns; state.phase = ns;
  const first = (state.button + 1) % state.n;
  const next = needsActionFrom(state, first);
  if (next === -1) return runout(state);
  state.toAct = next;
  return { ok: true, street: ns };
}

function runout(state: GameState): any {
  while (state.street !== 'river') {
    const ns = NEXT_STREET[state.street];
    dealStreet(state, ns);
    state.street = ns; state.phase = ns;
  }
  return showdown(state);
}

function applyAction(state: GameState, seat: number, action: string, amount?: number): any {
  if (state.phase !== 'preflop' && state.phase !== 'flop' && state.phase !== 'turn' && state.phase !== 'river')
    throw new Error('not_betting_phase');
  if (seat !== state.toAct) throw new Error('not_your_turn');
  const p = state.players[seat];
  if (p.folded || p.allin) throw new Error('cannot_act');
  const toCall = state.currentBet - p.street;

  if (action === 'fold') {
    p.folded = true; p.acted = true;
    state.log.push({ t:'action', seat, action:'fold', street: state.street });
  } else if (action === 'check') {
    if (toCall !== 0) throw new Error('cannot_check');
    p.acted = true;
    state.log.push({ t:'action', seat, action:'check', street: state.street });
  } else if (action === 'call') {
    if (toCall <= 0) throw new Error('nothing_to_call');
    putChips(state, p, Math.min(toCall, p.stack));
    p.acted = true;
    state.log.push({ t:'action', seat, action:'call', amount: p.street, street: state.street });
  } else if (action === 'bet' || action === 'raise' || action === 'allin') {
    let to: number;
    if (action === 'allin') to = p.street + p.stack;
    else { to = amount!; if (typeof to !== 'number') throw new Error('need_amount'); }
    if (to <= state.currentBet && !(action === 'allin')) throw new Error('raise_too_small');
    if (to > p.street + p.stack) throw new Error('over_stack');
    const isOpen = state.currentBet === 0;
    const raiseSize = to - state.currentBet;
    const isAllin = (to === p.street + p.stack);
    if (isOpen) { if (!isAllin && to < state.bb) throw new Error('bet_below_min'); }
    else { if (!isAllin && raiseSize < state.minRaise) throw new Error('raise_below_min'); }
    const put = to - p.street;
    if (put <= 0) throw new Error('bad_amount');
    putChips(state, p, put);
    p.acted = true;
    const fullRaise = isOpen ? true : (raiseSize >= state.minRaise);
    if (to > state.currentBet) {
      if (fullRaise) {
        state.minRaise = to - state.currentBet;
        for (const q of state.players)
          if (!q.folded && !q.allin && q.seat !== seat) q.acted = false;
      }
      state.currentBet = to;
      state.aggressor = seat;
    }
    state.log.push({ t:'action', seat, action: (action==='allin'?'allin':action), amount: to, put, street: state.street });
  } else {
    throw new Error('bad_action');
  }

  syncPot(state);
  if (contenders(state).length === 1) return winByFold(state);
  const next = needsActionFrom(state, (seat + 1) % state.n);
  if (next !== -1) { state.toAct = next; return { ok: true }; }
  return advanceStreet(state);
}

// ═══════════════════════════════════════════════════════════════
// AI 决策（移植自 poker-ai.js）
// ═══════════════════════════════════════════════════════════════

interface Persona {
  key: string; name: string; chenGate: number; aggr: number;
  bluff: number; callEq: number; betFrac: number; threeBet: number;
}
const PERSONAS: Record<string, Persona> = {
  rock:    { key:'rock',    name:'岩石',   chenGate:8,  aggr:0.35, bluff:0.02, callEq:0.55, betFrac:0.70, threeBet:0.10 },
  tag:     { key:'tag',     name:'紧凶',   chenGate:6,  aggr:0.68, bluff:0.12, callEq:0.48, betFrac:0.65, threeBet:0.30 },
  lag:     { key:'lag',     name:'松凶',   chenGate:4,  aggr:0.82, bluff:0.30, callEq:0.40, betFrac:0.70, threeBet:0.45 },
  maniac:  { key:'maniac',  name:'疯子',   chenGate:1,  aggr:0.93, bluff:0.48, callEq:0.33, betFrac:0.85, threeBet:0.60 },
  station: { key:'station', name:'跟注站', chenGate:4,  aggr:0.15, bluff:0.03, callEq:0.28, betFrac:0.50, threeBet:0.05 },
};
const SOUL_STYLE: Record<string, string> = {
  warm:'station', cool:'rock', sharp:'tag', wild:'maniac', playful:'lag',
};
function persona(key: string): Persona { return PERSONAS[key] || PERSONAS.tag; }
function personaForSoul(archetype?: string): Persona {
  return persona(SOUL_STYLE[archetype || ''] || 'tag');
}

function chenScore(hole: Card[]): number {
  const hi = Math.max(hole[0].rank, hole[1].rank);
  const lo = Math.min(hole[0].rank, hole[1].rank);
  const hs = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
  let score: number;
  if (hole[0].rank === hole[1].rank) {
    score = Math.max(hs(hi) * 2, 5);
  } else {
    score = hs(hi);
    if (hole[0].suit === hole[1].suit) score += 2;
    const gap = hi - lo - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;
    if (gap <= 1 && hi < 12) score += 1;
  }
  return Math.round(score);
}

function equityMC(hole: Card[], board: Card[], nOpp: number, rng: () => number, samples: number): number {
  const used = new Set(hole.concat(board).map(c => c.suit + c.rank));
  const deck: Card[] = [];
  const SU = ['♠','♥','♣','♦'];
  for (let r = 2; r <= 14; r++) for (const s of SU) {
    if (!used.has(s + r)) deck.push(pokerCard(r, s));
  }
  const D = deck.length;
  const need = nOpp * 2 + (5 - board.length);
  const pool = deck.slice();
  const fullBoard: Card[] = new Array(5);
  const mineCards: Card[] = new Array(7);
  const oppCards: Card[] = new Array(7);
  mineCards[0] = hole[0]; mineCards[1] = hole[1];
  let equity = 0;
  for (let it = 0; it < samples; it++) {
    for (let i = 0; i < D; i++) pool[i] = deck[i];
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(rng() * (D - i));
      const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];
    let k = nOpp * 2;
    for (let i = board.length; i < 5; i++) fullBoard[i] = pool[k++];
    mineCards[2]=fullBoard[0]; mineCards[3]=fullBoard[1]; mineCards[4]=fullBoard[2]; mineCards[5]=fullBoard[3]; mineCards[6]=fullBoard[4];
    const mine = evaluate(mineCards);
    let tied = 1, beaten = false;
    for (let o = 0; o < nOpp; o++) {
      oppCards[0]=pool[o*2]; oppCards[1]=pool[o*2+1];
      oppCards[2]=fullBoard[0]; oppCards[3]=fullBoard[1]; oppCards[4]=fullBoard[2]; oppCards[5]=fullBoard[3]; oppCards[6]=fullBoard[4];
      const cmp = compareEval(mine, evaluate(oppCards));
      if (cmp < 0) { beaten = true; break; }
      if (cmp === 0) tied++;
    }
    if (!beaten) equity += 1 / tied;
  }
  return equity / samples;
}

function deriveSeed(state: GameState, seat: number): number {
  const p = state.players[seat];
  let s = (state.seed >>> 0) ^ (seat * 2654435761);
  s = (s ^ (p.committed * 40503)) >>> 0;
  s = (s ^ (state.board.length * 2246822519)) >>> 0;
  s = (s ^ (Math.round(state.pot) * 3266489917)) >>> 0;
  return s >>> 0;
}

function activeOpponents(state: GameState, seat: number): number {
  return state.players.filter(p => p.seat !== seat && !p.folded).length;
}
function inPosition(state: GameState, seat: number): boolean {
  const order = seatOrderFrom(state, (state.button + 1) % state.n).filter(s => !state.players[s].folded);
  const idx = order.indexOf(seat);
  if (idx < 0) return false;
  return idx >= Math.floor(order.length / 2);
}

function sizeBet(state: GameState, la: LegalActions, betFrac: number): { action: string; amount: number } {
  const pot = Math.max(state.pot, state.bb);
  if (la.canBet) {
    let to = Math.max(Math.round(pot * betFrac), state.bb);
    to = Math.min(to, la.maxRaiseTo!);
    return { action: 'bet', amount: to };
  }
  const target = state.currentBet + Math.round((pot + (la.toCall || 0)) * betFrac);
  let to = Math.max(target, la.minRaiseTo!);
  to = Math.min(to, la.maxRaiseTo!);
  return { action: 'raise', amount: to };
}

function pct(x: number): string { return Math.round(x * 100) + '%'; }

interface AIDecision { action: string; amount?: number; meta: { equity: number; why: string; persona: string } }

function aiDecide(state: GameState, seat: number, opts?: { persona?: string; soul?: string; samples?: number }): AIDecision | null {
  opts = opts || {};
  const la = legalActions(state, seat);
  if (!la.toAct) return null;
  const P = opts.persona ? persona(opts.persona) : opts.soul ? personaForSoul(opts.soul) : persona('tag');
  const rng = mulberry32(deriveSeed(state, seat));
  const roll = () => rng();
  const p = state.players[seat];
  const nOpp = activeOpponents(state, seat);
  const pos = inPosition(state, seat);
  const result = (action: string, amount: number | undefined, why: string, equity: number): AIDecision =>
    ({ action, amount, meta: { equity: Math.round((equity || 0) * 100) / 100, why, persona: P.name } });
  const sizeBetR = (la2: LegalActions, frac: number, why: string, eq: number): AIDecision => {
    const b = sizeBet(state, la2, frac);
    return { action: b.action, amount: b.amount, meta: { equity: Math.round((eq||0)*100)/100, why, persona: '' } };
  };

  if (state.street === 'preflop' && state.board.length === 0) {
    const chen = chenScore(p.hole);
    const bbLeft = p.stack / state.bb;
    let gate = P.chenGate + Math.min(2, Math.floor(Math.max(0, nOpp - 1) / 2)) - (pos ? 1 : 0);
    const strong = chen >= gate + 4;
    const playable = chen >= gate;
    if (bbLeft <= 10) {
      if (strong && (la.canRaise || la.canBet)) return result('allin', la.maxRaiseTo, `短码强牌(Chen ${chen})直接全下`, 0.6);
      if (la.canCheck) return result('check', 0, `短码免费看翻牌`, 0.4);
      if (playable && la.canCall && (la.toCall || 0) <= p.stack * 0.25) return result('call', 0, `短码跟注博一手(Chen ${chen})`, 0.42);
      return result('fold', 0, `短码弱牌(Chen ${chen})弃`, 0.2);
    }
    if (la.canCheck) {
      if (strong && (la.canRaise || la.canBet) && roll() > 0.12) return sizeBetR(la, P.betFrac, `大盲位强牌(Chen ${chen})加注隔离`, 0.6);
      return result('check', 0, `大盲免费看翻牌`, 0.45);
    }
    if (playable) {
      if (strong && (la.canRaise || la.canBet) && roll() > 0.12) return sizeBetR(la, P.betFrac, `强起手(Chen ${chen})加注`, 0.6);
      if (la.canRaise && chen >= gate + 2 && roll() < P.threeBet) return sizeBetR(la, P.betFrac, `中强牌(Chen ${chen})主动加注`, 0.52);
      if (la.canCall) return result('call', 0, `够玩(Chen ${chen})跟注入池`, 0.45);
    }
    if (pos && la.canRaise && (la.toCall || 0) <= state.bb * 1.5 && roll() < P.bluff)
      return sizeBetR(la, P.betFrac, `有位置偷盲诈唬`, 0.35);
    return result('fold', 0, `起手偏弱(Chen ${chen})弃牌`, 0.2);
  }

  const samples = opts.samples || 160;
  const eq = equityMC(p.hole, state.board, Math.max(1, nOpp), rng, samples);
  const potOdds = (la.toCall || 0) > 0 ? (la.toCall || 0) / (state.pot + (la.toCall || 0)) : 0;

  if (la.canCheck) {
    if (eq >= 0.62 && roll() < P.aggr) return sizeBetR(la, P.betFrac, `成手较强(胜率${pct(eq)})价值下注`, eq);
    if (eq < 0.35 && pos && roll() < P.bluff) return sizeBetR(la, P.betFrac, `低胜率+有位置诈唬`, eq);
    if (eq >= 0.50 && roll() < P.aggr * 0.6) return sizeBetR(la, P.betFrac * 0.7, `中等牌薄价值下注(胜率${pct(eq)})`, eq);
    return result('check', 0, `控池过牌(胜率${pct(eq)})`, eq);
  }
  const callLine = Math.max(potOdds, 0);
  const stickyLine = P.callEq;
  if (eq >= 0.66 && la.canRaise && roll() < P.aggr) return sizeBetR(la, P.betFrac, `强牌(胜率${pct(eq)})加注要价值`, eq);
  if (eq >= 0.55 && la.canRaise && roll() < P.threeBet) return sizeBetR(la, P.betFrac * 0.8, `较强(胜率${pct(eq)})主动加注`, eq);
  if (eq >= callLine && eq >= Math.min(stickyLine, 0.5)) return result('call', 0, `胜率${pct(eq)}≥赔率${pct(callLine)}跟注`, eq);
  if (P.key === 'station' && eq >= stickyLine) return result('call', 0, `跟注站硬跟(胜率${pct(eq)})`, eq);
  if (eq >= 0.30 && la.canRaise && pos && roll() < P.bluff) return sizeBetR(la, P.betFrac * 0.9, `听牌半诈唬加注`, eq);
  return result('fold', 0, `胜率${pct(eq)}<赔率${pct(callLine)}弃牌`, eq);
}

// ═══════════════════════════════════════════════════════════════
// 脱敏快照（移植自 poker-net.js）
// ═══════════════════════════════════════════════════════════════

function cardPlain(c: Card): any {
  if (!c) return c;
  return { rank: c.rank, suit: c.suit, label: c.label || '', id: c.id };
}

function snapshot(state: GameState, handNo: number, turnDeadlineMs?: number): any {
  const snap: any = {
    v: 'nlhe',
    handNo,
    turnDeadline: turnDeadlineMs || 0,
    turnDurMs: 0,
    phase: state.phase, street: state.street,
    n: state.n, button: state.button, sb: state.sb, bb: state.bb,
    sbSeat: state.sbSeat, bbSeat: state.bbSeat,
    currentBet: state.currentBet, minRaise: state.minRaise, aggressor: state.aggressor,
    toAct: state.toAct, pot: state.pot,
    board: (state.board || []).map(cardPlain),
    players: (state.players || []).map((p) => ({
      seat: p.seat, name: p.name, isAI: !!p.isAI,
      stack: p.stack, start: p.start,
      folded: !!p.folded, allin: !!p.allin,
      committed: p.committed, street: p.street, acted: !!p.acted,
      hole: [],
    })),
    result: null,
  };
  if (state.result) {
    const res = state.result;
    snap.result = {
      wentToShowdown: !!res.wentToShowdown,
      board: (res.board || []).slice(),
      pots: (res.pots || []).map((p: any) => ({
        amount: p.amount, eligible: (p.eligible||[]).slice(), winners: (p.winners||[]).slice(), handName: p.handName,
      })),
      winnersBySeat: (res.winnersBySeat || []).slice(),
      delta: Object.assign({}, res.delta),
      stacks: Object.assign({}, res.stacks),
      button: res.button,
    };
    if (res.reveal) {
      snap.result.reveal = {};
      for (const s in res.reveal) {
        snap.result.reveal[s] = { hole: (res.reveal[s].hole||[]).slice(), hand: res.reveal[s].hand, cat: res.reveal[s].cat };
      }
    }
  }
  return snap;
}

// ═══════════════════════════════════════════════════════════════
// 状态序列化/反序列化（DB ↔ 引擎状态）
// ═══════════════════════════════════════════════════════════════

function serializeState(state: GameState, handNum: number): any {
  const holes: Record<string, string[]> = {};
  for (const p of state.players) {
    if (p.uid && p.hole.length > 0) {
      holes[p.uid] = p.hole.map(c => c.id);
    }
  }
  return {
    handNum,
    phase: state.phase,
    deck: { cards: state._deck.cards.map((c: Card) => ({ rank: c.rank, suit: c.suit, label: c.label, id: c.id })), cursor: state._deck.cursor },
    hole_cards: holes,
    community: state.board.map(cardPlain),
    pots: state.result?.pots || [],
    seats: state.players.map(p => ({
      seat: p.seat, id: p.id, uid: p.uid, name: p.name, isAI: p.isAI,
      stack: p.stack, start: p.start, folded: p.folded, allin: p.allin,
      committed: p.committed, street: p.street, acted: p.acted, sitOut: p.sitOut,
      hole: p.hole.map((c: Card) => ({ rank: c.rank, suit: c.suit, label: c.label, id: c.id })),
    })),
    action_seat: state.toAct,
    dealer_seat: state.button,
    sb_seat: state.sbSeat,
    bb_seat: state.bbSeat,
    min_raise: state.minRaise,
    current_bet: state.currentBet,
    pot_total: state.pot,
    street: state.street,
    full_state: {
      seed: state.seed, n: state.n, sb: state.sb, bb: state.bb,
      aggressor: state.aggressor,
      result: state.result,
      log: state.log,
      button: state.button,
    },
  };
}

function deserializeState(row: any): { state: GameState; handNum: number } | null {
  if (!row || !row.seats || !row.full_state) return null;
  const fs = typeof row.full_state === 'string' ? JSON.parse(row.full_state) : row.full_state;
  const seats: any[] = typeof row.seats === 'string' ? JSON.parse(row.seats) : row.seats;
  const players: Player[] = seats.map((s: any) => ({
    id: s.id || ('p' + s.seat),
    seat: s.seat, name: s.name || ('席' + s.seat), isAI: !!s.isAI,
    stack: s.stack || 0, start: s.start || 0,
    hole: (s.hole || []).map((c: any) => ({
      rank: typeof c.rank === 'number' ? c.rank : parseInt(String(c).replace(/\D/g, '') || '0', 10),
      suit: typeof c === 'object' ? (c.suit || '?') : '?',
      label: typeof c === 'object' ? (c.label || '') : '',
      id: typeof c === 'object' ? (c.id || '') : (typeof c === 'string' ? c : ''),
    })),
    folded: !!s.folded, allin: !!s.allin, sitOut: !!s.sitOut,
    committed: s.committed || 0, street: s.street || 0, acted: !!s.acted,
    uid: s.uid,
  }));

  const deckData = typeof row.deck === 'string' ? JSON.parse(row.deck) : (row.deck || { cards: [], cursor: 0 });
  const deckCards: Card[] = (deckData.cards || []).map((c: any) => ({
    rank: c.rank, suit: c.suit, label: c.label || '', id: c.id || '',
  }));

  const communityRaw = typeof row.community === 'string' ? JSON.parse(row.community) : (row.community || []);
  const community: Card[] = communityRaw.map((c: any) => ({
    rank: c.rank, suit: c.suit, label: c.label || '', id: c.id || '',
  }));

  const state: GameState = {
    variant: 'nlhe',
    phase: row.phase || 'preflop',
    seed: fs.seed || 0,
    n: fs.n || players.length,
    button: fs.button ?? row.dealer_seat ?? 0,
    sb: fs.sb || 50,
    bb: fs.bb || 100,
    players,
    board: community,
    _deck: { cards: deckCards, cursor: deckData.cursor || 0 },
    street: row.street || 'preflop',
    currentBet: row.current_bet || 0,
    minRaise: row.min_raise || 0,
    aggressor: fs.aggressor ?? null,
    toAct: row.action_seat ?? -1,
    pot: row.pot_total || 0,
    result: fs.result || null,
    log: fs.log || [],
    sbSeat: row.sb_seat,
    bbSeat: row.bb_seat,
  };
  return { state, handNum: row.hand_num || 0 };
}

// ═══════════════════════════════════════════════════════════════
// AI 循环
// ═══════════════════════════════════════════════════════════════

function runAILoop(state: GameState, handNum: number, seatsData: any[]): void {
  let maxIters = 30;
  while (maxIters-- > 0 && state.phase !== 'over' && state.toAct >= 0) {
    const seat = state.toAct;
    const p = state.players[seat];
    if (!p.isAI) break;

    const seatData = seatsData ? seatsData[seat] : null;
    const soul = seatData?.soul || seatData?.archetype;

    try {
      const decision = aiDecide(state, seat, { soul, samples: 100 });
      if (!decision) break;
      const action = decision.action;
      const amount = decision.amount;
      const la = legalActions(state, seat);
      if (!la.toAct) break;
      if (action === 'check' && !la.canCheck) continue;
      if (action === 'call' && !la.canCall) continue;
      if ((action === 'bet' || action === 'raise') && !la.canBet && !la.canRaise) {
        if (la.canCall) applyAction(state, seat, 'call');
        else if (la.canCheck) applyAction(state, seat, 'check');
        else applyAction(state, seat, 'fold');
        continue;
      }
      applyAction(state, seat, action, amount);
    } catch {
      try {
        const la = legalActions(state, seat);
        if (la.canCheck) applyAction(state, seat, 'check');
        else if (la.canCall) applyAction(state, seat, 'call');
        else applyAction(state, seat, 'fold');
      } catch { break; }
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// 主处理器
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || 'https://cddkniwbhvcbfgkgomtl.supabase.co';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

async function verifyUser(req: Request): Promise<{ uid: string | null; error?: string }> {
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { uid: null, error: 'no_token' };
  try {
    const client = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await client.auth.getUser();
    if (error || !data?.user) return { uid: null, error: 'invalid_token' };
    return { uid: data.user.id };
  } catch {
    return { uid: null, error: 'auth_failed' };
  }
}

async function broadcastSnapshot(client: any, tableId: string, snap: any): Promise<void> {
  try {
    const channel = client.channel(`gt-play:${tableId}`);
    await new Promise<void>((resolve) => {
      channel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED' || status === 'TIMED_OUT' || status === 'CLOSED') resolve();
      });
      setTimeout(resolve, 3000);
    });
    await channel.send({ type: 'broadcast', event: 'snap', payload: snap });
    setTimeout(() => { try { channel.unsubscribe(); } catch {} }, 1000);
  } catch {}
}

const TURN_DEADLINE_MS = 30000;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'method_not_allowed' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid_json' }, 400); }
  if (!body || !body.table_id) return json({ ok: false, error: 'missing_table_id' }, 400);
  if (!body.action) return json({ ok: false, error: 'missing_action' }, 400);

  const { uid, error: authError } = await verifyUser(req);
  if (!uid) return json({ ok: false, error: 'auth_failed', detail: authError }, 401);

  const tableId = body.table_id;
  const action = body.action;
  const amount = body.amount;
  const userUid = uid;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { data: tableRow, error: tableErr } = await adminClient
      .from('eh_game_tables').select('*').eq('id', tableId).maybeSingle();
    if (tableErr || !tableRow) return json({ ok: false, error: 'table_not_found' }, 404);
    if (tableRow.game !== 'nlhe') return json({ ok: false, error: 'not_poker_table' }, 400);

    const { data: hsRow } = await adminClient
      .from('eh_hand_state').select('*').eq('table_id', tableId).maybeSingle();

    let state: GameState | null = null;
    let handNum = 0;

    if (hsRow) {
      const deserialized = deserializeState(hsRow);
      if (deserialized) {
        state = deserialized.state;
        handNum = deserialized.handNum;
      }
    }

    // ── start_hand: 开新一手牌 ──
    if (action === 'start_hand') {
      if (state && state.phase !== 'over' && state.phase !== 'showdown') {
        return json({ ok: false, error: 'hand_in_progress' }, 400);
      }
      const seats = tableRow.seats || [];
      const mySeatData = seats.find((s: any) => s && s.uid === userUid && s.kind === 'human');
      if (!mySeatData) return json({ ok: false, error: 'not_seated' }, 403);

      const names: string[] = [];
      const isAI: boolean[] = [];
      const uids: string[] = [];
      const stacks: number[] = [];

      const humanUids = seats.filter((s: any) => s && s.uid && s.kind === 'human').map((s: any) => s.uid);
      const { data: chipsMap } = await adminClient.rpc('eh_chips_get_many', {
        p_uids: humanUids, p_game: 'nlhe',
      });

      for (const s of seats) {
        if (!s || s.kind === 'empty' || !s.uid) {
          names.push('空位'); isAI.push(true); uids.push(''); stacks.push(0); continue;
        }
        names.push(s.name || '玩家');
        isAI.push(s.kind !== 'human');
        uids.push(s.uid);
        const chips = chipsMap && chipsMap[s.uid] !== undefined ? chipsMap[s.uid] : (s.chips || 2000);
        stacks.push(chips);
      }

      if (names.filter((_: any, i: number) => stacks[i] > 0).length < 2) {
        return json({ ok: false, error: 'need_2_seated' }, 400);
      }

      let button = 0;
      if (state) button = (state.button + 1) % names.length;
      else button = seats.findIndex((s: any) => s && s.uid === userUid);
      if (button < 0) button = 0;

      handNum = handNum + 1;
      state = createGame({ names, isAI, uids, stacks, sb: 50, bb: 100, startStack: 2000, button });

      runAILoop(state, handNum, seats);

      const serialized = serializeState(state, handNum);
      const deadline = state.toAct >= 0 && state.phase !== 'over'
        ? new Date(Date.now() + TURN_DEADLINE_MS).toISOString() : null;
      const snapDeadline = deadline ? Date.now() + TURN_DEADLINE_MS : 0;

      await adminClient.from('eh_hand_state').upsert({
        table_id: tableId, hand_num: handNum, phase: state.phase,
        deck: serialized.deck, hole_cards: serialized.hole_cards,
        community: serialized.community, pots: serialized.pots,
        seats: serialized.seats, action_seat: state.toAct,
        dealer_seat: state.button, sb_seat: state.sbSeat, bb_seat: state.bbSeat,
        min_raise: state.minRaise, current_bet: state.currentBet,
        pot_total: state.pot, street: state.street,
        turn_deadline: deadline, full_state: serialized.full_state,
        updated_at: new Date().toISOString(),
      });

      const snap = snapshot(state, handNum, snapDeadline);
      await broadcastSnapshot(adminClient, tableId, snap);
      return json({ ok: true, snap });
    }

    // ── fold/check/call/raise/allin: 玩家操作 ──
    if (['fold','check','call','raise','allin'].includes(action)) {
      if (!state) return json({ ok: false, error: 'no_active_hand' }, 400);
      if (state.phase === 'over') return json({ ok: false, error: 'hand_over' }, 400);

      const mySeat = state.players.findIndex(p => p.uid === userUid);
      if (mySeat < 0) return json({ ok: false, error: 'not_in_hand' }, 403);
      if (state.toAct !== mySeat) return json({ ok: false, error: 'not_your_turn' }, 400);

      try {
        applyAction(state, mySeat, action, amount);
      } catch (e: any) {
        return json({ ok: false, error: e.message || 'illegal_action' }, 400);
      }

      runAILoop(state, handNum, tableRow.seats || []);

      const serialized = serializeState(state, handNum);
      const deadline = state.toAct >= 0 && state.phase !== 'over'
        ? new Date(Date.now() + TURN_DEADLINE_MS).toISOString() : null;
      const snapDeadline = deadline ? Date.now() + TURN_DEADLINE_MS : 0;

      await adminClient.from('eh_hand_state').upsert({
        table_id: tableId, hand_num: handNum, phase: state.phase,
        deck: serialized.deck, hole_cards: serialized.hole_cards,
        community: serialized.community, pots: serialized.pots,
        seats: serialized.seats, action_seat: state.toAct,
        dealer_seat: state.button, sb_seat: state.sbSeat, bb_seat: state.bbSeat,
        min_raise: state.minRaise, current_bet: state.currentBet,
        pot_total: state.pot, street: state.street,
        turn_deadline: deadline, full_state: serialized.full_state,
        updated_at: new Date().toISOString(),
      });

      if (state.phase === 'over' && state.result) {
        for (const p of state.players) {
          if (p.uid && !p.isAI) {
            try {
              await adminClient.rpc('eh_chips_set', {
                p_uid: p.uid, p_game: 'nlhe', p_chips: p.stack,
              });
            } catch {}
          }
        }
      }

      const snap = snapshot(state, handNum, snapDeadline);
      await broadcastSnapshot(adminClient, tableId, snap);
      return json({ ok: true, snap });
    }

    return json({ ok: false, error: 'unknown_action' }, 400);
  } catch (e: any) {
    return json({ ok: false, error: 'server_error', detail: e?.message || String(e) }, 500);
  }
});
