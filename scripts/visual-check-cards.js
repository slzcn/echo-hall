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

  await browser.close();
  if (fails.length) { console.log(`\n❌ 可视化回归 ${fails.length} 项失败`); process.exit(1); }
  console.log('\n✅ 游戏卡/牌桌真实渲染布局回归全部通过');
}
main().catch(e => { console.error('visual-check 异常:', e); process.exit(1); });
