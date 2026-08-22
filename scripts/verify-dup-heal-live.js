#!/usr/bin/env node
'use strict';
/**
 * verify-dup-heal-live.js — 真环境验证"同一句冒三遍"能否自愈。
 * 用真浏览器进【线上】闲聊广场(真匿名 identity + 真 enterRoom), 然后:
 *   场景1: 把截图那样【三份不同样式(左/深、右/me、mention粉)但同 mid】的坏快照灌进 localStorage,
 *          reload → 防闪铺入坏快照 → 新代码 snapHit dedup + observer 应塌缩成 1。
 *   场景2(对照·暴露盲区): 三份【文字相同但 mid 各不同】的坏快照, reload → 观察是否仍存 3
 *          (dedup 按 mid, 天生不会合并不同 mid; 这是"真有三条不同记录"时的正确行为, 非本 bug)。
 *   场景3: 模拟设备卡旧 app.js —— 拦截 ver.txt 返回比已加载 __EH_APP_VER 更新的版本,
 *          观察 index.html 版本自愈是否触发 hardRecover(清缓存/注销SW/带 cache-bust 重载)。
 * 不 mock 渲染逻辑, 只注入初始状态。
 */
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }

const RID = '7b6daabc-fa29-4602-98b3-3dc6133d0be5';
const TXT = '那我接下一个——「先来后到」！轮到谁啦？夜这么深还陪你们接龙，我可真是…困得眼皮都在打架咯。';
const UID = 'c31f0b6d-c0fc-4ad4-83fe-9554a60db29b';   // 小绵羊真 uid(DB 里那条的 user_id)
const SNIP = '先来后到';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function findChrome(){
  return [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.CHROME_PATH,
  ].filter(Boolean).find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
}

// 造一条小绵羊气泡; extraClass 让它样式不同(复刻截图: 普通 / .me 右侧 / mentioned-flash 粉)
function mkMsg(mid, extraClass){
  const cls = ('msg soul no-anim onair ' + (extraClass||'')).trim();
  const midAttr = mid ? ` data-mid="${mid}"` : '';
  return `<div class="${cls}"${midAttr} data-uid="${UID}" data-text="${TXT}" data-name="小绵羊" data-kind="msg" style="--soul-c:#9D4EDD;--av-c:#9D4EDD;"><div class="av"></div><div class="body"><div class="meta"><span class="nm">小绵羊</span><span class="tm">00:08</span></div><div class="txt">${TXT}</div><div class="echo-bar" data-mid="${mid||''}"></div></div></div>`;
}

async function realEnter(page){
  await page.goto('https://slzcn.github.io/echo-hall/?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#enterBtn', { timeout: 20000 }).catch(()=>{});
  await sleep(1200);
  const eb = await page.$('#enterBtn'); if (eb) await eb.click().catch(()=>{});
  await page.waitForSelector(`.ch[data-rid="${RID}"]`, { timeout: 20000 }).catch(()=>{});
  await sleep(1200);
  const card = await page.$(`.ch[data-rid="${RID}"]`); if (card) await card.click();
  await sleep(4000);   // 真进房, 真 identity + session 建好
}

async function poisonAndReload(page, snapMids /* [{mid,cls}] */){
  const snapHtml = snapMids.map(s => mkMsg(s.mid, s.cls)).join('');
  await page.evaluate(({ RID, snapHtml }) => {
    localStorage.setItem('eh_last_room', JSON.stringify({ id:RID, name:'闲聊广场', emoji:'💬', kind:'official' }));
    localStorage.setItem('eh_room_snap', JSON.stringify({ rid:RID, html:snapHtml, at:Date.now() }));
  }, { RID, snapHtml });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await sleep(11000);
  return await page.evaluate(s => {
    const st = document.querySelector('#stream'); if(!st) return { err:'no stream' };
    const hits = [...st.querySelectorAll('.msg')].filter(el => (el.textContent||'').includes(s));
    return { count: hits.length, mids: hits.map(e => e.dataset.mid || '(none)'),
      classes: hits.map(e => e.className.replace('msg ','')) };
  }, SNIP);
}

