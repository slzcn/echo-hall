#!/usr/bin/env node
'use strict';
// 真 Chrome + 生产 UI/CSS：等待→预选→本人行动→再次等待；量 DOM 边界，不靠源码正则。
// --baseline 用 HEAD 的 UI/CSS 自证旧实现会红；截图和明细只写 /tmp。
const fs=require('fs'), path=require('path'), http=require('http'), cp=require('child_process');
const {chromium}=require('playwright');
const ROOT=path.resolve(__dirname,'..'), baseline=process.argv.includes('--baseline');
const OUT='/tmp/eh-action-layout'+(baseline?'-baseline':''); fs.mkdirSync(OUT,{recursive:true});
const read=f=>baseline && /(?:ui\.js|table-shared\.css)$/.test(f)?cp.execFileSync('git',['show','HEAD:'+f],{cwd:ROOT,encoding:'utf8'}):fs.readFileSync(path.join(ROOT,f),'utf8');
const games={poker:{p:'pk',api:'EHPokerGame',files:['poker-eval','poker-engine','poker-ai','poker-net','poker-ui'],n:6},ddz:{p:'ddz',api:'EHDdzGame',files:['ddz-rules','ddz-engine','ddz-ai','ddz-net','game-ui'],n:3},guandan:{p:'gd',api:'EHGuandanGame',files:['guandan-rules','guandan-engine','guandan-ai','guandan-net','guandan-ui'],n:4}};
const html='<!doctype html><html class="pwa-standalone"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{margin:0;padding:0;box-sizing:border-box}html{--bg:#070a12;--panel:#132a29;--panel-solid:#132a29;--line:#24514d;--line2:#387c74;--ink:#eaf6ff;--sub:#86cbc6;--accent:#00e5d4;--amber:#ffc24d;--cyan:#00e5d4;--dim:#498d88}html,body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,"PingFang SC",sans-serif}#hall{position:relative;width:100%;height:100vh;overflow:hidden}</style><div id="hall"></div>';
(async()=>{
 const server=http.createServer((req,res)=>{try{res.end(req.url==='/'?html:read(req.url.slice(1)));}catch(e){res.statusCode=404;res.end('not found');}}); await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 let bad=0; const report=[];
 try{for(const [game,cfg] of Object.entries(games)) for(const [width,height] of [[390,844],[360,730],[844,390],[730,360]]){
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true}); const page=await context.newPage(), errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.evaluate(()=>{window.EhSfx={play(){},say(){},stop(){}};window.EhGameBgm={enter(){},exit(){}};
   const timeout=setTimeout.bind(window),interval=setInterval.bind(window);window.__sleep=ms=>new Promise(r=>timeout(r,ms));
   window.setTimeout=(fn,ms,...args)=>timeout(fn,Math.max(1,(ms||0)/5),...args);window.setInterval=(fn,ms,...args)=>interval(fn,Math.max(1,(ms||0)/5),...args);
  });
  for(const f of ['deck','table-orient','strategy-core','card-counter',...cfg.files]) await page.addScriptTag({url:'/js/games/'+f+'.js'});
  // index.html 的共享 link 在 body 尾，晚于 injectCSS() 追加到 head 的局内样式。
  await page.evaluate(()=>new Promise((resolve,reject)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/js/games/table-shared.css';l.onload=resolve;l.onerror=reject;document.body.appendChild(l);}));
  await page.evaluate(c=>{window.__g=window[c.api].open({names:['我','狼姐','AI乙','AI丙','狐狸','AI戊'].slice(0,c.n),avatars:['🙂','🐺','👾','🐱','🦊','🐼'].slice(0,c.n),isAI:Array.from({length:c.n},(_,i)=>i>0),mySeat:0,seed:20260909});window.dispatchEvent(new Event('resize'));},cfg);
  // 入场 translateY(10px) 是有意动画，等它结束后才量回合切换。
  await page.waitForTimeout(400);
  const samples=await page.evaluate(async({game,p})=>{
   const out=[],seen={},start=performance.now(); const click=s=>{const b=document.querySelector(s);if(b&&!b.disabled){b.click();return true;}return false;};
   const rect=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right};};
   while(performance.now()-start<13000){const st=__g.state(),mine=game==='poker'?st.toAct===0:st.turn===0;
    const active=game==='poker'?['preflop','flop','turn','river'].includes(st.phase):st.phase==='play';
    const kind=game==='poker'?(document.querySelector('.pk-prerow')?'pre':document.querySelector('.pk-waitbar')?'wait':document.querySelector('#pkCall')?'mine':null):(active?(mine?'mine':'wait'):null);
    if(kind&&(!seen[kind]||seen[kind]<4)){
     seen[kind]=(seen[kind]||0)+1;
     out.push({kind,phase:st.phase,felt:rect('.'+p+'-felt'),acts:rect('.'+p+'-acts'),ctrl:rect(game==='ddz'?'#ddzCtrl':game==='guandan'?'.gd-foot':'.pk-acts'),me:rect('.'+p+'-me'),raise:rect('.pk-raise'),quick:rect('.pk-quick')||rect('.pk-prehint'),row:rect('.pk-acts>.pk-row'),blind:rect('.pk-blinds'),seat:rect('.pk-me-seat'),table:rect('.pk-table')});
    }
    if(game==='poker'&&kind==='pre'&&!window.__preClicked){click('[data-pre="check"]');window.__preClicked=true;}
    if(st.phase==='bid')click('[data-bid="3"]')||click('[data-bid="1"]');
    if(st.phase==='double')click('[data-dbl="1"]');
    if(active&&mine){await __sleep(160);if(game==='poker')click('#pkCall');else {click('#'+p+'Hint');await __sleep(80);click('#'+p+'Play')||click('#'+p+'Pass');}}
    if(st.phase==='over')break;
    await __sleep(45);
   }return out;
  },{game,p:cfg.p});
  await page.screenshot({path:`${OUT}/${game}-${width}x${height}.png`});
  const issues=[]; const required=game==='poker'?['wait','pre','mine']:['wait','mine'];for(const k of required)if(!samples.some(s=>s.kind===k))issues.push('缺阶段 '+k);
  for(const key of ['felt','ctrl'])for(const prop of ['y','h']){const values=samples.filter(s=>s[key]).map(s=>s[key][prop]);const delta=Math.max(...values)-Math.min(...values);if(delta>1)issues.push(key+'.'+prop+' 跳动 '+delta.toFixed(2));}
  if(game==='poker')for(const s of samples){const b=s.blind,t=s.table,a=s.seat;if(b&&t&&Math.abs(b.x+b.w/2-t.x-t.w/2)>1)issues.push('盲注不居中');if(b&&a&&Math.min(b.r,a.r)>Math.max(b.x,a.x)&&Math.min(b.b,a.b)>Math.max(b.y,a.y))issues.push('盲注被本人座位遮挡');}
  for(const s of samples)if(s.ctrl&&(s.ctrl.b>height+1||s.ctrl.y<0))issues.push('操作区越界');
  issues.push(...errors);bad+=issues.length;const entry={game,width,height,issues:[...new Set(issues)],samples};report.push(entry);console.log(game,width+'x'+height,JSON.stringify(entry.issues),JSON.stringify(samples.filter((s,i,a)=>a.findIndex(t=>t.kind===s.kind)===i)));
  await context.close();
 }}finally{await browser.close();server.close();}
 fs.writeFileSync(OUT+'/results.json',JSON.stringify(report,null,2));console.log('问题数',bad,'明细',OUT);process.exitCode=bad?1:0;
})().catch(e=>{console.error(e);process.exit(1);});
