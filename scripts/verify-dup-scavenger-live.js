#!/usr/bin/env node
'use strict';
/**
 * verify-dup-scavenger-live.js — 用【真浏览器 DOM】跑【线上实际发布的】dedupStreamByMid,
 * 复刻深夜电台"阿夜同一句冒两遍(id 1418)"的场景, 验证清道夫真能塌缩重复。
 *
 * 为什么不是又一个正则/node 模拟:
 *   - 从 LIVE https://slzcn.github.io/echo-hall/js/app.js?v=... 抓【线上正在跑的字节】,
 *     切出真正的 dedupStreamByMid 函数体, 注入本机 Chrome 执行。
 *   - 用真的 querySelectorAll(':scope > [data-mid]')、真的 el.remove()、真的 textContent —
 *     node 模拟证不了 :scope> 组合子在真引擎里到底命不命中嵌套 .echo-bar。
 *
 * 断言(全部复刻真实 bug 结构):
 *   1) 顶层两个 [data-mid=1418] 同句 → 塌缩为 1
 *   2) 嵌套 .echo-bar[data-mid=1418] → 不受影响(:scope> 不命中)
 *   3) local_ 乐观上屏临时节点 → 不去重(两条都在)
 *   4) 另一条正常消息 1500 → 保留
 *   5) 保留下来那条 1418 的文字内容 = 原文(没删错、没截断)
 */
const fs = require('fs');
const https = require('https');

const LIVE_JS = 'https://slzcn.github.io/echo-hall/js/app.js?v=20260820-dup-scavenger';
const ALINE = '它也不总是往上走的。有时候成长是学会认输，学会在合适的时候停下来。';

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

function fetchText(url){
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'eh-verify' } }, res => {
      if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode)); return; }
      let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// 从整份 app.js 里切出 dedupStreamByMid 完整函数体(按大括号配平)
function extractFn(src, name){
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('线上 app.js 里没有 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++){
    if (src[i] === '{') depth++;
    else if (src[i] === '}'){ depth--; if (depth === 0){ return src.slice(start, i + 1); } }
  }
  throw new Error('大括号未配平');
}

