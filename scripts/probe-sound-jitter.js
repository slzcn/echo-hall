#!/usr/bin/env node
'use strict';
/* probe-sound-jitter.js — 真机渲染驱动一整局斗地主, 抓两件主人报的 bug:
 *   ① 有些牌不发声: stub EhSfx.play 记每次音效名; MutationObserver 数 .ddz-played 每次真·换牌(一手出牌),
 *      比对"出牌次数" vs "cardplay/boom 次数"; 缺口=有牌没发声。
 *   ② 牌桌会跳动: 每 120ms 采样各区(bar/opps/felt/played/hand/ctrl) getBoundingClientRect,
 *      稳态出牌里若某区 top/height 抖动 >2px 记为跳动。
 * 人席由脚本点真 UI 按钮(hint→play, 压不过→不出)驱动, 走真实 doPlay/doPass 音效路径。
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
function findChrome(){
  return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium', process.env.CHROME_PATH]
    .filter(Boolean).find(p => { try { return fs.existsSync(p); } catch(_){ return false; } });
}
let chromium; try { ({chromium}=require('playwright')); } catch(_){ try { ({chromium}=require('playwright-core')); } catch(__){} }

(async () => {
  const exe = findChrome();
  if(!chromium || !exe){ console.log('⏭ 跳过: 无 playwright/Chrome'); process.exit(0); }
  const CSSVARS = ':root{--accent:#00e5d4;--magenta:#ff2d8e;--amber:#ffc24d;--sub:#86cbc6;--dim:#498d88;--ink:#eaf6ff;'
    + '--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--glow-cyan:0 0 12px rgba(0,229,212,.5)}'
    + 'html,body{margin:0;background:#0a0e18;color:#eaf6ff;font-family:system-ui,"PingFang SC",sans-serif}'
    + '#hall{position:relative;width:390px;height:844px;overflow:hidden}';
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>'+CSSVARS+'</style><div id="hall"></div>');
  await page.addStyleTag({ content: G('table-shared.css') });

  // stub EhSfx (game-ui 用 root.EhSfx.play/say; 无则静默) + 记录
  await page.evaluate(() => {
    window.__snd = [];
    window.EhSfx = {
      play(n){ window.__snd.push({k:'sfx', n, t: performance.now()}); },
      say(text){ window.__snd.push({k:'say', n:text, t: performance.now()}); },
      playClick(){}, setEnabled(){}, isEnabled(){return true;}, unlock(){}
    };
    // 每次 .ddz-played 真换一手牌 → 记一次"出牌事件"(用 who+牌数指纹去重连续重绘)
    window.__plays = [];
    window.__jit = {};
  });
  for(const f of ['deck.js','ddz-rules.js','ddz-engine.js','ddz-ai.js','game-ui.js'])
    await page.addScriptTag({ content: G(f) });
  await page.evaluate(() => {
    window.__h = window.EHDdzGame.open({ mount: document.getElementById('hall'),
      mySeat:0, names:['我','西','北'], avatars:['🙂','🐼','🐺'], onResult(){} });
    // 出牌事件观察: .ddz-played 的孩子数从 0→N (新一手落牌)
    const played = document.getElementById('ddzPlayed');
    let lastSig = '';
    new MutationObserver(() => {
      const who = (document.getElementById('ddzWho')||{}).textContent || '';
      const n = played ? played.querySelectorAll('.card').length : 0;
      const sig = who + '#' + n;
      if(n>0 && sig !== lastSig){ lastSig = sig; window.__plays.push({who, n, t: performance.now()}); }
    }).observe(played, {childList:true, subtree:true});
  });

  // 稳态跳动采样: 记每区 top/height 序列
  async function sample(){
    return await page.evaluate(() => {
      const q = s => { const e=document.querySelector(s); if(!e) return null; const r=e.getBoundingClientRect(); return {top:Math.round(r.top), h:Math.round(r.height)}; };
      const ctrlEl = document.getElementById('ddzCtrl');
      const roomEl = document.querySelector('.ddz-room');
      const cs = roomEl ? getComputedStyle(roomEl) : {};
      const phase = document.getElementById('ddzAgain') ? 'over'
        : (ctrlEl && ctrlEl.querySelector('.ddz-bidbar')) ? 'bid'
        : (ctrlEl && ctrlEl.querySelector('.ddz-actbar')) ? 'play'
        : (ctrlEl && ctrlEl.innerHTML.trim()) ? 'ctrl?' : 'empty';
      const handEmpty = (document.getElementById('ddzHand')||{}).children ? document.getElementById('ddzHand').children.length : -1;
      const feltH = q('#ddzFelt') ? q('#ddzFelt').h : 999;
      let kids = null;
      if(feltH < 460 && roomEl){
        kids = [...roomEl.children].map(c => {
          const r = c.getBoundingClientRect(); const st2 = getComputedStyle(c);
          return `${c.className||c.id}=h${Math.round(r.height)}(pos:${st2.position},fx:${st2.flexGrow})`;
        }).join(' | ');
      }
      return { bar:q('.ddz-bar'), opps:q('#ddzOpps'), felt:q('#ddzFelt'), played:q('#ddzPlayed'), hand:q('#ddzHand'), ctrl:q('#ddzCtrl'), me:q('#ddzMe'),
               phase, handN:handEmpty, roomH:roomEl?Math.round(roomEl.getBoundingClientRect().height):0, jc:cs.justifyContent, disp:cs.display, kids };
    });
  }

  // 人席驱动: 轮到我(#ddzPlay 存在)→ 先 hint 选好 → 能出就 play, 否则 pass
  async function driveMe(){
    try {
      await page.evaluate(() => {
        const hint = document.getElementById('ddzHint');
        const play = document.getElementById('ddzPlay');
        const pass = document.getElementById('ddzPass');
        if(play && !play.disabled){ play.click(); return; }
        if(hint){ hint.click(); }
      });
      await page.waitForTimeout(90);
      await page.evaluate(() => {
        const play = document.getElementById('ddzPlay');
        const pass = document.getElementById('ddzPass');
        if(play && !play.disabled){ play.click(); }
        else if(pass && !pass.disabled){ pass.click(); }
      });
    } catch(_){}
  }

  // 预热: 放过开局发牌入场动画(dealAnim 让 hand/ctrl 从屏外飞入, 非稳态跳动)
  await page.waitForTimeout(3200);
  const samples = [];
  const t0 = Date.now();
  let rounds = 0;
  while(Date.now() - t0 < 40000){
    await driveMe();
    samples.push(await sample());
    await page.waitForTimeout(160);
    rounds++;
    const over = await page.evaluate(() => !!document.getElementById('ddzAgain'));
    if(over) break;
  }

  const snd = await page.evaluate(() => window.__snd);
  const plays = await page.evaluate(() => window.__plays);
  await browser.close();

  // ── 分析 ①: 出牌 vs 发声 ──
  const sfxNames = snd.filter(s=>s.k==='sfx').map(s=>s.n);
  const cardSounds = sfxNames.filter(n => n==='cardplay' || n==='boom').length;
  const says = snd.filter(s=>s.k==='say').length;
  console.log('\n=== ① 发声覆盖 ===');
  console.log('真·出牌手数(.ddz-played 换牌):', plays.length);
  console.log('cardplay/boom 音效次数     :', cardSounds);
  console.log('语音报牌型(say)次数        :', says);
  console.log('全部音效序列:', JSON.stringify(sfxNames));
  const gap = plays.length - cardSounds;
  if(gap > 0) console.log('⚠️ 有 ' + gap + ' 手出牌没有对应拍击/爆炸音 → "有些牌不发声"复现');
  else console.log('✓ 每手出牌都有拍击/爆炸音');

  // ── 分析 ②: 跳动 ──
  console.log('\n=== ② 布局跳动 ===');
  console.log('每采样 [phase felt.h ctrl.top handN roomH jc]:');
  const shrunk = samples.find(s => s.kids);
  if(shrunk){ console.log('★ felt 被压缩那刻 .ddz-room 子元素分解:'); console.log('  ' + shrunk.kids); }
  console.log(samples.map(s => `[${s.phase} f${s.felt&&s.felt.h} c${s.ctrl&&s.ctrl.top} n${s.handN} R${s.roomH} ${s.jc}]`).join('\n'));
  const regions = ['bar','opps','felt','played','hand','ctrl','me'];
  for(const r of regions){
    const tops = samples.map(s=>s[r]&&s[r].top).filter(v=>v!=null);
    const hs   = samples.map(s=>s[r]&&s[r].h).filter(v=>v!=null);
    if(!tops.length) continue;
    const dTop = Math.max(...tops) - Math.min(...tops);
    const dH   = Math.max(...hs) - Math.min(...hs);
    const flag = (dTop>2 || dH>2) ? '⚠️ 跳动' : '✓ 稳';
    console.log(`  ${r.padEnd(7)} top[${Math.min(...tops)}~${Math.max(...tops)}] Δ${dTop}  h[${Math.min(...hs)}~${Math.max(...hs)}] Δ${dH}  ${flag}`);
  }
  console.log('\npageerror:', errs.length ? errs.join(' | ') : '无');
})();
