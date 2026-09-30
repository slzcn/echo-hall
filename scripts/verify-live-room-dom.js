#!/usr/bin/env node
'use strict';
/**
 * verify-live-room-dom.js — 用真浏览器进【线上】官方公开房, dump #stream 真实 DOM,
 * 判定"同一句冒三遍"到底是: (a) 同 mid 顶层重复(dedup 该兜住) (b) 同 mid 但嵌套/无 mid
 * (dedup 盲区) (c) 文字相同但 mid 不同(数据/渲染各一条, dedup 天生管不着)。
 *
 * 不 mock: 匿名自动登录 → enterRoom(官方房) → 等历史+idle 批+轮询都跑完 → 量 DOM。
 */
const fs = require('fs');
let chromium;
try { ({ chromium } = require('playwright')); }
catch(_) { try { ({ chromium } = require('playwright-core')); } catch(__) {} }

function findChrome(){
  const cands = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    process.env.CHROME_PATH,
  ].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch(_) { return false; } });
}

const ROOMS = [
  { id: '7b6daabc-fa29-4602-98b3-3dc6133d0be5', name: '闲聊广场', kind: 'official', emoji: '💬' },
  { id: '3bbcd6f1-c8e6-4c5f-8d16-7c05b9eb3943', name: '技术黑话', kind: 'official', emoji: '💻' },
];

async function probeRoom(page, room){
  // 进房(app 已匿名登录+大厅就绪)。直接调 enterRoom, 传完整房对象。
  await page.evaluate(async (r) => {
    // 等 enterRoom 可用
    for (let i=0;i<40 && typeof window.enterRoom!=='function';i++) await new Promise(s=>setTimeout(s,100));
    if (typeof window.enterRoom==='function') await window.enterRoom(r);
  }, room);
  // 等历史首屏 + idle 分批 + 20s 轮询里的至少一拍(给足 12s)
  await page.waitForTimeout(12000);
  return await page.evaluate(() => {
    const st = document.getElementById('stream');
    if (!st) return { err: 'no #stream' };
    const directMidCount = {};
    st.querySelectorAll(':scope > [data-mid]').forEach(n => { const k=n.dataset.mid; directMidCount[k]=(directMidCount[k]||0)+1; });
    const allMidCount = {};
    st.querySelectorAll('[data-mid]').forEach(n => { const k=n.dataset.mid; allMidCount[k]=(allMidCount[k]||0)+1; });
    // (c) 文字级重复: 顶层 .msg 按 .txt 文本分组, 找出同文本≥2 且 mid 不全同的
    const byText = {};
    st.querySelectorAll(':scope > .msg').forEach(n => {
      const t = ((n.querySelector('.txt')||n).textContent||'').trim();
      if (!t) return;
      const key = t.slice(0, 60);
      (byText[key] = byText[key] || []).push({ mid: n.dataset.mid||null, kind: n.dataset.kind||'msg' });
    });
    const dupDirectMid = Object.entries(directMidCount).filter(([,c]) => c>1);
    const dupText = Object.entries(byText).filter(([,arr]) => arr.length>1)
      .map(([t, arr]) => ({ text: t, count: arr.length, mids: arr.map(a=>a.mid), sameMid: new Set(arr.map(a=>a.mid)).size===1 }));
    // 顶层看似消息却无 mid 的节点(dedup + prevent-add 双盲)
    const topMsgNoMid = [...st.querySelectorAll(':scope > .msg')].filter(n => !n.dataset.mid)
      .map(n => ((n.querySelector('.txt')||n).textContent||'').trim().slice(0,40));
    // dump 文字重复的样本 outerHTML
    const samples = dupText.slice(0,4).map(d => {
      const nodes = [...st.querySelectorAll(':scope > .msg')].filter(n => (((n.querySelector('.txt')||n).textContent||'').trim().slice(0,60))===d.text);
      return { text: d.text, mids: d.mids, sameMid: d.sameMid,
        outers: nodes.slice(0,3).map(n => ({ mid:n.dataset.mid, parent:n.parentElement&&n.parentElement.id, html:n.outerHTML.slice(0,240) })) };
    });
    // 手动跑一次线上 dedup 看能塌缩几条
    let dedupRemoved = 'n/a';
    try { if (typeof window.dedupStreamByMid==='function') dedupRemoved = window.dedupStreamByMid(st); } catch(e){ dedupRemoved='err:'+e.message; }
    return {
      buildVer: window.__EH_BUILD_VER,
      hasDedup: typeof window.dedupStreamByMid,
      streamChildCount: st.children.length,
      dupDirectMidCount: dupDirectMid.length,
      dupDirectMid,
      dupTextGroups: dupText.length,
      dupText,
      topMsgNoMid,
      dedupRemovedWhenForced: dedupRemoved,
      samples,
    };
  });
}

async function main(){
  const exe = findChrome();
  if (!chromium) { console.error('缺 playwright'); process.exit(2); }
  const browser = await chromium.launch({ executablePath: exe || undefined, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { const t=m.text(); if (/dup|dedup|重复/i.test(t)) console.log('[page]', t); });
  await page.goto('https://slzcn.github.io/echo-hall/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  // 等匿名登录 + 大厅
  await page.waitForTimeout(8000);
  for (const room of ROOMS){
    console.log('\n==================', room.name, '==================');
    try {
      const r = await probeRoom(page, room);
      console.log(JSON.stringify(r, null, 2));
    } catch(e){ console.log('probe err', e.message); }
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(1); });
