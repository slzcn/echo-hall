#!/usr/bin/env node
'use strict';
/* 验证德州牌桌三处打磨(主人条2/3/4):
 *   条3 命名统一: 开局兜底名「机器人N」就地规范成花名(阿岩/狐狸…), 与手动邀请同一套; 我(mySeat)/真名不动。
 *   条2 操作栏溢出: 旁观/等待态改整行 .pk-waitbar 承载长文案, 横向不溢出(scrollWidth<=clientWidth), 文案完整。
 *   条4 返回钮饱满: .pk-x 与 .pk-mus 同款玻璃底(有 background、padding:0、圆形), 不再描边空心。 */
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const G=f=>fs.readFileSync(path.join(ROOT,'js/games',f),'utf8');
const SHARED=fs.readFileSync(path.join(ROOT,'js/games/table-shared.css'),'utf8');
const NIGHT='--bg:#070a12;--bg2:#0d1524;--panel:rgba(21,50,48,0.8);--panel-solid:#132a29;--line:rgba(0,229,212,0.24);--line2:rgba(0,229,212,0.38);--ink:#EAF6FF;--sub:#86cbc6;--dim:#498d88;--cyan:#00E5D4;--magenta:#FF2D8E;--violet:#9C85FF;--amber:#FFC24D;--green:#34E0B0;--accent:#00E5D4;--grid:rgba(0,229,212,0.05);--glow-cyan:0 0 22px rgba(0,229,212,0.6);--glow-mag:0 0 20px rgba(255,45,142,0.55);';
let chromium; try{({chromium}=require('playwright'));}catch(_){try{({chromium}=require('playwright-core'));}catch(__){}}
const EXE=['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/Applications/Chromium.app/Contents/MacOS/Chromium',process.env.CHROME_PATH].filter(Boolean).find(p=>{try{return fs.existsSync(p)}catch(_){return false}});
const FILES=['deck.js','poker-eval.js','poker-engine.js','poker-ai.js','poker-net.js','poker-ui.js'];

(async()=>{
  if(!chromium||!EXE){console.log('缺 playwright/Chrome');process.exit(1);}
  const browser=await chromium.launch({executablePath:EXE});
  const ctx=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
  const page=await ctx.newPage(); const errs=[]; page.on('pageerror',e=>errs.push(e.message));
  await page.setContent('<!doctype html><html><meta charset=utf-8><style>html{'+NIGHT+'}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><body><div id="hall"></div>',{waitUntil:'load'});
  for(const f of FILES) await page.addScriptTag({content:G(f)});
  await page.evaluate(`window.__pk=window.EHPokerGame.open({names:['你','机器人1','机器人4','机器人5'],avatars:['🙂','🤖','🤖','🤖'],isAI:[false,true,true,true],mySeat:0,seed:20260915,actMs:400})`);
  await page.addStyleTag({content:SHARED});
  await page.waitForTimeout(250);

  // 条3
  const nm=await page.evaluate(()=>window.__pk.state().players.map(p=>p.name));
  const BOT_NAMES=['阿岩','小凶','疯哥','冷面','老练','莽夫','狐狸','铁头'];
  console.log('  条3 各席名:', JSON.stringify(nm));
  const meOk = nm[0]==='你';
  const botsRenamed = [1,2,3].every(i=> BOT_NAMES.includes(nm[i]));
  const noneRobot = nm.every(x=> !/^机器人\d*$/.test(x));
  const uniq = new Set([1,2,3].map(i=>nm[i])).size===3;

  // 条2
  await page.evaluate(()=>window.__pk.enterSpectator());
  await page.waitForTimeout(300);
  const wb=await page.evaluate(()=>{
    const el=document.querySelector('.pk-acts .pk-waitbar');
    if(!el) return {found:false};
    return { found:true, text:(el.textContent||'').trim(), scrollW:el.scrollWidth, clientW:el.clientWidth };
  });
  console.log('  条2 waitbar:', JSON.stringify(wb));
  const wbFound=wb.found;
  const wbNoOverflow = wb.found && wb.scrollW<=wb.clientW+1;
  const wbText = wb.found && /旁观中/.test(wb.text) && /已离座/.test(wb.text);

  // 条4
  const btn=await page.evaluate(()=>{
    const g=s=>{const e=document.querySelector(s); if(!e) return null; const c=getComputedStyle(e); const r=e.getBoundingClientRect();
      return { bg:c.backgroundImage, bgc:c.backgroundColor, pad:c.padding, br:c.borderRadius, w:Math.round(r.width), h:Math.round(r.height) };};
    return { x:g('.pk-x'), mus:g('.pk-mus') };
  });
  console.log('  条4 pk-x :', JSON.stringify(btn.x));
  console.log('  条4 pk-mus:', JSON.stringify(btn.mus));
  const xHasGlass = btn.x && (/gradient/.test(btn.x.bg) || (btn.x.bgc && btn.x.bgc!=='rgba(0, 0, 0, 0)'));
  const xPad0 = btn.x && /^0px/.test(btn.x.pad);
  const xRound = btn.x && parseFloat(btn.x.br)>=17;
  const xSquare = btn.x && Math.abs(btn.x.w-btn.x.h)<=1 && btn.x.w>=34 && btn.x.w<=38;

  await browser.close();

  let ok=true;
  if(errs.length){ ok=false; console.log('❌ pageerror:', errs.slice(0,3).join(' | ')); }
  if(!meOk){ ok=false; console.log('❌ 条3 我(mySeat)名字被误改'); }
  if(!botsRenamed){ ok=false; console.log('❌ 条3 AI 席未全部规范成花名'); }
  if(!noneRobot){ ok=false; console.log('❌ 条3 仍存在"机器人N"名'); }
  if(!uniq){ ok=false; console.log('❌ 条3 花名重复'); }
  if(meOk&&botsRenamed&&noneRobot&&uniq) console.log('✅ 条3 兜底名统一成花名(与手动邀请同套), 我/真名不动, 无重名');
  if(!wbFound){ ok=false; console.log('❌ 条2 旁观态未渲染整行 .pk-waitbar'); }
  if(!wbNoOverflow){ ok=false; console.log('❌ 条2 waitbar 横向溢出'); }
  if(!wbText){ ok=false; console.log('❌ 条2 waitbar 文案不完整'); }
  if(wbFound&&wbNoOverflow&&wbText) console.log('✅ 条2 旁观/等待态用整行状态条, 长文案不溢出且完整');
  if(!xHasGlass){ ok=false; console.log('❌ 条4 返回钮无玻璃底色(仍描边空心)'); }
  if(!xPad0){ ok=false; console.log('❌ 条4 返回钮仍带旧 padding'); }
  if(!xRound){ ok=false; console.log('❌ 条4 返回钮非圆形'); }
  if(!xSquare){ ok=false; console.log('❌ 条4 返回钮尺寸异常'); }
  if(xHasGlass&&xPad0&&xRound&&xSquare) console.log('✅ 条4 返回钮拿到玻璃底+圆形, 与音乐/横屏钮同款饱满');
  console.log(ok?'—— 通过':'—— 失败');
  process.exit(ok?0:1);
})().catch(e=>{console.error(e);process.exit(1);});
