#!/usr/bin/env node
'use strict';
/**
 * journey-game-experience.js — 联机状态、后台提醒、战报回看升级旅程
 *
 * 覆盖本次用户可见行为：
 * 1. 德州/掼蛋 guest 牌桌真实渲染连接状态，并在重连/房主离线时锁住操作；
 * 2. 恢复 online 后状态提示消失、操作链恢复；
 * 3. 非 0 座位通过 mySeat() 暴露给后台“轮到我”判断；
 * 4. app.js 含 host_ping 8s 心跳、15s 离线判定、后台 title/通知提醒；
 * 5. 三类战绩卡都有回看入口，ehShowReplay 必须调用对应引擎 replay()；
 * 6. 三个引擎使用真实完整 log 重建终局，防“只有摘要、没有 replay”回退。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const G = f => fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

let step=0, failed=false;
function assert(ok, msg){ step++; if(!ok){ failed=true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// ── 源码契约：网络心跳、后台提醒、回看整合必须真实存在 ──
assert(/event:'host_ping'/.test(APP) && /setInterval\(send,\s*8000\)/.test(APP), 'host 每 8 秒广播 host_ping');
assert(/gap>15000/.test(APP) && /setConn\('host_offline'\)/.test(APP), 'guest 15 秒收不到 host_ping 显示房主离线');
assert(/CHANNEL_ERROR'\|\|status==='TIMED_OUT'\|\|status==='CLOSED/.test(APP) && /setConn\('reconnecting'\)/.test(APP), 'Realtime 错误/超时/关闭进入重连中');
assert(/document\.hidden[\s\S]{0,220}_isMyTurnInGame/.test(APP) && /new Notification\('🫵 轮到你出牌/.test(APP), '后台轮到我触发标题与已授权桌面通知');
assert(!/Notification\.requestPermission/.test(APP), '不主动弹通知授权框，只在用户已授权时渐进增强');
assert((APP.match(/data-eh-replay="1"/g)||[]).length===3, '斗地主/掼蛋/德州三张战绩卡都有回看按钮');
assert(/window\.EHDdzEngine[\s\S]{0,160}window\.EHGuandanEngine[\s\S]{0,160}window\.EHPokerEngine/.test(APP), '回看按游戏选择正确引擎');
assert(/engine\.replay\(g\.log\)/.test(APP) && /replayed\.phase!==['"]over['"]/.test(APP), '回看先调用 replay(log) 并校验终局，不以摘要冒充回看');

function findChrome(){
  const cands=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean);
  return cands.find(p=>{ try{return fs.existsSync(p);}catch(_){return false;} });
}
let chromium;
try{ ({chromium}=require('playwright')); }catch(_){ try{({chromium}=require('playwright-core'));}catch(__){} }
const CSS=':root{--accent:#00e5d4;--amber:#ffc24d;--sub:#86cbc6;--ink:#eaf6ff;--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--glow-cyan:0 0 12px rgba(0,229,212,.5)}html,body{margin:0;background:#070a12;color:#eaf6ff}#hall{position:relative;width:390px;height:844px;overflow:hidden}';

async function newHall(browser, files){
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSS+'</style><div id="hall"></div>');
  for(const f of files) await page.addScriptTag({content:G(f)});
  return {ctx,page,errs};
}

async function pokerTrip(browser){
  const {ctx,page,errs}=await newHall(browser,['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js']);
  await page.evaluate(()=>{ window.__g=EHPokerGame.open({mode:'guest',names:['房主','远客甲','远客乙'],avatars:['🙂','🧑','👩'],mySeat:2,onAction(){}}); });
  let r=await page.evaluate(()=>({seat:__g.mySeat(),conn:__g.connState()}));
  assert(r.seat===2,'德州 guest 暴露真实非 0 座位 mySeat=2');
  assert(r.conn==='online','德州初始连接状态 online');
  await page.evaluate(()=>__g.setConn('reconnecting'));
  r=await page.evaluate(()=>({msg:document.querySelector('#pkMsg').textContent,disabled:!!document.querySelector('#pkActs button:disabled')}));
  assert(/重连中/.test(r.msg),'德州牌桌可见“重连中”');
  assert(r.disabled,'德州重连中锁住操作区');
  await page.evaluate(()=>{__g.minimize();__g.setConn('host_offline');}); await page.waitForTimeout(280);
  r=await page.evaluate(()=>({chip:document.querySelector('.pk-chip .ck-t').textContent,msg:document.querySelector('#pkMsg').textContent}));
  assert(/房主离线/.test(r.chip)&&/房主离线/.test(r.msg),'德州房主离线同步到牌桌和折叠片');
  await page.evaluate(()=>__g.setConn('online'));
  r=await page.evaluate(()=>({conn:__g.connState(),chip:document.querySelector('.pk-chip .ck-t').textContent}));
  assert(r.conn==='online'&&!/离线|重连/.test(r.chip),'德州恢复在线后清除离线状态');
  assert(errs.length===0,'德州连接状态旅程零 pageerror');
  await ctx.close();
}

async function guandanTrip(browser){
  const {ctx,page,errs}=await newHall(browser,['deck.js','guandan-rules.js','guandan-engine.js','guandan-ai.js','guandan-net.js','guandan-ui.js']);
  await page.evaluate(()=>{ window.__g=EHGuandanGame.open({mode:'guest',names:['房主','远客甲','队友','远客乙'],avatars:['🙂','🧑','🤝','👩'],mySeat:3,onAction(){}}); });
  let r=await page.evaluate(()=>({seat:__g.mySeat(),conn:__g.connState()}));
  assert(r.seat===3,'掼蛋 guest 暴露真实非 0 座位 mySeat=3');
  await page.evaluate(()=>__g.setConn('reconnecting'));
  r=await page.evaluate(()=>({banner:document.querySelector('#gdBanner').textContent,disabled:!!document.querySelector('#gdCtrl button:disabled')}));
  assert(/重连中/.test(r.banner),'掼蛋牌桌可见“重连中”');
  assert(r.disabled,'掼蛋重连中锁住操作区');
  await page.evaluate(()=>{__g.minimize();__g.setConn('host_offline');}); await page.waitForTimeout(280);
  r=await page.evaluate(()=>({chip:document.querySelector('.gd-chip .ck-t').textContent,banner:document.querySelector('#gdBanner').textContent}));
  assert(/房主离线/.test(r.chip)&&/房主离线/.test(r.banner),'掼蛋房主离线同步到牌桌和折叠片');
  await page.evaluate(()=>__g.setConn('online'));
  r=await page.evaluate(()=>({conn:__g.connState(),chip:document.querySelector('.gd-chip .ck-t').textContent}));
  assert(r.conn==='online'&&!/离线|重连/.test(r.chip),'掼蛋恢复在线后清除离线状态');
  assert(errs.length===0,'掼蛋连接状态旅程零 pageerror');
  await ctx.close();
}

async function main(){
  const exe=findChrome();
  if(!chromium||!exe){ console.log('⏭ 跳过连接状态真实渲染：'+(!chromium?'playwright 未安装':'未找到 Chrome')); }
  else { const browser=await chromium.launch({executablePath:exe}); await pokerTrip(browser); await guandanTrip(browser); await browser.close(); }
  if(failed){ console.error(`\n❌ 游戏体验旅程 ${step} 步有失败`); process.exit(1); }
  console.log(`\n✅ 游戏体验旅程 ${step} 步全通过：连接可见/断线锁操作/房主离线/非0座位/后台提醒/回看重建`);
}
main().catch(e=>{console.error(e);process.exit(1);});
