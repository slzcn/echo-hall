#!/usr/bin/env node
'use strict';
// 真实站点、懒加载器、牌桌及服务端教练端到端探针。凭据只从本机文件读入，绝不打印。
const fs=require('fs'),assert=require('assert');
const {chromium}=require('playwright');
(async()=>{
  const auth=JSON.parse(fs.readFileSync(process.env.EH_STRATEGY_AUTH||'/tmp/eh-strategy-auth.json','utf8'));
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  try{
    for(const kind of (process.env.EH_GAMES||'ddz,guandan,poker').split(',')){
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.goto(process.env.EH_URL||'http://127.0.0.1:8769/',{waitUntil:'domcontentloaded'});
      await page.waitForFunction(()=>!!window.EHGameLoader,{timeout:30000});
      await page.evaluate(async({kind,token,endpoint})=>{
        await EHGameLoader.ensure(kind);
        window.__EH_ACCESS_TOKEN=token;window.__EH_STRATEGY_ENDPOINT=endpoint;window.__EH_STRATEGY_OPTIONS={timeout:10000,minConfidence:.55};
        const names={ddz:'EHDdz',guandan:'EHGuandan',poker:'EHPoker'},prefix=names[kind],ai=window[prefix+'AI'];
        window.__strategyProbe={requests:0,success:0,consumed:0,applied:0,failed:0};
        const nativeFetch=window.fetch.bind(window);
        window.fetch=async(url,opts)=>{
          if(String(url)===endpoint){
            const input=JSON.parse(opts.body).input;
            for(const forbidden of ['deck','_deck','seed','log','hands','players'])if(forbidden in input)throw Error('hidden state');
            __strategyProbe.requests++;
            const response=await nativeFetch(url,opts),body=await response.clone().json();
            if(body.source==='coach'&&body.policy.confidence>=.55)__strategyProbe.success++;else {__strategyProbe.failed++;__strategyProbe.lastFailure={status:response.status,error:body.error,input};}
            return response;
          }
          return nativeFetch(url,opts);
        };
        const decide=ai.decide;
        ai.decide=function(...args){const strategy=kind==='poker'?args[2]&&args[2].strategy:args[0].strategy;
          const result=decide.apply(this,args);if(strategy&&strategy.source==='coach'&&result){__strategyProbe.consumed++;window.__coachDecision={result,seat:kind==='poker'?args[1]:args[0].seat};}return result;};
        const engine=window[prefix+'Engine'],method=kind==='poker'?'applyAction':'applyPlay',apply=engine[method];
        engine[method]=function(...args){const result=apply.apply(this,args),d=window.__coachDecision;
          if(d&&d.seat===args[1]&&(kind==='poker'?d.result.action===args[2]&&d.result.amount===args[3]:d.result.cards===args[2])){__strategyProbe.applied++;window.__coachDecision=null;}return result;};
        // 使用真实牌桌操作面；全部本机AI席避免人为等待影响教练消费观测。
        const mount=document.createElement('div');mount.style.cssText='position:fixed;inset:0;z-index:999999;background:#101522';document.body.append(mount);
        const n=kind==='poker'?6:kind==='guandan'?4:3;
        window.__strategyGame=window[prefix+'Game'].open({mount,names:Array.from({length:n},(_,i)=>'策略探针'+i),isAI:Array(n).fill(true),mySeat:0,seed:42,startStack:10000,scoreKey:'strategy-probe-'+kind});
      },{kind,token:auth.access_token,endpoint:auth.endpoint});
      await page.evaluate(()=>{
        window.__probeClicks=setInterval(()=>{
          const click=s=>{const e=document.querySelector(s);if(e&&!e.disabled){e.click();return true;}return false;};
          for(const v of [3,2,1,0])if(click('[data-bid="'+v+'"]'))break;
          click('[data-dbl="1"]');
          for(const k of ['ddz','gd']){click('#'+k+'Hint');if(!click('#'+k+'Play'))click('#'+k+'Pass');}
          click('#pkCall');['#ddzAgain','#gdAgain','#pkAgain','#pkNext'].some(click);
        },400);
      });
      try{await page.waitForFunction(()=>__strategyProbe.success>0&&__strategyProbe.consumed>0&&__strategyProbe.applied>0,{},{timeout:110000});}
      catch(e){console.log(kind,JSON.stringify(await page.evaluate(()=>__strategyProbe)));throw e;}
      const evidence=await page.evaluate(()=>({build:window.__EH_BUILD_VER,app:window.__EH_APP_VER,...__strategyProbe,phase:__strategyGame.state().phase}));
      await page.screenshot({path:'/tmp/eh-strategy-live-'+kind+'.png'});
      await page.evaluate(()=>__strategyGame.close());
      assert.equal(errors.length,0,errors.join(';'));console.log(kind,JSON.stringify(evidence));
      await context.close();
      if(kind!=='poker')await new Promise(r=>setTimeout(r,61000));
    }
  }finally{await browser.close();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