async function main(){
  const exe = findChrome();
  if (!chromium) { console.error('缺 playwright'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true });
  let pass = 0, fail = 0;
  const A = (cond, msg) => { console.log((cond?'  ✓ ':'  ✗ ')+msg); cond?pass++:fail++; };

  // ── 场景1: 三份不同样式 · 同 mid 8604 → 应自愈成 1 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    await realEnter(page);
    const r = await poisonAndReload(page, [
      { mid:'8604', cls:'' },                  // 左/深色(正常)
      { mid:'8604', cls:'me' },                // 右/me(截图里那两份偏右)
      { mid:'8604', cls:'mentioned-flash' },   // 粉色高亮
    ]);
    console.log('\n【场景1】截图复刻: 三份不同样式·同 mid 8604 → reload 稳定后:', JSON.stringify(r));
    A(r.count <= 1, `三份不同样式(左/me/粉)同 mid 应自愈成不重复(塌缩1或重建0)—— 实测 ${r.count}`);
    await ctx.close();
  }

  // ── 场景2(对照): 三份文字相同但 mid 各异 → dedup 按 mid 不合并(这是正确行为) ──
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    await realEnter(page);
    const r = await poisonAndReload(page, [
      { mid:'8604', cls:'' }, { mid:'99001', cls:'me' }, { mid:'99002', cls:'mentioned-flash' },
    ]);
    console.log('\n【场景2·对照·信息】三份同文·不同 mid → reload 稳定后:', JSON.stringify(r), '(仅记录边界: dedup按mid, 不同mid不合并; 但DB里这条只有1个mid=8604, 见场景1才是真bug)');
    await ctx.close();
  }

  // ── 场景3: 模拟卡旧 app.js → 拦 ver.txt 返回更新版本 → 应触发 hardRecover ──
  {
    const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
    const page = await ctx.newPage();
    let hardRecoverFired = false, cachesCleared = false, swUnregAttempt = false;
    // 拦 ver.txt: 无论真实内容, 一律回一个"更新"的版本号, 制造"已加载 app.js 落后于线上"
    await page.route('**/ver.txt*', route => route.fulfill({ status:200, contentType:'text/plain', body:'29990101-forced-newer' }));
    page.on('console', m => { const t=m.text(); if(/自愈|hardRecover|硬恢复|app\.js.*≠/i.test(t)) console.log('    [page]', t); if(/硬恢复|hardRecover/i.test(t)) hardRecoverFired = true; });
    // 监听 caches.delete / SW unregister
    await page.addInitScript(() => {
      try{
        const _cd = caches.delete.bind(caches); caches.delete = (k)=>{ window.__cachesCleared=true; return _cd(k); };
        const _keys = caches.keys.bind(caches); caches.keys = ()=> _keys();
      }catch(_){}
      navigator.serviceWorker && navigator.serviceWorker.getRegistrations && (async()=>{
        const _g = navigator.serviceWorker.getRegistrations.bind(navigator.serviceWorker);
        navigator.serviceWorker.getRegistrations = async()=>{ const regs=await _g(); window.__swUnregAttempt=true; return regs; };
      })();
    });
    await page.goto('https://slzcn.github.io/echo-hall/?t=' + Date.now(), { waitUntil: 'domcontentloaded' });
    await sleep(9000);   // 版本自愈初检在页面加载后延迟跑
    const st = await page.evaluate(() => ({
      appVer: window.__EH_APP_VER || null,
      cachesCleared: !!window.__cachesCleared,
      swUnregAttempt: !!window.__swUnregAttempt,
      hardRecoverFlag: (()=>{ try{ for(const k in sessionStorage) if(k.indexOf('eh_hardrecover')===0) return true; }catch(_){} return false; })(),
    })).catch(()=>({}));
    console.log('\n【场景3】拦 ver.txt=更新版 → 版本自愈状态:', JSON.stringify(st));
    // app.js 版本落后于线上 → 期望走 hardRecover: 要么 caches 被清, 要么打了 hardrecover sessionStorage 标记, 要么控制台喊了硬恢复
    A(st.cachesCleared || st.hardRecoverFlag || hardRecoverFired,
      `app.js 版本落后应触发 hardRecover(清缓存/标记/日志任一)—— caches清=${st.cachesCleared} 标记=${st.hardRecoverFlag} 日志=${hardRecoverFired}`);
    await ctx.close();
  }

  await browser.close();
  console.log(`\n=== 真环境验证: ${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });
