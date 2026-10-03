// ============================================================
// poker-ai.js — 德州扑克「全局意识」启发式 AI（纯函数，无 DOM/网络）
// ------------------------------------------------------------
// 主人问题:「不光是残局犯傻, 全局能有 AI 意识吗」——这里给的是"从翻前到河牌
// 都在算牌力、算彩池赔率、看位置、控诈唬频率"的整手意识, 不是逐街拍脑袋。
//
// 决策五要素:
//   1. 牌力    · 翻前用 Chen 公式给起手牌打分; 翻后用【可复现蒙特卡洛】跑真实胜率
//                (随机发对手底牌+补齐公共牌, 摊牌统计——多人局胜率天然会随对手数下降)。
//   2. 彩池赔率 · 跟注额 / (底池+跟注额); 胜率 ≥ 赔率才有利可图。
//   3. 位置    · 有位置(靠后行动)时放宽门槛、更主动。
//   4. 筹码    · 短码翻前直接推/弃; 深码才玩翻后。
//   5. 性格    · 5 种灵魂原型映射 5 路打法(岩石/紧凶/松凶/疯子/跟注站),
//                调节 入池松紧 / 激进度 / 诈唬频率 / 跟注胜率线。
// 随机全部走 seed 派生的 PRNG(蒙特卡洛、诈唬骰子)→ 决策确定性可测/可回放。
// AI 只看自己底牌+公共牌+对手【张数】, 绝不偷看对手底牌。
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./deck.js') : (root.EHDeck),
    (typeof require==='function') ? require('./poker-eval.js') : (root.EHPokerEval),
    (typeof require==='function') ? require('./poker-engine.js') : (root.EHPokerEngine)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHPokerAI = mod;
})(this, function(Deck, Eval, Engine){
  'use strict';

  // ── 5 路打法(灵魂性格 → 扑克风格) ──────────────────────────
  //   chenGate 越高越只玩强牌(紧); aggr 越高越爱下注/加注; bluff 诈唬频率;
  //   callEq 跟注需要的最低胜率线(跟注站可低于赔率硬跟); betFrac 下注占底池比例。
  const PERSONAS = {
    rock:    { key:'rock',    name:'岩石',   chenGate:8,  aggr:0.35, bluff:0.02, callEq:0.55, betFrac:0.70, threeBet:0.10 },
    tag:     { key:'tag',     name:'紧凶',   chenGate:6,  aggr:0.68, bluff:0.12, callEq:0.48, betFrac:0.65, threeBet:0.30 },
    lag:     { key:'lag',     name:'松凶',   chenGate:4,  aggr:0.82, bluff:0.30, callEq:0.40, betFrac:0.70, threeBet:0.45 },
    maniac:  { key:'maniac',  name:'疯子',   chenGate:1,  aggr:0.93, bluff:0.48, callEq:0.33, betFrac:0.85, threeBet:0.60 },
    station: { key:'station', name:'跟注站', chenGate:4,  aggr:0.15, bluff:0.03, callEq:0.28, betFrac:0.50, threeBet:0.05 },
  };
  const PERSONA_KEYS = Object.keys(PERSONAS);
  function persona(key){ return PERSONAS[key] || PERSONAS.tag; }

  // 5 种灵魂原型 → 打法(app 层按房里的灵魂身份挑; 兜底 tag)
  const SOUL_STYLE = {
    warm:'station',    // 暖场型 → 爱跟注
    cool:'rock',       // 清冷型 → 紧
    sharp:'tag',       // 锐利型 → 紧凶
    wild:'maniac',     // 狂放型 → 疯子
    playful:'lag',     // 顽皮型 → 松凶
  };
  function personaForSoul(archetype){ return persona(SOUL_STYLE[archetype] || 'tag'); }

  // ── Chen 公式: 翻前起手牌打分(约 -1..20, AA=20) ──────────────
  function chenScore(hole){
    const hi = Math.max(hole[0].rank, hole[1].rank);
    const lo = Math.min(hole[0].rank, hole[1].rank);
    const hs = r => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let score;
    if (hole[0].rank === hole[1].rank){         // 对子: 高牌分×2, 至少 5
      score = Math.max(hs(hi) * 2, 5);
    } else {
      score = hs(hi);
      if (hole[0].suit === hole[1].suit) score += 2;   // 同花 +2
      const gap = hi - lo - 1;                          // 中间断张数
      if (gap === 1) score -= 1;
      else if (gap === 2) score -= 2;
      else if (gap === 3) score -= 4;
      else if (gap >= 4) score -= 5;
      if (gap <= 1 && hi < 12) score += 1;              // 连张顺子潜力(都<Q)
    }
    return Math.round(score);
  }

  // ── 可复现蒙特卡洛: 估算当前牌力(胜率份额, 多人局天然下降) ──
  function equityMC(hole, board, nOpp, rng, samples){
    const used = new Set(hole.concat(board).map(c => c.suit + c.rank));
    const deck = [];
    const SU = ['♠','♥','♣','♦'];
    for (let r = 2; r <= 14; r++) for (const s of SU){
      if (!used.has(s + r)) deck.push({ rank:r, suit:s });
    }
    // ── 复用缓冲, 削减每样本的数组分配(GC churn) ──
    // 每样本都把 pool 重置回原始 deck 顺序再洗 → 抽到的牌与"逐次 deck.slice()"完全一致;
    // rng 调用次数/顺序不变(仍是 need 次), 故 equity 结果零漂移(有 golden 值回归守着)。
    // evaluate() 只读入参、从不改写(已核对 poker-eval), 因此 7 张成手用一个 scratch 反复回填是安全的。
    const D = deck.length;
    const need = nOpp * 2 + (5 - board.length);
    const pool = deck.slice();
    const fullBoard = new Array(5);
    const mineCards = new Array(7);   // [底牌0, 底牌1, 公共5]
    const oppCards  = new Array(7);
    mineCards[0] = hole[0]; mineCards[1] = hole[1];
    let equity = 0;
    for (let it = 0; it < samples; it++){
      for (let i = 0; i < D; i++) pool[i] = deck[i];   // 重置到原始顺序(等价于 deck.slice(), 但不再分配)
      // Fisher-Yates 抽样(用 rng, 只洗前面需要的张数)
      for (let i = 0; i < need; i++){
        const j = i + Math.floor(rng() * (D - i));
        const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
      }
      // 公共牌: 已知的照抄, 缺的从 opp 牌之后补(保持原实现"先取 opp 两张、再补 board"的抽牌顺序)
      for (let i = 0; i < board.length; i++) fullBoard[i] = board[i];
      let k = nOpp * 2;
      for (let i = board.length; i < 5; i++) fullBoard[i] = pool[k++];
      mineCards[2]=fullBoard[0]; mineCards[3]=fullBoard[1]; mineCards[4]=fullBoard[2]; mineCards[5]=fullBoard[3]; mineCards[6]=fullBoard[4];
      const mine = Eval.evaluate(mineCards);
      let tied = 1, beaten = false;
      for (let o = 0; o < nOpp; o++){
        oppCards[0]=pool[o*2]; oppCards[1]=pool[o*2+1];
        oppCards[2]=fullBoard[0]; oppCards[3]=fullBoard[1]; oppCards[4]=fullBoard[2]; oppCards[5]=fullBoard[3]; oppCards[6]=fullBoard[4];
        const cmp = Eval.compare(mine, Eval.evaluate(oppCards));
        if (cmp < 0){ beaten = true; break; }
        if (cmp === 0) tied++;
      }
      if (!beaten) equity += 1 / tied;   // 平局按份额分
    }
    return equity / samples;
  }

  // 从局面派生一个确定性种子(同局面→同决策; 便于测试/回放)
  function deriveSeed(state, seat){
    const p = state.players[seat];
    let s = (state.seed >>> 0) ^ (seat * 2654435761);
    s = (s ^ (p.committed * 40503)) >>> 0;
    s = (s ^ (state.board.length * 2246822519)) >>> 0;
    s = (s ^ (Math.round(state.pot) * 3266489917)) >>> 0;
    return s >>> 0;
  }

  function activeOpponents(state, seat){
    return state.players.filter(p => p.seat !== seat && !p.folded).length;
  }
  // 是否有位置: 按翻后行动顺序(按钮左手先动、按钮最后动)排, 处在靠后半程即有位置。
  function inPosition(state, seat){
    const order = Engine.seatOrderFrom(state, (state.button + 1) % state.n)
      .filter(s => !state.players[s].folded);
    const idx = order.indexOf(seat);
    if (idx < 0) return false;
    return idx >= Math.floor(order.length / 2);
  }

  // 按底池比例算下注/加注目标额, 夹到合法区间(触顶即全下)
  function sizeBet(state, la, betFrac){
    const pot = Math.max(state.pot, state.bb);
    if (la.canBet){
      let to = Math.max(Math.round(pot * betFrac), state.bb);
      to = Math.min(to, la.maxRaiseTo);
      return { action:'bet', amount: to };
    }
    // 加注: 目标 = 当前注 + (底池+跟注额)×betFrac, 不低于最小加注
    const target = state.currentBet + Math.round((pot + la.toCall) * betFrac);
    let to = Math.max(target, la.minRaiseTo);
    to = Math.min(to, la.maxRaiseTo);
    return { action:'raise', amount: to };
  }

  // ── 决策入口 ──────────────────────────────────────────────
  // decide(state, seat, opts) → { action, amount?, meta:{equity, why, persona} } | null
  //   opts: { persona:'tag'|..., soul:'sharp'|..., seed?, samples? }
  function decide(state, seat, opts){
    opts = opts || {};
    const la = Engine.legalActions(state, seat);
    if (!la.toAct) return null;
    const P = opts.persona ? persona(opts.persona)
            : opts.soul ? personaForSoul(opts.soul)
            : persona('tag');
    const strategy = opts.strategy || null;
    const rng = Deck.mulberry32((opts.seed != null ? opts.seed : deriveSeed(state, seat)) >>> 0);
    const roll = () => rng();
    const p = state.players[seat];
    const nOpp = activeOpponents(state, seat);
    const pos = inPosition(state, seat);
    const coachAggro = strategy && strategy.pressure === 'take_control';
    const coachCaution = strategy && (strategy.risk_level === 'low' || strategy.pressure === 'preserve_bombs');
    const coachCautionFactor = coachCaution ? 0.72 : 1;
    const result = (action, amount, why, equity) =>
      ({ action, amount, meta: { equity: Math.round((equity || 0) * 100) / 100, why, persona: P.name } });

    // ── 翻前: Chen 打分驱动(理性赢钱策略) ──
    //   强牌(Chen≥10, AA/KK/QQ/AKs)→加注(受每轮2次上限约束)
    //   中等(Chen 6-9)→跟注, 不主动加注
    //   弱牌(Chen<6)→80%弃牌, 20%跟注(偶尔慢玩)
    //   bluff 整体 10%, 只在底池小、对手少时
    if (state.street === 'preflop' && state.board.length === 0){
      const chen = chenScore(p.hole);
      const bbLeft = p.stack / state.bb;
      const strong = chen >= 10;          // AA/KK/QQ/AKs
      const medium = chen >= 6 && chen < 10;
      const weak = chen < 6;

      // 全下保护: 筹码 < 大盲 5 倍 → 强牌直接全下, 弱牌弃牌, 不再跟注消耗
      if (bbLeft < 5){
        if (strong && (la.canRaise || la.canBet)) return result('allin', la.maxRaiseTo, `短码强牌(Chen ${chen})直接全下`, 0.6);
        if (la.canCheck) return result('check', 0, `短码免费看翻牌`, 0.4);
        if (weak) return result('fold', 0, `短码弱牌(Chen ${chen})弃牌`, 0.2);
        if (medium && la.canCall && la.toCall <= p.stack * 0.20) return result('call', 0, `短码中等牌(Chen ${chen})跟注`, 0.45);
        return result('fold', 0, `短码边缘牌(Chen ${chen})弃牌`, 0.25);
      }

      // 正常筹码
      if (la.canCheck){
        // 大盲免费看牌位: 强牌加注隔离(受每轮2次上限约束), 否则过牌
        if (strong && (la.canRaise || la.canBet)) return sizeBetR(state, la, P.betFrac, `强起手(Chen ${chen})加注隔离`, 0.6);
        return result('check', 0, `大盲免费看翻牌`, 0.45);
      }
      if (strong){
        // 强牌加注(受每轮2次上限约束), 加注被上限封住则跟注
        if (la.canRaise || la.canBet) return sizeBetR(state, la, P.betFrac, `强起手(Chen ${chen})加注`, 0.6);
        if (la.canCall) return result('call', 0, `强牌(Chen ${chen})跟注`, 0.55);
      }
      if (medium){
        // 中等牌跟注, 不主动加注
        if (la.canCall) return result('call', 0, `中等起手(Chen ${chen})跟注`, 0.45);
        if (la.canCheck) return result('check', 0, `中等起手(Chen ${chen})过牌`, 0.42);
      }
      // 弱牌(Chen<6): 80%弃牌, 20%跟注(偶尔慢玩); bluff 10% 仅底池小+对手少
      if (la.canCheck) return result('check', 0, `弱起手(Chen ${chen})过牌`, 0.3);
      if (roll() < 0.20 && la.canCall && la.toCall <= state.bb * 1.5) return result('call', 0, `弱牌慢玩(Chen ${chen})跟注`, 0.35);
      if (pos && nOpp <= 2 && (la.canRaise || la.canBet) && la.toCall <= state.bb * 1.5 && roll() < 0.10) return sizeBetR(state, la, P.betFrac, `有位置偷盲诈唬`, 0.35);
      return result('fold', 0, `起手偏弱(Chen ${chen})弃牌`, 0.2);
    }

    // ── 翻后: 胜率(equity)驱动(理性赢钱策略) ──
    //   胜率>70%→加注; 50-70%→跟注; 30-50%→跟注(若跟注<底池25%)否则弃牌; <30%→弃牌(10% bluff)
    //   底池赔率保护: 跟注额>底池1/3 且 胜率<40% → 直接弃牌
    //   随机扰动 ±5%, 让灵魂行为不完全可预测
    const samples = opts.samples || 160;
    let eq = equityMC(p.hole, state.board, Math.max(1, nOpp), rng, samples);
    eq = Math.max(0, Math.min(1, eq + (roll() - 0.5) * 0.10));   // ±5% 扰动
    const potOdds = la.toCall > 0 ? la.toCall / (state.pot + la.toCall) : 0;

    // 全下保护: 翻后短码(<5bb) → 强牌全下, 弱牌弃牌
    const bbLeftPost = p.stack / state.bb;
    if (bbLeftPost < 5){
      if (eq >= 0.60 && (la.canRaise || la.canBet)) return result('allin', la.maxRaiseTo, `短码强成手(胜率${pct(eq)})全下`, eq);
      if (la.canCheck) return result('check', 0, `短码控池过牌(胜率${pct(eq)})`, eq);
      if (eq >= 0.45 && la.toCall <= p.stack * 0.4 && la.canCall) return result('call', 0, `短码中等(胜率${pct(eq)})跟注`, eq);
      return result('fold', 0, `短码弱牌(胜率${pct(eq)})弃牌`, eq);
    }

    if (la.canCheck){
      // 无人下注
      if (eq > 0.70 && (la.canRaise || la.canBet)) return sizeBetR(state, la, P.betFrac, `强成手(胜率${pct(eq)})价值下注`, eq);
      // 50-70% / 30-50%: 控池过牌(无人下注时不必自掏)
      // 胜率<30%: 偶尔 bluff 10%(底池小、对手少)
      if (eq < 0.30 && pos && nOpp <= 2 && (la.canBet || la.canRaise) && roll() < 0.10) return sizeBetR(state, la, P.betFrac * 0.8, `低胜率诈唬偷池`, eq);
      return result('check', 0, `控池过牌(胜率${pct(eq)})`, eq);
    }

    // 面对下注: 比较胜率与底池赔率
    // 底池赔率保护: 跟注额 > 底池 1/3 且 胜率 < 40% → 直接弃牌
    if (la.toCall > state.pot / 3 && eq < 0.40) return result('fold', 0, `赔率不利(胜率${pct(eq)}<40%, 跟注>底池1/3)弃牌`, eq);
    if (eq > 0.70 && la.canRaise) return sizeBetR(state, la, P.betFrac, `强成手(胜率${pct(eq)})加注要价值`, eq);
    if (eq >= 0.50) return result('call', 0, `胜率${pct(eq)}跟注`, eq);   // 50-70% 跟注
    // 30-50%: 跟注金额 < 底池 25% 才跟, 否则弃牌
    if (eq >= 0.30){
      if (la.toCall < state.pot * 0.25 && la.canCall) return result('call', 0, `边缘胜率${pct(eq)}小注跟注`, eq);
      return result('fold', 0, `边缘胜率${pct(eq)}大注弃牌`, eq);
    }
    // 胜率<30%: 弃牌, 偶尔 bluff 10%
    if (pos && nOpp <= 2 && la.canRaise && roll() < 0.10) return sizeBetR(state, la, P.betFrac * 0.8, `低胜率半诈唬`, eq);
  }

  // sizeBet 包一层带 meta 的返回
  function sizeBetR(state, la, frac, why, eq){
    const b = sizeBet(state, la, frac);
    return { action: b.action, amount: b.amount, meta: { equity: Math.round((eq||0)*100)/100, why, persona:'' } };
  }
  function pct(x){ return Math.round(x * 100) + '%'; }

  // ── LLM 增强（方案B 决策 + 方案C 对话） ─────────────────────
  // Edge Function 端点（与 strategy-core.js 同项目）
  var POKAI_ENDPOINT = 'https://cddkniwbhvcbfgkgomtl.supabase.co/functions/v1/eh-poker-ai';
  // 可被外部覆盖（测试/不同环境）
  function setEndpoint(url){ POKAI_ENDPOINT = url; }

  // 引擎牌对象 → 字符串（rank+suit 格式，如 "Ah"=红桃A, "Td"=方片10）
  var RANK_LBL = {3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'T',11:'J',12:'Q',13:'K',14:'A',15:'2'};
  var SUIT_LBL = {'♠':'s','♥':'h','♣':'c','♦':'d', s:'s', h:'h', c:'c', d:'d'};
  function cardToStr(c){
    if (!c) return '';
    if (typeof c === 'string') return c;
    var r = RANK_LBL[c.rank] || String(c.rank);
    var s = SUIT_LBL[c.suit] || (c.suit ? c.suit.slice(0,1) : 'x');
    return r + s;
  }

  // 判断是否应该用 LLM 做决策（方案B 触发条件）
  function shouldUseLLM(state, seat, ruleDecision){
    // 只在 turn/river（后期街道，决策更重要）
    if (state.street !== 'turn' && state.street !== 'river') return false;
    var la = Engine.legalActions(state, seat);
    // 对手加注金额 > 底池的 30%（大额加注）
    var bigRaise = la.toCall > 0 && la.toCall > state.pot * 0.3;
    // 或者规则引擎考虑 all-in
    var considerAllin = ruleDecision && ruleDecision.action === 'allin';
    // 或者自己的筹码 < 底池×2（短码关键时刻）
    var shortStack = state.players[seat].stack < state.pot * 0.5;
    return bigRaise || considerAllin || shortStack;
  }

  // 方案B: LLM 决策（异步，超时降级到规则引擎）
  // 返回 { action, amount?, meta, source: 'llm'|'rule' }
  function decideLLM(state, seat, opts, cb){
    opts = opts || {};
    var ruleD = decide(state, seat, opts);
    var soul = opts.soul || 'sharp';
    var name = (state.players[seat] && state.players[seat].name) || '灵魂';
    var emoji = ({warm:'😊', cool:'🧊', sharp:'🎯', wild:'🤪', playful:'😜'})[soul] || '🤖';

    if (!shouldUseLLM(state, seat, ruleD)){
      if (cb) cb(ruleD);
      return ruleD;
    }

    // 构建 LLM 请求
    var p = state.players[seat];
    var la = Engine.legalActions(state, seat);
    var req = {
      type: 'decision',
      archetype: soul,
      name: name,
      emoji: emoji,
      holeCards: p.hole.map(cardToStr),
      communityCards: state.board.map(cardToStr),
      street: state.street,
      pot: Math.round(state.pot),
      toCall: Math.round(la.toCall),
      myStack: Math.round(p.stack),
      position: inPosition(state, seat) ? 'IP' : 'OOP',
      actionHistory: (state.log || []).slice(-12).map(function(l){
        return (l.seat!=null ? ('S'+l.seat+' ') : '') + (l.action || l.t || '');
      }),
    };

    // fire-and-forget: 先返回规则引擎结果，LLM 回包后通过 cb 覆盖
    // MiMo 是推理模型，响应可能较慢；决策侧 2.5s 超时后降级规则引擎（不影响游戏流程）
    var done = false;
    var timer = setTimeout(function(){
      if (!done && cb) { done = true; cb(ruleD); }
    }, 2500);

    try {
      fetch(POKAI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }).then(function(r){ return r.json(); }).then(function(j){
        if (done) return;
        done = true; clearTimeout(timer);
        if (j && j.ok && j.action){
          // 校验 LLM 返回的动作是否合法
          var valid = ['fold','check','call','bet','raise','allin'];
          if (valid.indexOf(j.action) >= 0){
            var llmD = { action: j.action, amount: j.amount, meta: { equity: (ruleD.meta||{}).equity||0, why: 'LLM增强决策', persona: (ruleD.meta||{}).persona||'', confidence: j.confidence||0.5 }, source: 'llm' };
            // 合法性校验：如果 LLM 说不合法的动作（如 canCheck=false 时 check），降级
            if (j.action === 'check' && !la.canCheck) llmD = ruleD;
            if (j.action === 'raise' && !la.canRaise) llmD = ruleD;
            if (j.action === 'bet' && !la.canBet) llmD = ruleD;
            if (j.action === 'call' && !la.canCall) llmD = ruleD;
            // amount 合法性
            if ((llmD.action === 'raise' || llmD.action === 'bet') && typeof llmD.amount === 'number'){
              llmD.amount = Math.max(llmD.amount, la.minRaiseTo || 0);
              llmD.amount = Math.min(llmD.amount, la.maxRaiseTo || llmD.amount);
            }
            if (llmD.source === 'llm' && cb) cb(llmD);
            else if (cb) cb(ruleD);
          } else if (cb) cb(ruleD);
        } else if (cb) cb(ruleD);
      }).catch(function(){
        if (!done && cb) { done = true; clearTimeout(timer); cb(ruleD); }
      });
    } catch(e) {
      clearTimeout(timer);
      if (cb) cb(ruleD);
    }

    return ruleD;  // 立即返回规则引擎结果（同步）
  }

  // 方案C: 性格对话生成（异步 fire-and-forget）
  function taunt(opts, cb){
    var soul = opts.soul || 'sharp';
    var name = opts.name || '灵魂';
    var emoji = ({warm:'😊', cool:'🧊', sharp:'🎯', wild:'🤪', playful:'😜'})[soul] || '🤖';
    var req = {
      type: 'taunt',
      archetype: soul,
      name: name,
      emoji: emoji,
      action: opts.action || 'call',
      amount: opts.amount || 0,
      street: opts.street || 'flop',
      pot: opts.pot || 0,
    };
    var done = false;
    // MiMo 推理模型响应较慢（5-10s），对话侧超时放宽到 10s
    var timer = setTimeout(function(){
      if (!done && cb) { done = true; cb(null); }
    }, 10000);
    try {
      fetch(POKAI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }).then(function(r){ return r.json(); }).then(function(j){
        if (done) return;
        done = true; clearTimeout(timer);
        if (j && j.ok && j.text && cb) cb(j.text);
        else if (cb) cb(null);
      }).catch(function(){
        if (!done && cb) { done = true; clearTimeout(timer); cb(null); }
      });
    } catch(e) {
      clearTimeout(timer);
      if (cb) cb(null);
    }
  }

  return { PERSONAS, PERSONA_KEYS, SOUL_STYLE, persona, personaForSoul, chenScore, equityMC, inPosition, decide, decideLLM, taunt, shouldUseLLM, cardToStr, setEndpoint };
});
