#!/usr/bin/env node
'use strict';
/**
 * visual-check-cards.js — 游戏卡/牌桌【真实渲染】布局回归 (反"正则测不出显示不全")
 *
 * 为什么存在: journey 那些正则只能证明"代码里有 layoutHand / flex 变量", 证明不了
 * "27 张牌 / host 大厅卡在 390px 手机屏上到底放不放得下"。像素级溢出、截断、裁切
 * 只能靠【真的用浏览器渲染 + 量 getBoundingClientRect】抓。本脚本就干这个。
 *
 *   曾漏的真 bug: 掼蛋大厅卡 host 视角两列布局横向溢出 81px, 灵魂下拉/长名被截。
 *
 * 用 playwright + 本机 Chrome 渲染 js/games/* 到手机视口, 断言:
 *   1) 大厅卡(host / 路人 / 进行中 三视角) scrollWidth ≤ clientWidth (无横向溢出)
 *   2) 掼蛋牌桌 27 张手牌不超出牌桌右沿、不被 .gd-room 裁切、底部按钮不被切
 * 任一不满足 → 退出码 1。playwright/Chrome 不可用 → 跳过(退出码 0), 供无头 CI。
 *
 * 手动跑:  node scripts/visual-check-cards.js [--shots]   (--shots 存截图到 /tmp/eh-visual)
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const WANT_SHOTS = process.argv.includes('--shots');
const SHOT_DIR = '/tmp/eh-visual';

function findChrome(){
  const cands = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
}
let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }

async function main(){
  const exe = findChrome();
  if (!chromium || !exe) {
    console.log('⏭  跳过可视化回归: ' + (!chromium ? 'playwright 未安装' : '未找到 Chrome') + '(无头 CI 环境正常)');
    process.exit(0);
  }
  if (WANT_SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const CSSVARS = ':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
    + '--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--glow-cyan:0 0 12px rgba(0,229,212,.5)}'
    + 'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,"PingFang SC",sans-serif}';

  const browser = await chromium.launch({ executablePath: exe });
  const fails = [];
  const ok = m => console.log('  ✓ ' + m);
  const bad = m => { console.log('  ✗ ' + m); fails.push(m); };

  // ---------- A. 大厅卡三视角: 无横向溢出 ----------
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:900}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS
      + '.bubble{background:rgba(19,42,41,.4);border-radius:14px;padding:8px;margin:10px 12px;max-width:82%}'
      + '</style><body>'
      + '<div class="bubble"><div id="c1" class="game-card"></div></div>'
      + '<div class="bubble"><div id="c2" class="game-card"></div></div>'
      + '<div class="bubble"><div id="c3" class="game-card"></div></div>', { waitUntil:'load' });
    await page.addScriptTag({ content: G('table-net.js') });
    const res = await page.evaluate(() => {
      const HOST='h', ME='m', SOUL='s';
      const seats = fill => [
        {seat:0,kind:'human',uid:HOST,name:'月光烤鹅长名测试',emoji:'🦢'},
        fill>=1?{seat:1,kind:'soul',uid:SOUL,name:'午夜电台DJ主持人',emoji:'📻'}:{seat:1,kind:'empty'},
        fill>=2?{seat:2,kind:'human',uid:ME,name:'星际饺子',emoji:'🥟'}:{seat:2,kind:'empty'},
        fill>=3?{seat:3,kind:'ai',name:'机器人3',emoji:'🤖'}:{seat:3,kind:'empty'},
      ];
      const souls=[{auth_uid:SOUL,name:'午夜电台DJ主持人',emoji:'📻'},{auth_uid:'s2',name:'代码微光',emoji:'💡'}];
      const ctx = myUid => ({ myUid, hostName:'月光烤鹅长名测试', souls,
        actions:{join(){},leave(){},seatSoul(){},kick(){},start(){},close(){},enter(){}} });
      const views = [
        ['host招募', {id:'t1',game:'guandan',status:'lobby',host_uid:HOST,seats:seats(1)}, ctx(HOST), 'c1'],
        ['路人招募', {id:'t2',game:'guandan',status:'lobby',host_uid:HOST,seats:seats(1)}, ctx('x'), 'c2'],
        ['进行中',   {id:'t3',game:'guandan',status:'playing',host_uid:HOST,seats:seats(3)}, ctx(ME), 'c3'],
      ];
      return views.map(([name,row,c,id]) => {
        const el = document.getElementById(id);
        window.EHTable.renderLobby(el, row, c);
        return { name, scrollW: el.scrollWidth, clientW: el.clientWidth };
      });
    });
    if (errs.length) bad('大厅卡渲染报错: ' + errs.slice(0,2).join(' | '));
    for (const v of res) {
      if (v.scrollW > v.clientW + 1) bad(`大厅卡[${v.name}]横向溢出 ${v.scrollW - v.clientW}px (scrollW ${v.scrollW} > clientW ${v.clientW})`);
      else ok(`大厅卡[${v.name}]无横向溢出 (${v.scrollW}≤${v.clientW})`);
    }
    if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR,'lobby.png'), fullPage:true });
    await ctx.close();
  }

  // ---------- B. 掼蛋牌桌: 手牌不溢出/不裁切, 按钮不被切 ----------
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS
      + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
    for (const f of ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'])
      await page.addScriptTag({ content: G(f) });
    await page.evaluate(() => window.EHGuandanGame.open({ names:['你','灵魂下','灵魂对','灵魂上'], avatars:['🙂','🔥','🌙','⚡'], onResult(){} }));
    await page.waitForTimeout(1800);
    const d = await page.evaluate(() => {
      const room=document.querySelector('.gd-room'); const rr=room.getBoundingClientRect();
      const acts=document.querySelector('.gd-acts'); const ar=acts?acts.getBoundingClientRect():null;
      const cards=[...document.querySelectorAll('.gd-hand .card')];
      const rights=cards.map(c=>c.getBoundingClientRect().right);
      const tops=[...new Set(cards.map(c=>Math.round(c.getBoundingClientRect().top)))];
      const bandTop=Math.min(...cards.map(c=>c.getBoundingClientRect().top));
      const bandBot=Math.max(...cards.map(c=>c.getBoundingClientRect().bottom));
      const clipped=cards.filter(c=>{const r=c.getBoundingClientRect(); return r.left<rr.left-0.5||r.right>rr.right+0.5||r.bottom>rr.bottom+0.5;}).length;
      return { n:cards.length, vw:window.innerWidth, maxRight:Math.round(Math.max(...rights)),
        clipped, actsCutBelowRoom: ar?Math.round(ar.bottom-rr.bottom):0,
        handBand: Math.round(bandBot-bandTop) };
    });
    if (errs.length) bad('牌桌渲染报错: ' + errs.slice(0,2).join(' | '));
    if (d.n !== 27) bad(`手牌应 27 张, 实渲 ${d.n} 张`); else ok('手牌 27 张全渲');
    if (d.maxRight > d.vw + 1) bad(`手牌右溢出 ${d.maxRight - d.vw}px`); else ok(`手牌不超右沿 (${d.maxRight}≤${d.vw})`);
    if (d.clipped > 0) bad(`${d.clipped} 张牌被牌桌裁切`); else ok('无牌被牌桌裁切');
    if (d.actsCutBelowRoom > 1) bad(`出牌按钮被切在牌桌下方 ${d.actsCutBelowRoom}px`); else ok('出牌按钮完整可见');
    if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR,'guandan.png') });
    await ctx.close();
  }

  // ---------- C. 联机座位参数化: 真人坐非 0 席时 DOM 槽位相对旋转 ----------
  // 单机 mySeat=0 时 底=0/右=1/上=2/左=3; 联机真人可坐 2 席 → 槽位须绕 mySeat 旋转,
  // 否则会把别人的座位画在"我的位置"、手牌张数对不上人。反"renderSeats 写死 seat 号"回退。
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS
      + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
    for (const f of ['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js',
                     'ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'])
      await page.addScriptTag({ content: G(f) });
    // 掼蛋: 我坐 2 席 → 底=2 右=(2+1)%4=3 上=(2+2)%4=0 左=(2+3)%4=1
    const gd = await page.evaluate(() => {
      window.EHGuandanGame.open({ mySeat:2, names:['甲','乙','丙','丁'], avatars:['🅰','🅱','🅲','🅳'], onResult(){} });
      const ds = sel => { const s=document.querySelector(sel+' .gd-seat'); return s?s.getAttribute('data-seat'):null; };
      const r = { me:ds('#gdMe'), right:ds('#gdP1'), top:ds('#gdP2'), left:ds('#gdP3') };
      document.querySelector('.gd-room').remove();
      return r;
    });
    if (gd.me!=='2') bad(`掼蛋 mySeat=2 时底部槽应画 2 席, 实为 ${gd.me}`); else ok('掼蛋非0席: 底部=我(2)');
    if (gd.right!=='3'||gd.top!=='0'||gd.left!=='1') bad(`掼蛋座位旋转错: 右${gd.right}/上${gd.top}/左${gd.left} (应 3/0/1)`); else ok('掼蛋非0席: 右3/上0(队友)/左1 旋转正确');
    // 斗地主: 我坐 1 席 → 底=1, 对手=[(1+1)%3, (1+2)%3]=[2,0]
    const dz = await page.evaluate(() => {
      window.EHDdzGame.open({ mySeat:1, names:['甲','乙','丙'], avatars:['🅰','🅱','🅲'], onResult(){} });
      const me = document.querySelector('#ddzMe .ddz-seat'); const opps=[...document.querySelectorAll('#ddzOpps .ddz-seat')];
      const r = { me: me?me.getAttribute('data-seat'):null, opps: opps.map(o=>o.getAttribute('data-seat')) };
      document.querySelector('.ddz-room').remove();
      return r;
    });
    if (dz.me!=='1') bad(`斗地主 mySeat=1 时底部槽应画 1 席, 实为 ${dz.me}`); else ok('斗地主非0席: 底部=我(1)');
    if (dz.opps.join(',')!=='2,0') bad(`斗地主对手旋转错: [${dz.opps}] (应 2,0)`); else ok('斗地主非0席: 对手区=[2,0] 旋转正确');
    if (errs.length) bad('座位旋转渲染报错: ' + errs.slice(0,2).join(' | '));
    await ctx.close();
  }

  // ---------- D. 理牌: 一键自动 + 手动拖排(真实渲染 + 合成指针事件) ----------
  // 治"手牌只能引擎默认序"。真渲两桌, 各验: (1)理牌钮在牌桌内不溢出;
  // (2)长按进手动模式手牌加 .arranging; (3)拖第一张到末尾 → 手牌顺序真的变了 且张数不减。
  for (const cfg of [
    { name:'掼蛋', mods:['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-ui.js'],
      open:'window.EHGuandanGame.open({ names:["你","灵魂下","灵魂对","灵魂上"], avatars:["🙂","🔥","🌙","⚡"], onResult(){} })',
      room:'.gd-room', hand:'.gd-hand', sort:'#gdSort' },
    { name:'斗地主', mods:['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'],
      open:'window.EHDdzGame.open({ names:["你","灵魂A","灵魂B"], avatars:["🙂","🔥","🌙"], onResult(){} })',
      room:'.ddz-room', hand:'.ddz-hand', sort:'#ddzSort' },
  ]) {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS
      + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
    for (const f of cfg.mods) await page.addScriptTag({ content: G(f) });
    await page.evaluate(cfg.open);
    await page.waitForTimeout(1800);
    const d = await page.evaluate((cfg) => {
      const room=document.querySelector(cfg.room); const rr=room.getBoundingClientRect();
      const btn=document.querySelector(cfg.sort); const br=btn.getBoundingClientRect();
      const hand=document.querySelector(cfg.hand);
      const orderOf = ()=> [...hand.querySelectorAll('.card')].map(c=>c.dataset.id).join(',');
      const before = orderOf();
      const cards0 = [...hand.querySelectorAll('.card')];
      const nBefore = cards0.length;
      // 手牌单排自适应: 首尾牌都得落在牌桌内(治 17~20 张两侧溢出屏外点不到)
      const fc = cards0[0].getBoundingClientRect(), lcr = cards0[cards0.length-1].getBoundingClientRect();
      const handFit = fc.left >= rr.left - 0.5 && lcr.right <= rr.right + 0.5;
      // 长按进手动模式: pointerdown → 等 400ms → 期间 setTimeout 触发 setArrange(true)
      const pe = (t,x,y)=> new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:1});
      btn.dispatchEvent(pe('pointerdown', br.left+5, br.top+5));
      return { rr, br, before, nBefore, handFit, ok:true };
    }, cfg);
    // 等长按计时器(350ms)触发
    await page.waitForTimeout(450);
    const d2 = await page.evaluate((cfg) => {
      const btn=document.querySelector(cfg.sort);
      const br=btn.getBoundingClientRect();
      btn.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,clientX:br.left+5,clientY:br.top+5,pointerId:1}));
      const hand=document.querySelector(cfg.hand);
      const arranging = hand.classList.contains('arranging');
      // 拖第一张到最后一张之后
      const cards=[...hand.querySelectorAll('.card')];
      const first=cards[0], last=cards[cards.length-1];
      const fr=first.getBoundingClientRect(), lr=last.getBoundingClientRect();
      const cy=fr.top+fr.height/2;
      const orderOf=()=> [...hand.querySelectorAll('.card')].map(c=>c.dataset.id).join(',');
      const before=orderOf();                       // 进手动模式后的当前序(与拖后同一坐标系比)
      const pe=(t,x,y)=> new PointerEvent(t,{bubbles:true,clientX:x,clientY:y,pointerId:2});
      // 牌相互叠放, 抓第一张最左侧未被遮挡的一条; 拖到最后一张右侧之后落位
      hand.dispatchEvent(pe('pointerdown', fr.left+3, cy));
      const grabbed=!!hand.querySelector('.card.dragging');
      hand.dispatchEvent(pe('pointermove', lr.right, cy));
      hand.dispatchEvent(pe('pointerup', lr.right, cy));
      return { arranging, grabbed, nAfter:hand.querySelectorAll('.card').length, before, after:orderOf() };
    }, cfg);
    if (errs.length) bad(`${cfg.name}理牌渲染报错: ` + errs.slice(0,2).join(' | '));
    // 手牌单排自适应: 首尾牌都在牌桌内(不溢出屏外)
    if (!d.handFit) bad(`${cfg.name}手牌两侧溢出牌桌(首尾牌跑到屏外, ${d.nBefore} 张未单排自适应)`); else ok(`${cfg.name}手牌单排自适应不溢出(${d.nBefore} 张全在桌内)`);
    // 按钮不溢出牌桌右沿/顶
    if (d.br.right > d.rr.right + 1) bad(`${cfg.name}理牌钮右溢出牌桌 ${Math.round(d.br.right-d.rr.right)}px`); else ok(`${cfg.name}理牌钮在牌桌内(不溢出)`);
    if (!d2.arranging) bad(`${cfg.name}长按未进手动理牌模式(.arranging 缺失)`); else ok(`${cfg.name}长按→手动理牌模式(.arranging)`);
    if (d2.nAfter !== d.nBefore) bad(`${cfg.name}拖排后手牌张数变了 ${d.nBefore}→${d2.nAfter}(丢牌/重牌)`); else ok(`${cfg.name}拖排后手牌张数不变(${d2.nAfter})`);
    if (!d2.grabbed) bad(`${cfg.name}拖排起手未抓到牌(startReorder 未命中)`); else ok(`${cfg.name}拖排起手抓到牌`);
    if (d2.after === d2.before) bad(`${cfg.name}拖第一张到末尾后顺序没变(手动理牌无效) before=${d2.before.slice(0,40)} after=${d2.after.slice(0,40)}`); else ok(`${cfg.name}手动拖排真的改变了手牌顺序`);
    if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, cfg.name+'-sort.png') });
    await ctx.close();
  }

  // ---------- E. 德州扑克绒面牌桌: 桌位不溢出/公共牌5位/我2张底牌/操作区不被切 ----------
  // 治"椭圆桌对手位算错跑屏外""公共牌槽缺位""操作按钮被切在桌下"。真渲一桌(我坐0席),
  // 断言: (1)三名对手座位都落在牌桌矩形内(不溢出屏外点不到);
  //       (2)公共牌区恒 5 槽(已发+暗背占位); (3)我的底牌 2 张; (4)操作区底部不被切出 .pk-room。
  {
    const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.setContent('<!doctype html><meta charset=utf-8>'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSSVARS
      + '#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>', { waitUntil:'load' });
    for (const f of ['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-ui.js'])
      await page.addScriptTag({ content: G(f) });
    await page.evaluate(() => window.EHPokerGame.open({ names:['你','阿岩','小凶','疯哥'], avatars:['🙂','🗿','🔥','🤪'], sb:5, bb:10, startStack:1000, onResult(){} }));
    // 翻牌前我不一定首个行动(庄在上家), 轮到我操作区才出按钮 → 等 AI 依次行动到我
    await page.waitForSelector('#pkFold', { timeout: 15000 }).catch(()=>{});
    await page.waitForTimeout(200);
    const d = await page.evaluate(() => {
      const room=document.querySelector('.pk-room'); const rr=room.getBoundingClientRect();
      const table=document.querySelector('.pk-table'); const tr=table.getBoundingClientRect();
      const acts=document.querySelector('.pk-acts'); const ar=acts?acts.getBoundingClientRect():null;
      const seats=[...document.querySelectorAll('.pk-table .pk-seat')];
      // 对手座位溢出屏外(桌矩形之外)张数
      const seatOut=seats.filter(s=>{const r=s.getBoundingClientRect();
        return r.left<tr.left-2||r.right>tr.right+2||r.top<tr.top-2||r.bottom>tr.bottom+2;}).length;
      const boardSlots=document.querySelectorAll('#pkBoard .card').length;
      const holeCards=document.querySelectorAll('.pk-me .pk-hole .card').length;
      const hasActBtns=!!(document.querySelector('#pkFold')&&document.querySelector('#pkCall'));
      return { nSeats:seats.length, seatOut, boardSlots, holeCards, hasActBtns,
        actsCutBelowRoom: ar?Math.round(ar.bottom-rr.bottom):0,
        actsRight: ar?Math.round(ar.right):0, vw:window.innerWidth };
    });
    if (errs.length) bad('德州牌桌渲染报错: ' + errs.slice(0,2).join(' | '));
    if (d.nSeats !== 3) bad(`德州对手席应 3 个(n=4去我), 实渲 ${d.nSeats}`); else ok('德州对手席 3 个全渲');
    if (d.seatOut > 0) bad(`${d.seatOut} 个对手座位溢出牌桌(跑屏外)`); else ok('德州对手座位全在牌桌内');
    if (d.boardSlots !== 5) bad(`公共牌区应 5 槽(含暗背占位), 实 ${d.boardSlots}`); else ok('公共牌区恒 5 槽');
    if (d.holeCards !== 2) bad(`我的底牌应 2 张, 实 ${d.holeCards}`); else ok('我的底牌 2 张');
    if (!d.hasActBtns) bad('操作区弃牌/跟注按钮缺失(轮到我时应显示)'); else ok('操作区按钮完整(弃牌/过跟/加注)');
    if (d.actsCutBelowRoom > 1) bad(`操作区被切在牌桌下方 ${d.actsCutBelowRoom}px`); else ok('操作区完整可见(未被切)');
    if (d.actsRight > d.vw + 1) bad(`操作区右溢出 ${d.actsRight - d.vw}px`); else ok(`操作区不超右沿 (${d.actsRight}≤${d.vw})`);
    if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR,'poker.png') });
    await ctx.close();
  }

  await browser.close();
  if (fails.length) { console.log(`\n❌ 可视化回归 ${fails.length} 项失败`); process.exit(1); }
  console.log('\n✅ 游戏卡/牌桌真实渲染布局回归全部通过');
}
main().catch(e => { console.error('visual-check 异常:', e); process.exit(1); });