async function main(){
  const exe = findChrome();
  if (!chromium || !exe){
    console.log('⏭  跳过: ' + (!chromium ? 'playwright 未装' : '未找到 Chrome'));
    process.exit(0);
  }
  console.log('· 抓线上正在跑的 app.js …');
  const src = await fetchText(LIVE_JS);
  const fnText = extractFn(src, 'dedupStreamByMid');
  console.log('· 已从线上字节切出 dedupStreamByMid (' + fnText.length + ' chars)');

  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body><div id="stream"></div></body></html>');

  // 复刻深夜电台真实 DOM: 阿夜同一句冒两遍(id 1418) + 嵌套 echo-bar + local_ 临时 + 正常 1500
  const result = await page.evaluate(({ fnText, ALINE }) => {
    const st = document.getElementById('stream');
    const mk = (mid, txt, nested) => {
      const wrap = document.createElement('div');
      wrap.className = 'msg';
      wrap.dataset.mid = String(mid);
      const t = document.createElement('div');
      t.className = 'txt'; t.textContent = txt;
      wrap.appendChild(t);
      if (nested){
        // 嵌套一个同 mid 的 .echo-bar(点赞/互动条), :scope> 不应命中它
        const bar = document.createElement('div');
        bar.className = 'echo-bar'; bar.dataset.mid = String(mid);
        wrap.appendChild(bar);
      }
      return wrap;
    };
    st.appendChild(mk(1418, ALINE, true));   // 阿夜原句(含嵌套 echo-bar)
    st.appendChild(mk(1418, ALINE, false));  // 竞态双渲染的重复 → 应被移除
    st.appendChild(mk('local_abc', '我刚发的', false)); // 乐观上屏
    st.appendChild(mk('local_abc', '我刚发的', false)); // 同 local_ 再来一个 → 不去重
    st.appendChild(mk(1500, '另一句', false)); // 正常消息

    const before = {
      top1418: st.querySelectorAll(':scope > [data-mid="1418"]').length,
      nested1418: st.querySelectorAll('.echo-bar[data-mid="1418"]').length,
      local: st.querySelectorAll(':scope > [data-mid="local_abc"]').length,
      msg1500: st.querySelectorAll(':scope > [data-mid="1500"]').length,
    };

    // 注入线上实际字节的函数并执行(用真 $ 等价物: 函数内只用 root||$('#stream'), 我们直接传 root)
    // 该函数用了外部 $()，但传入 root 后不会走到 $()，安全。
    const dedupStreamByMid = (new Function('root', '$',
      fnText.replace(/^function\s+dedupStreamByMid\s*\([^)]*\)\s*\{/, '') // 去掉签名头
            .replace(/\}$/, '')                                          // 去掉尾 }
    ));
    const $ = sel => document.querySelector(sel);
    const removed = dedupStreamByMid(st, $);

    const after = {
      top1418: st.querySelectorAll(':scope > [data-mid="1418"]').length,
      nested1418: st.querySelectorAll('.echo-bar[data-mid="1418"]').length,
      local: st.querySelectorAll(':scope > [data-mid="local_abc"]').length,
      msg1500: st.querySelectorAll(':scope > [data-mid="1500"]').length,
      survivorText: (st.querySelector(':scope > [data-mid="1418"] .txt') || {}).textContent || '',
    };
    return { before, after, removed };
  }, { fnText, ALINE });

  await browser.close();

  const { before, after, removed } = result;
  console.log('· [A] 一次性 dedup  before:', JSON.stringify(before));
  console.log('· [A] 一次性 dedup  after :', JSON.stringify(after), 'removed=' + removed);

  const fails = [];
  const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { console.log('  ✗ ' + msg); fails.push(msg); } };

  check(before.top1418 === 2, '[A] 构造: 顶层确有 2 个重复的 1418(复刻 bug)');
  check(after.top1418 === 1, '[A] 真 DOM: 顶层同 mid 双份 → 塌缩为 1');
  check(after.nested1418 === 1, '[A] 真 DOM: 嵌套 .echo-bar[data-mid=1418] 未被误删(:scope> 只扫直接子)');
  check(after.local === 2, '[A] 真 DOM: local_ 临时节点两条都保留(不参与去重)');
  check(after.msg1500 === 1, '[A] 真 DOM: 正常消息 1500 完好');
  check(removed === 1, '[A] 真 DOM: 恰好移除 1 个(不多删)');
  check(after.survivorText === ALINE, '[A] 真 DOM: 存活的 1418 文字 = 阿夜原句(没删错内容)');

  // ── [B] 实时观察器: 复刻闲聊广场"同一句冒三遍且不消"(persist 节流窗口内 append 不触发清扫) ──
  //   用【本地 js/app.js 即将发布的】dedupStreamByMid + 相同的 MutationObserver(childList)+rAF 去抖,
  //   分三次(隔帧)append 同 mid 8604 —— 模拟竞态三渲染 + 房间随后安静(不再有 persist)。
  //   断言: 每次 append 后一帧内被清成 1(不再依赖 persist 节流), 嵌套 echo-bar 不误删。
  const localSrc = fs.readFileSync('js/app.js', 'utf8');
  const localFn = extractFn(localSrc, 'dedupStreamByMid');
  const obsChildListOnly = /_streamDedupObs\.observe\(st,\s*\{\s*childList:true\s*\}\)/.test(localSrc)
    && !/_streamDedupObs\.observe\([^)]*subtree/.test(localSrc);
  check(obsChildListOnly, '[B] 源码: 观察器只挂 childList(不含 subtree, 打字机不触发)');

  const browser2 = await chromium.launch({ executablePath: exe });
  const page2 = await browser2.newPage();
  await page2.setContent('<!doctype html><html><body><div id="stream"></div></body></html>');
  const live = await page2.evaluate(async ({ localFn, ALINE }) => {
    const st = document.getElementById('stream');
    const $ = sel => document.querySelector(sel);
    const dedupStreamByMid = new Function('root', '$',
      localFn.replace(/^function\s+dedupStreamByMid\s*\([^)]*\)\s*\{/, '').replace(/\}$/, ''));
    // 复刻 scheduleStreamDedup + ensureStreamDedupObserver 的运行时行为
    let raf = 0;
    const run = () => { raf = 0; dedupStreamByMid(st, $); };
    const schedule = () => { if (raf) return; raf = requestAnimationFrame(run); };
    new MutationObserver(schedule).observe(st, { childList: true });

    const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const mk = (mid, txt) => { const w=document.createElement('div'); w.className='msg'; w.dataset.mid=String(mid);
      const t=document.createElement('div'); t.className='txt'; t.textContent=txt; w.appendChild(t); return w; };
    const topN = () => st.querySelectorAll(':scope > [data-mid="8604"]').length;

    const trace = [];
    st.appendChild(mk(8604, ALINE)); await frame(); trace.push(topN());   // copy1 → 1
    st.appendChild(mk(8604, ALINE)); await frame(); trace.push(topN());   // copy2(竞态) → 观察器一帧内清回 1
    st.appendChild(mk(8604, ALINE)); await frame(); trace.push(topN());   // copy3(竞态) → 仍 1
    // 房间安静: 不再 append, 再等两帧, 确认不反弹(幂等)
    await frame(); await frame(); trace.push(topN());
    // 嵌套 echo-bar 挂到存活节点内部: 不该被清, 且(subtree 不观察)不触发额外清扫
    const survivor = st.querySelector(':scope > [data-mid="8604"]');
    const bar = document.createElement('div'); bar.className='echo-bar'; bar.dataset.mid='8604'; survivor.appendChild(bar);
    await frame();
    return { trace, finalTop: topN(), nested: st.querySelectorAll('.echo-bar[data-mid="8604"]').length,
             survivorText: (st.querySelector(':scope > [data-mid="8604"] .txt')||{}).textContent||'' };
  }, { localFn, ALINE });
  await browser2.close();

  console.log('· [B] 三次隔帧 append 后每步顶层计数 trace =', JSON.stringify(live.trace), '(期望每步都回到 1)');
  check(live.trace.every(n => n === 1), '[B] 实时观察器: 每次竞态 append 后一帧内塌缩回 1(不靠 persist 节流)');
  check(live.finalTop === 1, '[B] 房间安静后不反弹, 顶层仍 1(幂等)');
  check(live.nested === 1, '[B] 嵌套 echo-bar 未被误删(subtree 不观察)');
  check(live.survivorText === ALINE, '[B] 存活节点文字 = 原句');

  // ── [C] 挂载即扫: 复刻"页首防闪脚本先于 app.js 把旧版烘焙的重复快照 innerHTML 进 #stream" ──
  //   (实测: 真人 yiran"年年有余"6 天前的老消息今天冒三遍)。MutationObserver 只报挂载之后的增删,
  //   不回溯已在 DOM 的节点 → 必须在挂载时立刻扫一次。这里【先】铺 3 份同 mid, 【再】挂观察器(带初始扫),
  //   断言初始扫把预先存在的 3 份塌缩为 1。
  const swpAttach = /_streamDedupObs\.observe\([^)]*\);\s*(?:\/\/[^\n]*\n\s*)*try\{\s*dedupStreamByMid\(st\)/.test(localSrc);
  check(swpAttach, '[C] 源码: ensureStreamDedupObserver 挂载后立刻 dedupStreamByMid 扫一遍现有子节点');
  const earlyAttach = (() => {
    const er = localSrc.slice(localSrc.indexOf('async function enterRoom'), localSrc.indexOf('async function enterRoom')+3000);
    const iObs = er.indexOf('ensureStreamDedupObserver()');
    const iSnap = er.indexOf('const snapHit');
    return iObs>=0 && iSnap>=0 && iObs < iSnap;   // 观察器挂载在 snapHit 分支之前
  })();
  check(earlyAttach, '[C] 源码: 观察器在 snapHit 分支之前挂载(keep-alive 秒回房路径也覆盖)');

  const browser3 = await chromium.launch({ executablePath: exe });
  const page3 = await browser3.newPage();
  await page3.setContent('<!doctype html><html><body><div id="stream"></div></body></html>');
  const attach = await page3.evaluate(async ({ localFn }) => {
    const st = document.getElementById('stream');
    const $ = sel => document.querySelector(sel);
    const dedupStreamByMid = new Function('root', '$',
      localFn.replace(/^function\s+dedupStreamByMid\s*\([^)]*\)\s*\{/, '').replace(/\}$/, ''));
    const mk = (mid, txt) => { const w=document.createElement('div'); w.className='msg'; w.dataset.mid=String(mid);
      const t=document.createElement('div'); t.className='txt'; t.textContent=txt; w.appendChild(t); return w; };
    // 先铺 3 份(模拟首帧防闪脚本 innerHTML 进来的旧版烘焙重复)——此时观察器还没挂
    st.appendChild(mk(7991,'年年有余')); st.appendChild(mk(7991,'年年有余')); st.appendChild(mk(7991,'年年有余'));
    const beforeAttach = st.querySelectorAll(':scope > [data-mid="7991"]').length;
    // 复刻 ensureStreamDedupObserver: observe(childList) + 挂载即扫
    let raf=0; const run=()=>{ raf=0; dedupStreamByMid(st,$); };
    const schedule=()=>{ if(raf) return; raf=requestAnimationFrame(run); };
    new MutationObserver(schedule).observe(st,{childList:true});
    dedupStreamByMid(st,$);   // ★挂载即扫(本次修复核心)
    const frame=()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
    await frame();
    return { beforeAttach, afterAttach: st.querySelectorAll(':scope > [data-mid="7991"]').length };
  }, { localFn });
  await browser3.close();

  console.log('· [C] 首帧预铺 3 份 → 挂载观察器(带初始扫): before=' + attach.beforeAttach + ' after=' + attach.afterAttach);
  check(attach.beforeAttach === 3, '[C] 构造: 观察器挂载前 DOM 已有 3 份(模拟首帧防闪脚本铺入)');
  check(attach.afterAttach === 1, '[C] 挂载即扫把先于观察器存在的 3 份历史重复塌缩为 1(修 yiran 年年有余冒三遍)');

  if (fails.length){ console.log('\n❌ 重复气泡验证失败: ' + fails.length + ' 项'); process.exit(1); }
  console.log('\n✅ [A]线上 dedup 塌缩双份 + [B]实时观察器一帧内清"冒三遍且不消" + [C]挂载即扫清首帧防闪脚本铺入的历史重复, 全在真 Chrome DOM 验证, 嵌套/临时/其他消息无副作用');
}
main().catch(e => { console.error('验证脚本异常:', e); process.exit(1); });
