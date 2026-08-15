// ============================================================
// ddz-ai.js — 斗地主启发式 AI（不看别家牌，纯手牌+桌面决策）
// ------------------------------------------------------------
// 设计:不用 LLM(慢/贵/牌逻辑弱)。纯启发式:
//   · 叫地主:按手牌强度(炸/王/2/A 数量+顺子潜力)给分 → 0/1/2/3
//   · 首出(lead):优先出走最小的散牌/顺子,压手的炸弹/王炸留到最后
//   · 跟牌(follow):枚举能压过桌面的最小牌型;临终/对手报单时才动炸弹
//   · 绝不读取别家手牌 → 公平
// 依赖 ddz-rules 的 parse/beats。输出 card 数组(来自传入 hand)或 null(过)。
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./ddz-rules.js') : (root.EHDdzRules)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHDdzAI = mod;
})(this, function(Rules){
  'use strict';

  // rank 分组:rank → [card,...]
  function groupByRank(hand){
    const m = new Map();
    for (const c of hand){
      if (!m.has(c.rank)) m.set(c.rank, []);
      m.get(c.rank).push(c);
    }
    return m;
  }

  // ── 叫地主评分 ──────────────────────────────────────────────
  // 经验分:大王4 小王3 每张2给2 每张A给1;成炸(四张)给6;总分映射到叫分。
  function scoreHand(hand){
    const m = groupByRank(hand);
    let s = 0;
    for (const [rank, cs] of m){
      if (rank === 17) s += 4;
      else if (rank === 16) s += 3;
      else if (rank === 15) s += 2 * cs.length;   // 2
      else if (rank === 14) s += 1 * cs.length;   // A
      if (cs.length === 4) s += 6;                // 炸弹
    }
    // 双王额外奖励
    if (m.has(16) && m.has(17)) s += 4;
    return s;
  }
  function chooseBid(hand, currentMax){
    const s = scoreHand(hand);
    let want = 0;
    if (s >= 11) want = 3;
    else if (s >= 8) want = 2;
    else if (s >= 5) want = 1;
    // 必须高于当前最高分才叫,否则不叫
    if (want <= (currentMax||0)) return 0;
    return want;
  }

  // ── 候选牌型枚举 ────────────────────────────────────────────
  // 找出手牌里所有「单/对/三/炸/王炸」的基础组,按点从小到大。
  function enumBasics(hand){
    const m = groupByRank(hand);
    const singles=[], pairs=[], trios=[], bombs=[];
    let rocket = null;
    const ranks = [...m.keys()].sort((a,b)=>a-b);
    for (const r of ranks){
      const cs = m.get(r);
      if (cs.length >= 1) singles.push([cs[0]]);
      if (cs.length >= 2) pairs.push(cs.slice(0,2));
      if (cs.length >= 3) trios.push(cs.slice(0,3));
      if (cs.length === 4) bombs.push(cs.slice(0,4));
    }
    if (m.has(16) && m.has(17)) rocket = [m.get(16)[0], m.get(17)[0]];
    return { m, ranks, singles, pairs, trios, bombs, rocket };
  }

  // 找所有长度≥minLen 的连续序列(用于顺子/连对/飞机的三连)。
  //   avail:rank→可用张数阈值(单=1,对=2,三=3)。返回 rank 起止列表。
  function findChains(m, needCount, minSeqLen){
    const ok = [];
    for (const [r,cs] of m) if (cs.length >= needCount && r <= 14) ok.push(r);
    ok.sort((a,b)=>a-b);
    const chains = [];
    let i = 0;
    while (i < ok.length){
      let j = i;
      while (j+1 < ok.length && ok[j+1] === ok[j]+1) j++;
      const runLen = j - i + 1;
      if (runLen >= minSeqLen){
        // 生成该连续段内所有 ≥minSeqLen 的子段(取最长优先由调用方决定)
        for (let a = i; a <= j; a++)
          for (let b = a + minSeqLen - 1; b <= j; b++)
            chains.push(ok.slice(a, b+1));
      }
      i = j + 1;
    }
    return chains; // 每项是连续 rank 数组
  }

  function takeCards(m, rank, count){
    return m.get(rank).slice(0, count);
  }

  // 枚举所有能「压过 target」的候选出牌(target=null → 首出候选)。
  // 返回候选数组,每项 {cards, parse}。不含炸弹时另附 bombs/rocket 供上层择机。
  function candidates(hand, target){
    const b = enumBasics(hand);
    const out = [];
    const push = (cards)=>{ const p = Rules.parse(cards); if (p) out.push({cards, parse:p}); };

    if (!target){
      // 首出:给出各种基础型 + 顺子/连对/飞机,交由 lead 策略挑
      b.singles.forEach(push); b.pairs.forEach(push); b.trios.forEach(push);
      // 三带一 / 三带一对
      b.trios.forEach(t=>{
        const rest = hand.filter(c=>c.rank!==t[0].rank);
        const single = rest[0]; // 最小散张(hand 已降序,rest 末尾最小)
        // 取最小的单当翼
        const smallSingle = leastSingle(hand, t[0].rank);
        if (smallSingle) push(t.concat(smallSingle));
        const smallPair = leastPair(b, t[0].rank);
        if (smallPair) push(t.concat(smallPair));
      });
      // 顺子
      findChains(b.m,1,5).forEach(seq=> push(seq.map(r=>takeCards(b.m,r,1)[0])));
      // 连对
      findChains(b.m,2,3).forEach(seq=> push([].concat(...seq.map(r=>takeCards(b.m,r,2)))));
      // 飞机(纯)
      findChains(b.m,3,2).forEach(seq=> push([].concat(...seq.map(r=>takeCards(b.m,r,3)))));
      return { plays: out, bombs: b.bombs, rocket: b.rocket };
    }

    // 跟牌:同型同长且更大
    const t = target;
    const bigger = [];
    const tryPush = (cards)=>{
      const p = Rules.parse(cards);
      if (p && Rules.beats(p, t)) bigger.push({cards, parse:p});
    };
    switch (t.type){
      case 'single':
        b.singles.forEach(s=>{ if (s[0].rank > t.key) tryPush(s); }); break;
      case 'pair':
        b.pairs.forEach(p=>{ if (p[0].rank > t.key) tryPush(p); }); break;
      case 'trio':
        b.trios.forEach(tr=>{ if (tr[0].rank > t.key) tryPush(tr); }); break;
      case 'trio_single':
        b.trios.forEach(tr=>{ if (tr[0].rank > t.key){ const s=leastSingle(hand,tr[0].rank); if(s) tryPush(tr.concat(s)); }}); break;
      case 'trio_pair':
        b.trios.forEach(tr=>{ if (tr[0].rank > t.key){ const p=leastPair(b,tr[0].rank); if(p) tryPush(tr.concat(p)); }}); break;
      case 'straight':
        findChains(b.m,1,t.len).forEach(seq=>{ if (seq.length===t.len && seq[seq.length-1]>t.key) tryPush(seq.map(r=>takeCards(b.m,r,1)[0])); }); break;
      case 'pairs':
        findChains(b.m,2,t.len/2).forEach(seq=>{ if (seq.length===t.len/2 && seq[seq.length-1]>t.key) tryPush([].concat(...seq.map(r=>takeCards(b.m,r,2)))); }); break;
      case 'plane': case 'plane_single': case 'plane_pair': {
        const groups = t.type==='plane' ? t.len/3 : (t.type==='plane_single' ? t.len/4 : t.len/5);
        findChains(b.m,3,groups).forEach(seq=>{
          if (seq.length!==groups || seq[seq.length-1]<=t.key) return;
          const core = [].concat(...seq.map(r=>takeCards(b.m,r,3)));
          if (t.type==='plane'){ tryPush(core); return; }
          // 带翼:从剩余里挑最小的 groups 个单 / groups 个对
          const usedRanks = new Set(seq);
          if (t.type==='plane_single'){
            const wings = pickSmallSingles(hand, usedRanks, groups);
            if (wings) tryPush(core.concat(wings));
          } else {
            const wings = pickSmallPairs(b, usedRanks, groups);
            if (wings) tryPush(core.concat(wings));
          }
        });
        break;
      }
      case 'quad_single': case 'quad_pair':
        // 只有更大的四带 or 炸弹能压;四带较少见,交给炸弹逻辑
        break;
    }
    return { plays: bigger, bombs: b.bombs, rocket: b.rocket };
  }

  // 最小的单张(排除某 rank),用作三带一的翼
  function leastSingle(hand, excludeRank){
    for (let i = hand.length-1; i >= 0; i--) if (hand[i].rank !== excludeRank) return [hand[i]];
    return null;
  }
  function leastPair(b, excludeRank){
    for (const p of b.pairs) if (p[0].rank !== excludeRank) return p;
    return null;
  }
  function pickSmallSingles(hand, usedRanks, n){
    const picks=[]; const seen=new Set();
    for (let i = hand.length-1; i>=0 && picks.length<n; i--){
      const c = hand[i];
      if (usedRanks.has(c.rank)) continue;
      if (seen.has(c.id)) continue;
      picks.push(c); seen.add(c.id);
    }
    return picks.length===n ? picks : null;
  }
  function pickSmallPairs(b, usedRanks, n){
    const picks=[];
    for (const p of b.pairs){ if (usedRanks.has(p[0].rank)) continue; picks.push(...p); if (picks.length===n*2) break; }
    return picks.length===n*2 ? picks : null;
  }

  // ── 决策入口 ────────────────────────────────────────────────
  // state 需含:seat, hand(该 AI 手牌), tableParse(要压的牌;null=首出),
  //   lastSeat(桌面这手是谁出的;null=首出), handsLeft:[n0,n1,n2](各家剩牌数),
  //   landlord, iAmLandlord。
  // 返回 {action:'play', cards} | {action:'pass'}。
  function decide(ctx){
    const hand = ctx.hand;
    const target = ctx.tableParse || null;
    const { plays, bombs, rocket } = candidates(hand, target);

    // 对手是否即将赢(报单/报双):只看「真对手」的剩牌数(队友快赢不算威胁)
    const oppMin = minOpponentCards(ctx);
    const urgent = oppMin <= 2;

    if (!target){
      // 首出:选一手「走小散牌」的。优先出最小单张/顺子,避免拆炸/王。
      const lead = chooseLead(hand, plays, bombs, rocket, ctx);
      return { action:'play', cards: lead };
    }

    // 队友协作:桌面这手是我队友(同为农民)出的 → 一般让牌不压自己人,
    //   除非能「一把出完」直接终结本方胜(农民任一家清空即赢)。
    if (isTeammateLead(ctx)){
      const finisher = plays.find(p => p.cards.length === hand.length);
      if (finisher) return { action:'play', cards: finisher.cards };
      return { action:'pass' };
    }

    // 跟牌:有能压的普通牌 → 出最小的那手(保守),除非能一把走完
    if (plays.length){
      // 若某手出完后手牌清空(接近赢) → 优先
      const finisher = plays.find(p => p.cards.length === hand.length);
      if (finisher) return { action:'play', cards: finisher.cards };
      // 否则挑「代价最小」的一手:优先不拆大牌、点数最小
      plays.sort((a,b)=> playCost(a,hand) - playCost(b,hand));
      // 若对手不紧急,且要出的牌点很大(≥2/A)又是单张,倾向 pass 保牌
      const best = plays[0];
      if (!urgent && best.parse.type==='single' && best.parse.key >= 14 && hand.length > 4){
        // 手里还有更小的可跟吗?没有就 pass
        return { action:'pass' };
      }
      return { action:'play', cards: best.cards };
    }

    // 普通牌压不过 → 考虑炸弹/王炸
    if (urgent || shouldBomb(ctx)){
      if (target.type==='rocket') return { action:'pass' }; // 压不过王炸
      if (bombs.length) return { action:'play', cards: bombs[0] };  // 最小炸
      if (rocket) return { action:'play', cards: rocket };
    }
    return { action:'pass' };
  }

  // 首出策略:走小牌。顺子/连对/飞机 > 三带 > 对 > 单;排除炸弹/王炸/含2的顺。
  function chooseLead(hand, plays, bombs, rocket){
    if (!plays.length){
      // 只剩炸弹/王炸也得出
      if (bombs.length) return bombs[0];
      if (rocket) return rocket;
      return [hand[hand.length-1]]; // 兜底最小单张
    }
    // 若能一把走完(手牌全出) → 直接出
    const finisher = plays.find(p => p.cards.length === hand.length);
    if (finisher) return finisher.cards;
    // 优先长牌型(顺子/连对/飞机)清散牌,同类取点最小
    const rank = (p)=>{
      const order = { straight:0, pairs:0, plane:0, plane_single:0, plane_pair:1, trio_single:2, trio_pair:2, trio:3, pair:4, single:5 };
      return (order[p.parse.type] ?? 9);
    };
    plays.sort((a,b)=>{
      const ra=rank(a), rb=rank(b);
      if (ra!==rb) return ra-rb;
      // 同类:长的优先(清更多牌),再点小优先
      if (b.parse.len !== a.parse.len) return b.parse.len - a.parse.len;
      return a.parse.key - b.parse.key;
    });
    // 避免首出就甩 2/王的单张(留着控场):若最优是大单张且有别的选择,换
    const nonBig = plays.filter(p=>!(p.parse.type==='single' && p.parse.key>=15));
    return (nonBig[0] || plays[0]).cards;
  }

  // 提示排序: 产出 best-first 的可出牌序列(每项 card[]), UI 的「提示」直接吃它。
  //   ① 能一把走完的牌型永远排最前(剩一对提示打整对, 而不是拆成单张一张张出);
  //   ② 领出先出长牌型清散牌、单张垫底、不首选甩 2/王大单张;
  //   ③ 跟牌走最小代价、炸弹/王炸垫底(除非炸弹恰好能一把走完)。
  function hints(hand, target){
    const { plays, bombs, rocket } = candidates(hand, target || null);
    const handN = hand.length;
    let bombItems = [
      ...bombs.map(cards=>({cards, parse:Rules.parse(cards)})),
      ...(rocket ? [{cards:rocket, parse:Rules.parse(rocket)}] : []),
    ].filter(x=>x.parse);
    if (target) bombItems = bombItems.filter(x=>Rules.beats(x.parse, target)); // 跟牌只留能压的炸

    const list = plays.slice();
    if (!target){
      const order = { straight:0, pairs:0, plane:0, plane_single:0, plane_pair:1, trio_single:2, trio_pair:2, trio:3, pair:4, single:5 };
      list.sort((a,b)=>{
        const fa=a.cards.length===handN?0:1, fb=b.cards.length===handN?0:1;
        if (fa!==fb) return fa-fb;                                       // ① 走完优先
        const ra=order[a.parse.type]??9, rb=order[b.parse.type]??9;
        if (ra!==rb) return ra-rb;                                       // 长牌型优先
        const bigA=(a.parse.type==='single'&&a.parse.key>=15)?1:0;
        const bigB=(b.parse.type==='single'&&b.parse.key>=15)?1:0;
        if (bigA!==bigB) return bigA-bigB;                               // 大单张(2/王)垫后
        if (b.parse.len!==a.parse.len) return b.parse.len-a.parse.len;   // 清更多牌
        return a.parse.key-b.parse.key;
      });
    } else {
      list.sort((a,b)=>{
        const fa=a.cards.length===handN?0:1, fb=b.cards.length===handN?0:1;
        if (fa!==fb) return fa-fb;                                       // ① 走完优先
        return playCost(a,hand)-playCost(b,hand);                        // 最小代价
      });
    }
    // 炸弹垫底; 但能一把走完的炸弹提到最前
    const goBombs = bombItems.filter(x=>x.cards.length===handN).map(x=>x.cards);
    const restBombs = bombItems.filter(x=>x.cards.length!==handN).map(x=>x.cards);
    return [...goBombs, ...list.map(p=>p.cards), ...restBombs];
  }

  // 出这手牌的「代价」:拆散了大牌/炸弹惩罚高;点数越大代价越高。
  function playCost(play, hand){
    let cost = play.parse.key;
    // 拆炸弹:若该 rank 在手里有 4 张却只用了 <4 → 重罚
    const m = groupByRank(hand);
    const rankCount = {};
    for (const c of play.cards) rankCount[c.rank] = (rankCount[c.rank]||0)+1;
    for (const r in rankCount){
      const have = m.get(Number(r)) ? m.get(Number(r)).length : 0;
      if (have === 4 && rankCount[r] < 4) cost += 100; // 拆炸
      if (Number(r) >= 16) cost += 50;                 // 拆王
    }
    return cost;
  }

  // 桌面这手牌是不是我队友出的(仅农民之间成立)。缺 lastSeat/landlord 信息时返回 false。
  function isTeammateLead(ctx){
    if (ctx.lastSeat==null || ctx.landlord==null) return false;
    const iAmPeasant = ctx.seat !== ctx.landlord;
    const leaderIsPeasant = ctx.lastSeat !== ctx.landlord;
    return iAmPeasant && leaderIsPeasant && ctx.lastSeat !== ctx.seat;
  }
  // 「真对手」的最小剩牌数:我是地主→两农民都是对手;我是农民→只有地主是对手。
  // 队友(另一农民)剩牌少不构成威胁,不该据此浪费炸弹。缺 landlord 信息时退化为「所有别家」。
  function minOpponentCards(ctx){
    if (!ctx.handsLeft) return 99;
    let mn = 99;
    ctx.handsLeft.forEach((n,seat)=>{
      if (seat===ctx.seat) return;
      if (ctx.landlord!=null){
        const iAmLord = ctx.seat===ctx.landlord;
        const seatIsOpp = iAmLord ? (seat!==ctx.landlord) : (seat===ctx.landlord);
        if (!seatIsOpp) return;    // 队友:跳过
      }
      if (n < mn) mn = n;
    });
    return mn;
  }
  // 是否值得动炸弹(非紧急时):手牌很少 or 炸弹多可以搏
  function shouldBomb(ctx){
    return ctx.hand.length <= 5;
  }

  return {
    scoreHand, chooseBid, decide,
    // 暴露供单测
    candidates, enumBasics, findChains, chooseLead, hints,
  };
});
