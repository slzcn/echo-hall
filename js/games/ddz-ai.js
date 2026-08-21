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

  // 挑一张最适合当「翼」的单张(排除某 rank), 用作三带一/飞机带单。
  //   ★不拆对子/三条: 优先【真散张】(手里该 rank 只有 1 张); 都没有才退让拆最小的。
  //   —— 治"手握三条5+一对3, 三带一却抠一张3把对子拆了"这类蠢选牌。
  //   hand 已降序 → 从末尾(最小)向前找, 命中的散张自然最小。
  function leastSingle(hand, excludeRank){
    const m = groupByRank(hand);
    let any = null;
    for (let i = hand.length-1; i >= 0; i--){
      const c = hand[i];
      if (c.rank === excludeRank) continue;
      if (any === null) any = [c];
      if (m.get(c.rank).length === 1) return [c];   // 真散张(最小的)优先
    }
    return any;
  }
  // 挑一个最适合当「翼」的对子(排除某 rank), 用作三带二/飞机带对。
  //   ★优先【真散对】(该 rank 手里恰好 2 张), 不从三条/炸弹里抠对; b.pairs 已按点升序 → 命中即最小。
  function leastPair(b, excludeRank){
    let any = null;
    for (const p of b.pairs){
      if (p[0].rank === excludeRank) continue;
      if (any === null) any = p;
      if (b.m.get(p[0].rank).length === 2) return p;   // 真散对优先(非拆三/拆炸)
    }
    return any;
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
    // ★农民协作: 地主进入残局(≤3 张)就该视为紧迫, 提前动炸弹/大牌拦截, 别等报单才反应 ——
    //   地主只有一个, 拦住他=本方赢; 拦晚了他一顺就走。故农民对地主的紧迫阈值放宽到 3。
    const coopPeasant = ctx.coop!==false && isPeasantSeat(ctx, ctx.seat);
    const urgent = oppMin <= 2 || (coopPeasant && oppMin <= 3);

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
      // ★队友垫牌助攻(治主人反馈"队友灵魂总不出牌"): 队友领出的是小牌、我手里还多且有便宜散牌可甩时,
      //   用一手「小而不拆大牌」的牌接管这一轮 —— 逼下家对手拿出更大的牌来压(帮队友给对手制造难度),
      //   顺带清掉自己的散张。严设限防搅局: 绝不用炸/王压队友; 队友快走完(≤2 张)就让他赢这轮;
      //   只甩点数不高(≤J)、代价低(不拆炸/三条/王)的牌; 自己手牌够多(>4)才值得垫。
      const leaderLeft = (ctx.handsLeft && ctx.lastSeat!=null) ? ctx.handsLeft[ctx.lastSeat] : 99;
      if (ctx.coop!==false && plays.length && hand.length > 4 && leaderLeft >= 3){
        const cheap = plays
          .filter(p => p.parse.key <= 11 && playCost(p,hand) < 15)   // 小牌型且不拆大牌
          .sort((a,b)=> playCost(a,hand)-playCost(b,hand) || a.parse.key-b.parse.key)[0];
        if (cheap) return { action:'play', cards: cheap.cards };
      }
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
      // ★压制地主(队友协作): 我是农民、桌面这手正是地主领出的 → 别为"保 2/A 大单张"而放地主过牌。
      //   地主一旦顺出散牌就滚雪球; 农民该主动接管牌权把地主的节奏打断。故面对地主领出时取消保牌 pass。
      const suppressLandlord = ctx.coop!==false && isPeasantSeat(ctx, ctx.seat) && ctx.lastSeat===ctx.landlord;
      // ★卡对手(治"灵魂对手总放我过牌"): 领出这手的真对手快走完(≤4 张)时别再为保 2/A 大单而 pass,
      //   主动接管把他卡住 —— 他一旦顺出散牌就赢了。
      const leaderLeft = (ctx.handsLeft && ctx.lastSeat!=null) ? ctx.handsLeft[ctx.lastSeat] : 99;
      const blockLowOpp = leaderLeft <= 4;
      if (!urgent && !suppressLandlord && !blockLowOpp && best.parse.type==='single' && best.parse.key >= 14 && hand.length > 4){
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
  //   ★残局意识(ctx 可选): 若「真对手」已报单(剩 1 张), 领出别甩小单张送他走脱 ——
  //     剩 1 张者跟不了任何 ≥2 张的牌型, 优先领非单牌型把他憋住;
  //     实在只有单张可领, 就领最大的单张(他大概率压不过, 只能过)。
  function chooseLead(hand, plays, bombs, rocket, ctx){
    if (!plays.length){
      // 只剩炸弹/王炸也得出
      if (bombs.length) return bombs[0];
      if (rocket) return rocket;
      return [hand[hand.length-1]]; // 兜底最小单张
    }
    // 若能一把走完(手牌全出) → 直接出
    const finisher = plays.find(p => p.cards.length === hand.length);
    if (finisher) return finisher.cards;

    // 对手报单/报双: 用公开读牌收窄候选, 憋死低张真对手 —— 别把牌权/走脱机会送出去。
    const oppMin = ctx ? minOpponentCards(ctx) : 99;
    const unseen = ctx ? unseenRankCounts(ctx) : null;
    // 甩单张时: 有"对手压不过的 boss 单"就甩最小 boss(他只能过); 否则退甩最大单张。
    const bestSingle = (list)=>{
      const singles = list.filter(p => p.parse.type==='single');
      if (!singles.length) return null;
      if (unseen){
        const boss = singles.filter(p => !hasHigherSingle(unseen, p.parse.key));
        if (boss.length){ boss.sort((a,b)=> a.parse.key - b.parse.key); return boss[0].cards; }
      }
      singles.sort((a,b)=> b.parse.key - a.parse.key); return singles[0].cards;
    };
    let pool = plays;
    if (oppMin === 1){
      // 剩 1 张: 任何 ≥2 张牌型他都跟不了 → 收窄到多张憋死; 只有单张才甩(优先 boss 单)。
      const multi = plays.filter(p => p.cards.length >= 2);
      if (multi.length){ pool = multi; }
      else { const s = bestSingle(plays); if (s) return s; }
    } else if (oppMin === 2 && unseen){
      // 剩 2 张(读牌生效时): 保留他跟不了的多张牌型 —— 但【去掉他能用更高对子压过的对子】,
      //   这正是"我剩两张多半是对子, 灵魂别领个我压得过的对子送我走"的修法。
      const squeeze = plays.filter(p =>
        p.cards.length >= 2 && !(p.parse.type==='pair' && hasHigherPair(unseen, p.parse.key)));
      if (squeeze.length){ pool = squeeze; }
      else { const s = bestSingle(plays); if (s) return s; }   // 只剩能被压的对子/单张 → 甩 boss 单
    }
    // 优先长牌型(顺子/连对/飞机)清散牌,同类取点最小
    const rank = (p)=>{
      const order = { straight:0, pairs:0, plane:0, plane_single:0, plane_pair:1, trio_single:2, trio_pair:2, trio:3, pair:4, single:5 };
      return (order[p.parse.type] ?? 9);
    };
    pool.sort((a,b)=>{
      const ra=rank(a), rb=rank(b);
      if (ra!==rb) return ra-rb;
      // 同类:长的优先(清更多牌),再点小优先
      if (b.parse.len !== a.parse.len) return b.parse.len - a.parse.len;
      return a.parse.key - b.parse.key;
    });
    // 避免首出就甩 2/王的单张(留着控场):若最优是大单张且有别的选择,换
    const nonBig = pool.filter(p=>!(p.parse.type==='single' && p.parse.key>=15));
    return (nonBig[0] || pool[0]).cards;
  }

  // 提示排序: 产出 best-first 的可出牌序列(每项 card[]), UI 的「提示」直接吃它。
  //   ① 能一把走完的牌型永远排最前(剩一对提示打整对, 而不是拆成单张一张张出);
  //   ② 领出先出长牌型清散牌、单张垫底、不首选甩 2/王大单张;
  //   ③ 跟牌走最小代价、炸弹/王炸垫底(除非炸弹恰好能一把走完)。
  //   ④ 残局/报单意识(ctx 可选, 领出时生效): 真对手剩 1 张时, 多张牌型(他跟不了)提到最前憋死他,
  //      全是单张则改大单张优先(他大概率压不过) —— 治"我剩1张, 提示还让我甩小单送对手走脱"。
  function hints(hand, target, ctx){
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
      // ④ 领出·真对手低张(报单/报双): 把"他压不过/跟不了的一手"提到最前憋死他。
      //    报单(剩1张): 任何≥2张牌型他都跟不了 → 多张提前, 全单张则大单优先(他压不过)。
      //    报双(剩2张·读牌生效时): 多张仍憋他, 但【他能用更高对子压过的对子】降级同单张 ——
      //      正是"我剩两张多半是对子, 提示别再首推个我压得过的对子"的修法。仅用公开信息, 公平。
      if (ctx){
        const oppMin = minOpponentCards(ctx);
        const unseen = unseenRankCounts(ctx);
        if (oppMin === 1 || (oppMin === 2 && unseen)){
          const held = (p)=>{   // 0=憋死他的一手(排前), 1=他能跟/能压(排后)
            if (p.cards.length < 2) return 1;
            if (oppMin === 2 && p.parse.type==='pair' && hasHigherPair(unseen, p.parse.key)) return 1;
            return 0;
          };
          list.sort((a,b)=>{
            const ha=held(a), hb=held(b);
            if (ha!==hb) return ha-hb;
            if (ha===1){                              // 都是"他能应对"的
              const ma=a.cards.length>=2?0:1, mb=b.cards.length>=2?0:1;
              if (ma!==mb) return ma-mb;              // 能被压的对子仍优于单张(甩对逼他拆/压)
              if (ma===1) return b.parse.key-a.parse.key;   // 单张→大的优先(他压不过)
            }
            return 0;
          });
        }
      }
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

  // 出这手牌的「代价」:拆散了成型的组合(炸/王/三条/对子)惩罚高;点数越大代价越高。
  //   跟牌挑「代价最小」的一手时, 这个函数决定了智能程度 —— 治"为出一张单牌把好好的对子拆了"。
  function playCost(play, hand){
    let cost = play.parse.key;
    const m = groupByRank(hand);
    const rankCount = {};
    for (const c of play.cards) rankCount[c.rank] = (rankCount[c.rank]||0)+1;
    for (const r in rankCount){
      const rn = Number(r);
      const have = m.get(rn) ? m.get(rn).length : 0;
      const used = rankCount[r];
      if (have === 4 && used < 4) cost += 100; // 拆炸:重罚, 除非整炸出
      if (rn >= 16) cost += 50;                // 拆王:留着王炸/控场
      if (have === 3 && used < 3) cost += 15;  // 拆三条:破坏了可留的三带
      if (have === 2 && used === 1) cost += 6;  // 拆对子出单张:有散张就先出散张(但低对子仍可为跟小单而拆)
    }
    return cost;
  }

  // 座位 s 是不是农民(非地主)。缺 landlord 信息时按「不是地主」保守判 false。
  function isPeasantSeat(ctx, s){ return ctx.landlord!=null && s!==ctx.landlord; }
  // 从我这一席起, 环形找下一个「手上还有牌」的座位(跳过已出完的)。缺 handsLeft 时退化为 (seat+1)%3。
  function nextActiveSeat(ctx){
    if (ctx.seat==null) return null;
    const hl = ctx.handsLeft;
    for (let k=1;k<=2;k++){ const s=(ctx.seat+k)%3; if(!hl || hl[s]>0) return s; }
    return (ctx.seat+1)%3;
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

  // ── 公开读牌(card counting) ────────────────────────────────
  // 铁律: 只用【公开信息】—— 我的手牌 + state.log 里所有已亮明打出的牌。
  //   绝不读别家隐藏手牌。据此推断"还没露面的牌"的分布(散落在别家手里),
  //   用来判断"我这手别人到底压不压得过"→ 面对报单/报双的真对手时精准憋死他,
  //   治主人反馈"我剩两张(多半是对子), 灵魂还照样领对子送我走脱"。
  function rankOfId(id){
    if (id === 'jb') return 17;
    if (id === 'js') return 16;
    return parseInt(id.slice(1), 10);   // 花色键固定 1 字符, 其后即点数(3..15)
  }
  // 未露面牌的点数计数: 满副 54 张 − 我的手牌 − log 中打出的所有牌。
  //   底牌【不减】: 我是农民时底牌在地主手里(仍是对手可持有的牌), 我是地主时底牌已并入我手牌(已减)。
  //   缺 log 时返回 null → 上层退化为不读牌的既有行为(不破坏无 log 的既有测试/fuzz)。
  function unseenRankCounts(ctx){
    if (!ctx || !Array.isArray(ctx.log)) return null;
    const m = new Map();
    for (let r=3; r<=15; r++) m.set(r, 4);
    m.set(16, 1); m.set(17, 1);
    const dec = (r)=>{ if (m.has(r)) m.set(r, Math.max(0, m.get(r)-1)); };
    for (const c of (ctx.hand||[])) dec(c.rank);
    for (const e of ctx.log){
      if (e && e.t==='play' && Array.isArray(e.cards)) for (const id of e.cards) dec(rankOfId(id));
    }
    return m;
  }
  function oppCanRocket(unseen){ return unseen.get(16)>0 && unseen.get(17)>0; }
  // 是否还有比 key 更大的单张未露面(含王)→ 对手可能压过我这张单。
  function hasHigherSingle(unseen, key){
    for (let r=key+1; r<=17; r++) if ((unseen.get(r)||0) > 0) return true;
    return false;
  }
  // 是否还有比 key 更大的对子未露面, 或对手可能握王炸 → 对手可能压过我这个对子。
  function hasHigherPair(unseen, key){
    for (let r=key+1; r<=15; r++) if ((unseen.get(r)||0) >= 2) return true;
    return oppCanRocket(unseen);
  }

  return {
    scoreHand, chooseBid, decide,
    // 暴露供单测
    candidates, enumBasics, findChains, chooseLead, hints,
  };
});
