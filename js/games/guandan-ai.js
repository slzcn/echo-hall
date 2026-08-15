// ============================================================
// guandan-ai.js — 掼蛋启发式 AI（纯手牌+桌面, 不看别家牌 → 公平）
// ------------------------------------------------------------
//   · 组合枚举带百搭(红桃级牌)补齐 + 级牌抬权, 全程用 guandan-rules 校验合法。
//   · 首出: 走长牌型(顺/连对/钢板/三带二)清散牌, 留百搭/炸弹压轴, 不轻易甩王/级。
//   · 跟牌: 找能压过桌面的最小代价一手; 队友控场则让牌(除非能一把走完)。
//   · 炸弹: 对手报单/自己快走完时才动; 队友快赢不浪费炸。
//   全部输出 card 数组(来自传入 hand)或 pass。
// ============================================================
(function(root, factory){
  const mod = factory(
    (typeof require==='function') ? require('./guandan-rules.js') : (root.EHGuandanRules)
  );
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (typeof window !== 'undefined') window.EHGuandanAI = mod;
})(this, function(Rules){
  'use strict';

  function groups(hand, level){
    const wilds=[], jokers=[], byRank=new Map();
    for (const c of hand){
      if (Rules.isWild(c, level)) wilds.push(c);
      else if (c.joker) jokers.push(c);
      else { const r=Rules.naturalRank(c); if(!byRank.has(r)) byRank.set(r,[]); byRank.get(r).push(c); }
    }
    return { wilds, jokers, byRank };
  }

  // 连续段候选(顺/连对/钢板): groupSize=每档张数, groups=档数。返回 {natCards,wildsNeeded,top}[]
  function findLines(g, groupSize, nGroups, wildBudget){
    const res=[];
    for (let start=1; start+nGroups-1<=14; start++){
      const picks=[]; let need=0;
      for (let k=0;k<nGroups;k++){
        const pos=start+k;
        const rank = pos===1 ? 14 : pos;     // pos1 由 A 充当低位
        const avail = g.byRank.get(rank) || [];
        const use = Math.min(groupSize, avail.length);
        for (let i=0;i<use;i++) picks.push(avail[i]);
        need += (groupSize-use);
      }
      if (need<=wildBudget && need<=g.wilds.length) res.push({ natCards:picks, wildsNeeded:need, top:start+nGroups-1 });
    }
    return res;
  }

  // 枚举全部合法组合(按 maxWild 限制百搭用量), 每项 {cards,parse}。
  function genCombos(hand, level, maxWild){
    const g = groups(hand, level);
    const W = g.wilds;
    const nW = Math.min(maxWild, W.length);
    const combos = [];
    const seen = new Set();
    const add = (cards)=>{
      if (!cards || !cards.length) return;
      const key = cards.map(c=>c.id).sort().join(',');
      if (seen.has(key)) return; seen.add(key);
      const p = Rules.parse(cards, level);
      if (p) combos.push({ cards, parse:p });
    };
    const useW = (n)=> W.slice(0, n);

    // 单张
    for (const [,cs] of g.byRank) add([cs[0]]);
    for (const j of g.jokers) add([j]);
    if (W.length) add([W[0]]);

    // 同点: 对/三/炸(2..张数+百搭)
    for (const [,cs] of g.byRank){
      const maxSize = cs.length + nW;
      for (let size=2; size<=maxSize; size++){
        const wNeed = Math.max(0, size-cs.length);
        if (wNeed>nW) continue;
        add(cs.slice(0, Math.min(size, cs.length)).concat(useW(wNeed)));
      }
    }
    // 王对 / 四大天王
    const bigs=g.jokers.filter(j=>j.joker==='big'), smalls=g.jokers.filter(j=>j.joker==='small');
    if (bigs.length>=2) add([bigs[0],bigs[1]]);
    if (smalls.length>=2) add([smalls[0],smalls[1]]);
    if (bigs.length>=2 && smalls.length>=2) add([bigs[0],bigs[1],smalls[0],smalls[1]]);

    // 三带二: 三 a + 对 b (a≠b)
    const ranks = [...g.byRank.keys()];
    for (const a of ranks){
      for (const b of ranks){
        if (a===b) continue;
        const ca=g.byRank.get(a), cb=g.byRank.get(b);
        const wTrio=Math.max(0,3-ca.length), wPair=Math.max(0,2-cb.length);
        if (wTrio+wPair>nW) continue;
        const cards = ca.slice(0,Math.min(3,ca.length)).concat(useW(wTrio))
          .concat(cb.slice(0,Math.min(2,cb.length))).concat(W.slice(wTrio, wTrio+wPair));
        if (cards.length===5) add(cards);
      }
    }

    // 顺子 / 连对 / 钢板
    findLines(g,1,5,nW).forEach(r=> add(r.natCards.concat(useW(r.wildsNeeded))));
    findLines(g,2,3,nW).forEach(r=> add(r.natCards.concat(useW(r.wildsNeeded))));
    findLines(g,3,2,nW).forEach(r=> add(r.natCards.concat(useW(r.wildsNeeded))));

    // 同花顺(每花色找 5 连; 仅♥可用百搭)
    for (const suit of ['♠','♥','♣','♦']){
      const gs = { byRank:new Map(), wilds: suit==='♥'?W:[] };
      for (const [r,cs] of g.byRank){ const sc=cs.filter(c=>c.suit===suit); if(sc.length) gs.byRank.set(r,sc); }
      const budget = suit==='♥'?nW:0;
      findLines(gs,1,5,budget).forEach(r=>{
        const cards = r.natCards.concat((suit==='♥'?W:[]).slice(0,r.wildsNeeded));
        add(cards);
      });
    }

    return combos;
  }

  function allBombs(hand, level){
    return genCombos(hand, level, groups(hand,level).wilds.length).filter(c=>Rules.isBomb(c.parse));
  }

  // ── 决策 ────────────────────────────────────────────────────
  // ctx: { seat, hand, tableParse, lastSeat, handsLeft:[4], level }
  function decide(ctx){
    const level = ctx.level || 2;
    const hand = ctx.hand;
    const target = ctx.tableParse || null;
    const g = groups(hand, level);

    if (!target){
      return { action:'play', cards: chooseLead(hand, level, ctx) };
    }

    // 队友控场: 桌面这手是对家出的 → 让牌(除非能一把走完)
    if (isTeammateLead(ctx)){
      const all = genCombos(hand, level, g.wilds.length);
      const fin = all.find(c=>c.cards.length===hand.length && Rules.beats(c.parse, target, level));
      if (fin) return { action:'play', cards: fin.cards };
      // 对家出的大牌基本稳赢, 让
      return { action:'pass' };
    }

    // 跟牌: 找能压过的普通牌(尽量不用百搭)
    let follow = genCombos(hand, level, 0).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));
    if (!follow.length && g.wilds.length)   // 无纯天然可压 → 允许百搭
      follow = genCombos(hand, level, g.wilds.length).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));

    const oppMin = minOpponentCards(ctx);
    const urgent = oppMin <= 2;

    if (follow.length){
      const fin = follow.find(c=>c.cards.length===hand.length);
      if (fin) return { action:'play', cards: fin.cards };
      follow.sort((a,b)=> playCost(a,hand,level) - playCost(b,hand,level));
      const best = follow[0];
      // 对手不紧急且要甩大单张(≥A/级) → 保牌不跟
      if (!urgent && best.parse.type==='single' && best.parse.key>=14 && hand.length>4)
        return { action:'pass' };
      return { action:'play', cards: best.cards };
    }

    // 压不过 → 择机上炸
    if (urgent || hand.length<=6){
      const bombs = allBombs(hand, level)
        .filter(c=>Rules.beats(c.parse, target, level))
        .sort((a,b)=>Rules.bombStrength(a.parse)-Rules.bombStrength(b.parse));
      if (bombs.length) return { action:'play', cards: bombs[0].cards };
    }
    return { action:'pass' };
  }

  // 首出: 走长牌型清散牌, 留大牌/百搭/炸压轴
  //   ★残局意识(ctx 可选): 若「对家之外的真对手」已报单(剩 1 张), 领出别甩小单张送他走 ——
  //     剩 1 张者跟不了任何 ≥2 张牌型(1 张也组不成炸), 优先领非单牌型憋住他;
  //     实在只有单张可领, 就领最大的单张(他大概率压不过, 只能过)。
  function chooseLead(hand, level, ctx){
    let combos = genCombos(hand, level, 0);
    if (!combos.length) combos = genCombos(hand, level, groups(hand,level).wilds.length);
    if (!combos.length) return [hand[hand.length-1]];   // 兜底最小单张

    const fin = combos.find(c=>c.cards.length===hand.length);
    if (fin) return fin.cards;

    const order = { straight:0, pairline:0, trioline:0, fullhouse:1, trio:2, pair:3, single:4 };
    const nonBomb = combos.filter(c=>!Rules.isBomb(c.parse));
    let pool = nonBomb.length ? nonBomb : combos;

    // 对手报单: 收窄到多张牌型憋死他; 只有单张时改甩最大单张
    const oppMin = ctx ? minOpponentCards(ctx) : 99;
    if (oppMin === 1){
      const multi = pool.filter(c => c.cards.length >= 2);
      if (multi.length){ pool = multi; }
      else {
        const singles = pool.filter(c => c.parse.type==='single');
        if (singles.length){ singles.sort((a,b)=> b.parse.key - a.parse.key); return singles[0].cards; }
      }
    }
    pool.sort((a,b)=>{
      const ra=order[a.parse.type]??9, rb=order[b.parse.type]??9;
      if (ra!==rb) return ra-rb;
      if (b.parse.len!==a.parse.len) return b.parse.len-a.parse.len;   // 清更多牌
      return a.parse.key-b.parse.key;                                   // 点小优先
    });
    // 避免首出甩大单张(A/级/王); 有别的就换
    const notBig = pool.filter(c=>!(c.parse.type==='single' && c.parse.key>=14));
    return (notBig[0] || pool[0]).cards;
  }

  // 提示排序: 产出 best-first 的可打牌序列(每项 card[])。UI 的「提示」直接吃它。
  // 核心智能: ① 能一把走完的牌型永远排最前(剩一对就提示打对子, 而不是拆成单张一张张出);
  //           ② 领出时先出长牌型清散牌、单张垫底、不轻易甩大单张/拆炸;
  //           ③ 跟牌时最小代价的一手优先、炸弹垫底(除非炸弹能一把走完)。
  function hints(ctx){
    const level = ctx.level || 2;
    const hand = ctx.hand || [];
    const target = ctx.tableParse || null;
    const g = groups(hand, level);
    let combos = genCombos(hand, level, g.wilds.length);
    if (target) combos = combos.filter(c=>Rules.beats(c.parse, target, level));
    if (!combos.length) return [];
    const handN = hand.length;
    const isB = c=>Rules.isBomb(c.parse);
    const leadOrder = { straight:0, pairline:0, trioline:0, fullhouse:1, trio:2, pair:3, single:5 };
    combos.sort((a,b)=>{
      // ① 一把走完 → 最优先(无论领出/跟牌)
      const fa = a.cards.length===handN ? 0:1, fb = b.cards.length===handN ? 0:1;
      if (fa!==fb) return fa-fb;
      if (!target){
        // 领出: 长牌型优先清散牌; 炸弹/大单张垫底; 拆炸代价高的靠后
        const ba = isB(a)?8:(leadOrder[a.parse.type]??6);
        const bb = isB(b)?8:(leadOrder[b.parse.type]??6);
        if (ba!==bb) return ba-bb;
        const bigA = (a.parse.type==='single' && a.parse.key>=14)?1:0;
        const bigB = (b.parse.type==='single' && b.parse.key>=14)?1:0;
        if (bigA!==bigB) return bigA-bigB;
        if (b.parse.len!==a.parse.len) return b.parse.len-a.parse.len;   // 清更多牌
        const ca=playCost(a,hand,level), cb=playCost(b,hand,level);
        if (ca!==cb) return ca-cb;
        return a.parse.key-b.parse.key;                                   // 点小优先
      }
      // 跟牌: 非炸优先(炸弹垫底), 再按代价最小
      const ba = isB(a)?1:0, bb = isB(b)?1:0;
      if (ba!==bb) return ba-bb;
      const ca=playCost(a,hand,level), cb=playCost(b,hand,level);
      if (ca!==cb) return ca-cb;
      return a.cards.length-b.cards.length;
    });
    return combos.map(c=>c.cards);
  }

  function playCost(play, hand, level){
    let cost = play.parse.key;
    const g = groups(hand, level);
    const rc = {};
    for (const c of play.cards){ if(Rules.isWild(c,level)){ cost+=60; continue; } const r=Rules.naturalRank(c); rc[r]=(rc[r]||0)+1; }
    for (const r in rc){
      const have = g.byRank.get(Number(r)) ? g.byRank.get(Number(r)).length : 0;
      if (have>=4 && rc[r]<have && rc[r]<4) cost += 120;  // 拆炸
    }
    for (const c of play.cards) if (c.joker) cost += 40;   // 拆王
    return cost;
  }

  function isTeammateLead(ctx){
    if (ctx.lastSeat==null) return false;
    return (ctx.lastSeat%2)===(ctx.seat%2) && ctx.lastSeat!==ctx.seat;
  }
  function minOpponentCards(ctx){
    if (!ctx.handsLeft) return 99;
    let mn=99;
    ctx.handsLeft.forEach((n,seat)=>{ if((seat%2)!==(ctx.seat%2) && n>0 && n<mn) mn=n; });
    return mn;
  }

  return {
    decide, chooseLead, hints, genCombos, allBombs, groups, findLines,
  };
});
