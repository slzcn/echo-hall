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
  console.log('· before:', JSON.stringify(before));
  console.log('· after :', JSON.stringify(after), 'removed=' + removed);

  const fails = [];
  const check = (cond, msg) => { if (cond) console.log('  ✓ ' + msg); else { console.log('  ✗ ' + msg); fails.push(msg); } };

  check(before.top1418 === 2, '构造: 顶层确有 2 个重复的 1418(复刻 bug)');
  check(after.top1418 === 1, '真 DOM: 顶层同 mid 双份 → 塌缩为 1');
  check(after.nested1418 === 1, '真 DOM: 嵌套 .echo-bar[data-mid=1418] 未被误删(:scope> 只扫直接子)');
  check(after.local === 2, '真 DOM: local_ 临时节点两条都保留(不参与去重)');
  check(after.msg1500 === 1, '真 DOM: 正常消息 1500 完好');
  check(removed === 1, '真 DOM: 恰好移除 1 个(不多删)');
  check(after.survivorText === ALINE, '真 DOM: 存活的 1418 文字 = 阿夜原句(没删错内容)');

  if (fails.length){ console.log('\n❌ 线上清道夫真渲染验证失败: ' + fails.length + ' 项'); process.exit(1); }
  console.log('\n✅ 线上发布的 dedupStreamByMid 在真 Chrome DOM 里成功塌缩深夜电台双份气泡(id 1418), 嵌套/临时/其他消息均无副作用');
}
main().catch(e => { console.error('验证脚本异常:', e); process.exit(1); });
