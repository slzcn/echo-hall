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
    // 王对(同类两王成对: 双小王力16 / 双大王力17)+ 四大天王(四王齐)
    const bigs=g.jokers.filter(j=>j.joker==='big'), smalls=g.jokers.filter(j=>j.joker==='small');
    if (smalls.length>=2) add([smalls[0],smalls[1]]);
    if (bigs.length>=2)   add([bigs[0],bigs[1]]);
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

  // ── 理牌·智能组牌(对标腾讯欢乐掼蛋分组显示) ─────────────────────
  // 把整手牌贪心拆成若干【成型牌型组】(炸/同花顺/顺子/连对/钢板/三张/对子), 供 UI 分组分堆显示,
  //   一眼看清手里有哪些现成组合。纯展示用: 不影响出牌自由点选, 不看别家牌。
  //   贪心顺序 = 炸弹最先抽(护炸不被顺子拆散) → 长牌型清散牌 → 三张 → 对子; 单张不成组。
  //   三带二【不】自动合并(留三张/对子各自成组, 玩家自选如何带), 少用百搭优先(留逢人配灵活)。
  //   返回 card[][](每组一手成型牌; 末组=剩余散牌, 按大小排; 无散牌则不含末组)。
  function arrangeGroups(hand, level){
    if (typeof level !== 'number') level = 2;
    const KEEP = { jokerbomb:0, bomb:1, straightflush:2, straight:3, pairline:3, trioline:4, trio:6, pair:7 };
    let pool = hand.slice();
    const out = [];
    let guard = 0;
    while (pool.length && guard++ < 60){
      const wildBudget = pool.filter(c=>Rules.isWild(c, level)).length;
      const combos = genCombos(pool, level, wildBudget)
        .filter(c => c.cards.length >= 2 && KEEP[c.parse.type] !== undefined);
      if (!combos.length) break;
      combos.sort((a,b)=>{
        const pa = KEEP[a.parse.type], pb = KEEP[b.parse.type];
        if (pa !== pb) return pa - pb;                                   // 炸→长牌型→三张→对子
        if (b.cards.length !== a.cards.length) return b.cards.length - a.cards.length; // 张多优先(清更多散牌)
        const wa = a.cards.filter(c=>Rules.isWild(c,level)).length, wb = b.cards.filter(c=>Rules.isWild(c,level)).length;
        if (wa !== wb) return wa - wb;                                   // 少用百搭优先(留逢人配灵活)
        return b.parse.key - a.parse.key;                               // 点力大的组靠前
      });
      const pick = combos[0];
      out.push(Rules.sortHand(pick.cards, level));                      // 组内点力降序(级牌/王在左)
      const used = new Set(pick.cards.map(c=>c.id));
      pool = pool.filter(c=>!used.has(c.id));
    }
    if (pool.length) out.push(Rules.sortHand(pool, level));             // 剩余散牌垫最后一组
    return out;
  }

  function withoutCards(hand, cards){
    const ids = new Set(cards.map(c=>c.id));
    return hand.filter(c=>!ids.has(c.id));
  }
  // ── 手数估计(estTricks): 把一手牌拆成最少的"出牌手数", 越少越接近赢 ──────────
  //   复用 arrangeGroups 的贪心分解(炸/同花顺/顺子/连对/钢板/三张/对子已正确摘出, 含级牌/百搭/王),
  //   记账对齐斗地主 estTricks: 长牌型/对/三各 1 手, 散牌每张 1 手, 三条白吃一翼(带单优先再带对, 不额外计手)。
  //   —— 这就是掼蛋 AI 过去缺的"全局观": 拆散顺子/连对留孤张的走法手数飙升会被领出评估自然淘汰。
  function estTricks(hand, level){
    if (!hand || !hand.length) return 0;
    const groups = arrangeGroups(hand, level);
    let longT=0, trios=0, pairs=0, singles=0;
    for (const g of groups){
      if (!g || !g.length) continue;
      const p = g.length>=2 ? Rules.parse(g, level) : null;
      if (!p){ singles += g.length; }                 // 散牌末组: 每张一手
      else if (p.type==='trio') trios++;
      else if (p.type==='pair') pairs++;
      else longT++;                                   // 炸/同花顺/顺子/连对/钢板/三带二
    }
    let tricks = longT + trios;
    let wings = trios;                                // 每个三条白吃一翼(带单优先清散张, 其次带对)
    while (wings>0 && singles>0){ singles--; wings--; }
    while (wings>0 && pairs>0){ pairs--; wings--; }
    tricks += pairs + singles;
    return tricks;
  }
  // 孤张小单判定: 该自然点在手里仅此 1 张、非王、点力≤阈值 → 注定要单走的废牌(掼蛋无三带一, 消化不掉)。
  //   领出是甩废牌的最佳时机(不用比大小), 这类牌趁早清; J/Q/K/A/级/王 留作中后期控场, 不算小单。
  const EARLY_SINGLE_MAX = 10;   // 点力≤10(自然点 2..10)算"小单"
  let EARLY_CLEAR_ON = true;     // 孤小单早清开关(默认开; 仅供对抗测试临时关闭对比棋力)
  function setEarlyClear(b){ EARLY_CLEAR_ON = !!b; }
  function isLoneSmallSingle(hand, card, level){
    if (!EARLY_CLEAR_ON) return false;
    if (card.joker) return false;
    if (Rules.powerOf(card, level) > EARLY_SINGLE_MAX) return false;
    const nr = Rules.naturalRank(card);
    return hand.filter(x=>!x.joker && Rules.naturalRank(x)===nr).length === 1;
  }
  // 领出候选打分(越小越好), chooseLead 与 hints 领出共用 → 灵魂选择与玩家提示同源。
  //   剩余手数×100(主导) + 惜控×8(别过早花掉 A/级/王这类回手权) − 本手清牌数(同分多清优先) − 孤小单早清加成。
  function leadScore(hand, play, level){
    const t = estTricks(withoutCards(hand, play.cards), level);
    const k = play.parse.key, ty = play.parse.type;
    let ctl = 0;
    const hasJoker = play.cards.some(c=>c.joker);
    if (ty==='single'){ if (hasJoker) ctl += 3; else if (k>=14) ctl += 1; }  // 甩王单=丢强回手权; A/级大单略惜
    else if (ty==='pair' && k>=14) ctl += 2;                                  // A/级大对=强控, 别早拆
    // ★孤张小单尽早清(治"残局连甩碎牌单张"——主人反馈"出牌逻辑不好, 最后剩下都是碎牌单张"):
    //   领出免比大小, 趁此把注定单走的孤小单甩掉, 别憋到残局连甩; 保长牌型/大牌到中后期控场。
    //   与出长牌型一样只减 1 手(孤张在 estTricks 里=独立一手), 不增总手数, 仅把出牌时机前移改善节奏。
    let earlyClear = 0;
    if (ty==='single' && isLoneSmallSingle(hand, play.cards[0], level)) earlyClear = 12;
    return t*100 + ctl*8 - Math.min(play.cards.length, 9) - earlyClear;
  }

  // ── 决策 ────────────────────────────────────────────────────
  // ctx: { seat, hand, tableParse, lastSeat, handsLeft:[4], level }
  function decide(ctx){
    const level = ctx.level || 2;
    const hand = ctx.hand;
    const target = ctx.tableParse || null;
    const g = groups(hand, level);

    // ★立即走完(与斗地主同源): 任何一手能【清空整手】且(跟牌时)压得过桌面的出牌(含炸/王炸)一律立刻打出。
    //   走完 = 名次到手(头游/双下最高分), 无条件最优, 优先于让牌/保牌/垫牌。genCombos 含炸 → 不漏"整手一炸赢"。
    {
      const goCand = genCombos(hand, level, g.wilds.length)
        .filter(c=>c.cards.length===hand.length && (!target || Rules.beats(c.parse, target, level)));
      if (goCand.length){
        goCand.sort((a,b)=> playCost(a,hand,level) - playCost(b,hand,level));
        return { action:'play', cards: goCand[0].cards };
      }
    }

    if (!target){
      return { action:'play', cards: chooseLead(hand, level, ctx) };
    }

    // 队友控场: 桌面这手是对家出的 → 让牌(能一把走完已在上面「立即走完」处理, 含炸)
    if (isTeammateLead(ctx)){
      // ★残局推进(治"队友能走掉却不出"): 我已进残局(≤3 张)且不比对家更远 → 别再干让,
      //   出一手非炸的推进牌把自己往走完推(而不是干让, 迟迟推进不了名次)。选"出后剩余手数最少"一手,
      //   平局挑代价最小; 只压非炸(不拿炸压自己人)。对家比我更近时不触发, 仍让他先走。
      {
        const leaderLeft0 = (ctx.handsLeft && ctx.lastSeat!=null) ? ctx.handsLeft[ctx.lastSeat] : 99;
        if (hand.length <= 3 && hand.length <= leaderLeft0){
          let beats = genCombos(hand, level, 0).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));
          if (!beats.length && g.wilds.length)
            beats = genCombos(hand, level, g.wilds.length).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));
          if (beats.length){
            beats.sort((a,b)=>
              (estTricks(withoutCards(hand,a.cards),level) - estTricks(withoutCards(hand,b.cards),level))
              || (playCost(a,hand,level) - playCost(b,hand,level)));
            return { action:'play', cards: beats[0].cards };
          }
        }
      }
      // ★队友垫牌助攻(治"队友灵魂总不出牌"): 对家领出的是小牌、我手里还多时, 用一手「小而不拆大牌、
      //   不用百搭/炸」的牌接管这一轮 —— 逼下家对手拿更大的牌来压(帮队友给对手制造难度)+ 清自己散张。
      //   严设限: 对家快走完(≤2)就让他; 只甩点数不高(≤10)、代价低的天然牌; 自己手牌够多(>4)才垫。
      const leaderLeft = (ctx.handsLeft && ctx.lastSeat!=null) ? ctx.handsLeft[ctx.lastSeat] : 99;
      if (ctx.coop!==false && hand.length > 4 && leaderLeft >= 3){
        const cheap = genCombos(hand, level, 0)
          .filter(c=> !Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level)
                      && c.parse.key <= 10 && playCost(c,hand,level) < 15)
          .sort((a,b)=> playCost(a,hand,level)-playCost(b,hand,level) || a.parse.key-b.parse.key)[0];
        if (cheap) return { action:'play', cards: cheap.cards };
      }
      // 对家出的大牌基本稳赢, 让
      return { action:'pass' };
    }

    // 跟牌: 找能压过的普通牌(尽量不用百搭)
    let follow = genCombos(hand, level, 0).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));
    if (!follow.length && g.wilds.length)   // 无纯天然可压 → 允许百搭
      follow = genCombos(hand, level, g.wilds.length).filter(c=>!Rules.isBomb(c.parse) && Rules.beats(c.parse, target, level));

    const coopMe = ctx.coop!==false;
    // 队友(对家)是否已经出完 → 本方已锁头游, 我该全力冲二游拿【双下】(最高分), 别再保守保牌。
    const partnerOut = coopMe && Array.isArray(ctx.finished) &&
      ctx.finished.some(s => (s%2)===(ctx.seat%2) && s!==ctx.seat);
    const oppMin = minOpponentCards(ctx);
    // ★协作: 对手进残局(≤3)提前视为紧迫; 队友已头游时更要抢着走 → 紧迫阈值放宽。
    const urgent = oppMin <= 2 || (coopMe && (oppMin <= 3 || partnerOut));

    if (follow.length){
      // (能一把走完已在上面「立即走完」处理, 含炸/王炸)
      follow.sort((a,b)=>{
        const c = playCost(a,hand,level) - playCost(b,hand,level);
        if (c) return c;
        // 同代价平局: 出后剩余手数少者优先(别为压一手拆散自己的牌型结构)
        return estTricks(withoutCards(hand,a.cards),level) - estTricks(withoutCards(hand,b.cards),level);
      });
      const best = follow[0];
      // ★卡报单对手(治"跟牌出最小单张, 正好被剩 1 张的对手反压走脱"——主人反馈"对手剩单张灵魂不卡牌"):
      //   桌面是单张、某真对手报单(剩 1 张)时, 掼蛋无公开读牌 → 启发式出能压的【最大】单张赌他压不过,
      //   而不是随手最小单被反压白送他走。只在天然散单里挑(排除拆炸/王的高代价单, 那些留着更值);
      //   跟牌只能同型, 桌面单张无法改出对子, 卡法就是出大单。报单场景不 pass(否则牌权送出让他领出走掉)。
      if (target.type==='single' && minOpponentCards(ctx)===1){
        const singles = follow.filter(p=>p.parse.type==='single');
        if (singles.length > 1){
          const cheap = singles.filter(p=> playCost(p,hand,level) < 40);   // 不拆王(+40)/炸(+120)
          const pickFrom = cheap.length ? cheap : singles;
          pickFrom.sort((a,b)=> b.parse.key - a.parse.key);                // 最大单优先(最可能憋住报单对手)
          return { action:'play', cards: pickFrom[0].cards };
        }
      }
      // ★压制对手(协作): 走到这里桌面必是对手领出(对家领出已在上面让牌)。别为保 A/级大单张
      //   而放对手过牌滚雪球 —— 主动接管牌权打断对手节奏。故协作开启时取消对手领出的保牌 pass。
      // ★卡对手: 领出这手的真对手快走完(≤4)时别为保 A/级大单而 pass, 主动卡住他。
      const leaderLeft = (ctx.handsLeft && ctx.lastSeat!=null) ? ctx.handsLeft[ctx.lastSeat] : 99;
      if (!urgent && !coopMe && leaderLeft>4 && best.parse.type==='single' && best.parse.key>=14 && hand.length>4)
        return { action:'pass' };
      return { action:'play', cards: best.cards };
    }

    // 压不过 → 择机上炸 (队友已头游时也更愿意搏炸冲双下)
    if (urgent || hand.length<=6 || partnerOut){
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
    // 先按廉价启发式粗排(长牌型清散牌优先), 取前 K 个做手数精算 —— 限流 estTricks/arrangeGroups 调用防卡顿。
    //   ★孤张小单提到长牌型同梯队(rank=0): 否则 single 垫底会被 K 截断挤出精算, leadScore 的早清加成就白加了。
    const rankOf = (c)=> (c.parse.type==='single' && isLoneSmallSingle(hand, c.cards[0], level)) ? 0 : (order[c.parse.type]??9);
    pool.sort((a,b)=>{
      const ra=rankOf(a), rb=rankOf(b);
      if (ra!==rb) return ra-rb;
      if (b.parse.len!==a.parse.len) return b.parse.len-a.parse.len;   // 清更多牌
      return a.parse.key-b.parse.key;                                   // 点小优先
    });
    // 逐候选按 leadScore 精算(剩余手数主导): 出后手数最少、又不过早花掉 A/级/王回手权者胜出。
    //   拆散顺子/连对留孤张的选择手数飙升被自然淘汰; 小散单/小对趁早随手清掉。
    const K = Math.min(pool.length, 14);
    let best=null, bestS=Infinity;
    for (let i=0;i<K;i++){ const s=leadScore(hand, pool[i], level); if (s<bestS){ bestS=s; best=pool[i]; } }
    return (best || pool[0]).cards;
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
    // 领出评分预算一次(与灵魂 chooseLead 同源的 leadScore: 剩余手数主导 + 惜控 + 多清); 炸弹不计→垫底。
    const leadSc = target ? null : new Map();
    if (leadSc){ for (const c of combos){ if (!isB(c)) leadSc.set(c, leadScore(hand, c, level)); } }
    combos.sort((a,b)=>{
      // ① 一把走完 → 最优先(无论领出/跟牌)
      const fa = a.cards.length===handN ? 0:1, fb = b.cards.length===handN ? 0:1;
      if (fa!==fb) return fa-fb;
      if (!target){
        // 领出: 炸弹垫底(小炸优先), 非炸按 leadScore(少留手数 + 惜控 A/级/王 + 多清散牌)。
        const ba = isB(a)?1:0, bb = isB(b)?1:0;
        if (ba!==bb) return ba-bb;
        if (ba===1) return Rules.bombStrength(a.parse)-Rules.bombStrength(b.parse);
        return leadSc.get(a) - leadSc.get(b);
      }
      // 跟牌: 非炸优先(炸弹垫底), 再按代价最小
      const ba = isB(a)?1:0, bb = isB(b)?1:0;
      if (ba!==bb) return ba-bb;
      const ca=playCost(a,hand,level), cb=playCost(b,hand,level);
      if (ca!==cb) return ca-cb;
      return a.cards.length-b.cards.length;
    });
    // 残局/报单意识(领出·ctx 带 handsLeft 时): 真对手剩1张 → 多张牌型(他跟不了)提前憋他, 全单张则大单优先。
    //   只吃公开的各家剩牌数, 不看隐藏手牌 → 公平。稳定排序保多张牌型间既有(清散牌)顺序。
    if (!target && ctx.handsLeft && minOpponentCards(ctx) === 1){
      combos.sort((a,b)=>{
        const ma=a.cards.length>=2?0:1, mb=b.cards.length>=2?0:1;
        if (ma!==mb) return ma-mb;
        if (ma===1) return b.parse.key-a.parse.key;
        return 0;
      });
    }
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
      else if (have===3 && rc[r]<3) cost += 15;           // 拆三条: 破坏可留的三带
      else if (have===2 && rc[r]===1) cost += 6;          // 拆对子出单张: 有散张先出散张
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
    decide, chooseLead, hints, genCombos, allBombs, groups, findLines, arrangeGroups,
    estTricks, leadScore, setEarlyClear,
  };
});
