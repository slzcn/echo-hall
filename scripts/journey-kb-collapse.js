// 红灯旅程：估算键盘高在覆盖式键盘收起时应清零
// 场景：小米 WebView / 部分 Android，overlaysContent=true 覆盖式键盘
//   - focusin → 250ms 无信号窗口 → estimatedKbH 被估算为非 0
//   - 用户敲系统"关闭键盘"按钮：VK 发 geometrychange，boundingRect.height 回 0
//   - 但 activeElement 仍是 #cin，innerH 变化 <50（覆盖式本就不缩）
//   - startKbCollapseWatch 的两个分支都不命中 → estimatedKbH 卡住 → visibleHeight() 一直扣键盘高
// 这个脚本用真实抽取的 keyboard.js 逻辑跑；红灯期它必失败，绿灯期它必通过。
'use strict';
const fs=require('fs'), vm=require('vm'), path=require('path');
const assert=(cond,msg)=>{ if(!cond){ console.error('✗',msg); process.exit(1); } console.log('✓',msg); };

const src=fs.readFileSync(path.join(__dirname,'..','js/keyboard.js'),'utf8');

// 造一个仿真 DOM/环境让 keyboard.js 能跑；关键是能观察到 estimatedKbH 的效果（通过 hall.style.height 变化）。
function makeSandbox(){
  const listeners={ document:{}, window:{}, viewport:{}, virtualKeyboard:{} };
  function on(bag,type,fn){ (bag[type]||(bag[type]=[])).push(fn); }
  function emit(bag,type,ev){ (bag[type]||[]).forEach(fn=>fn(ev||{target:null})); }

  const hall={ id:'hall', style:{height:''}, };
  const cin={ id:'cin', tagName:'TEXTAREA', blur(){}, };
  let activeEl=null;
  const bodyClasses=new Set(['hall-on']);
  const rootStyle={
    _v:{},
    setProperty(k,v){ this._v[k]=v; },
    removeProperty(k){ delete this._v[k]; },
    getPropertyValue(k){ return this._v[k]||''; },
  };
  const rootClassList={
    _s:new Set(),
    add(c){ this._s.add(c); },
    remove(c){ this._s.delete(c); },
    contains(c){ return this._s.has(c); },
  };
  const docEl={ style:rootStyle, classList:rootClassList, removeAttribute(){}, setAttribute(){} };
  const doc={
    documentElement:docEl,
    getElementById:id=>id==='hall'?hall:(id==='cin'?cin:null),
    body:{ classList:{ contains:c=>bodyClasses.has(c) }, appendChild(){}, },
    createElement:()=>({ style:{}, getBoundingClientRect:()=>({height:0}), remove(){} }),
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    addEventListener:(t,fn)=>on(listeners.document,t,fn),
    removeEventListener(){},
    get activeElement(){ return activeEl; },
  };
  const vv={
    height:800, offsetTop:0,
    addEventListener:(t,fn)=>on(listeners.viewport,t,fn),
  };
  const vk={
    overlaysContent:false, boundingRect:{height:0},
    addEventListener:(t,fn)=>on(listeners.virtualKeyboard,t,fn),
  };
  const win={
    innerHeight:800, scrollY:0,
    matchMedia:()=>({ matches:true }),   // 触屏
    scrollTo(){ this.scrollY=0; },
    addEventListener:(t,fn)=>on(listeners.window,t,fn),
    requestAnimationFrame:cb=>setTimeout(cb,0),
    cancelAnimationFrame:id=>clearTimeout(id),
    setTimeout,clearTimeout,setInterval,clearInterval,
    navigator:{ virtualKeyboard:vk },
    visualViewport:vv,
    document:doc,
    __ehState:{},
  };
  win.window=win;

  return { win, doc, vv, vk, hall, cin, listeners,
    setActive:e=>{ activeEl=e; },
    emit,
  };
}

async function tick(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function run(){
  const s=makeSandbox();
  const ctx=vm.createContext({
    window:s.win, document:s.doc, navigator:s.win.navigator,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: s.win.requestAnimationFrame,
    cancelAnimationFrame: s.win.cancelAnimationFrame,
  });
  vm.runInContext(src, ctx);

  s.setActive(s.cin);
  s.emit(s.listeners.document,'focusin',{ target:s.cin });
  await tick(300);
  const heightAfterFocus=parseInt(s.hall.style.height,10);

  // 触发一次非 0 geometrychange 抬升 vkGeomHits（真实弹起峰值）
  s.vk.boundingRect={height:340};
  s.emit(s.listeners.virtualKeyboard,'geometrychange',{ target:s.vk });
  await tick(20);
  // 马上把 estimatedKbH 重新置为非 0（时序上：真信号拉回后，无新信号，WebView 也没再发）
  // 现实中：focusin→估算→真值到一次→又回 0，或 focusin 后直接 geometrychange non-zero（没信号窗）。
  // 为了紧扣“信号 3”分支，模拟上面重新弹起：
  s.setActive(s.cin);
  s.emit(s.listeners.document,'focusin',{ target:s.cin });
  await tick(300);

  // 现在物理收键盘：VK.boundingRect.height 回 0，但【不再发 geometrychange】
  //   （主人手机真实场景：系统输入法/部分 WebView 收键盘时只更新 boundingRect，不派事件）
  //   → 只剩 300ms 轮询 tick 能靠“当前 boundingRect.height===0”把估算清零。
  s.vk.boundingRect={height:0};

  // 关键：实际 WebView 上 geometrychange 常不靠，不发时只剩 300ms 轮询 tick
  // startKbCollapseWatch 里的信号 3 需要在轮询内看到 rect.height===0 即清零（不再要求 vkGeomHits 增长）
  await tick(400);
  const heightAfterClose=parseInt(s.hall.style.height,10);
  return { heightAfterFocus, heightAfterClose };
}

(async()=>{
  console.log('\n== 验证当前实现：信号 3 已补齐 ==');
  const r=await run();
  console.log('  hall focus→',r.heightAfterFocus,' close→',r.heightAfterClose);
  assert(r.heightAfterFocus>0 && r.heightAfterFocus<800, '步骤 1: focusin 后估算生效, hall 矮于全高');
  assert(r.heightAfterClose>=700, '步骤 2: 涵盖式无 geometrychange 收键盘时, 信号 3 将估算清零, hall 回升到接近全高');

  console.log('\n== 反证：把信号 3 换回空实现（旧代码）必抢红 ==');
  const s2=makeSandbox();
  const ctx2=vm.createContext({
    window:s2.win, document:s2.doc, navigator:s2.win.navigator,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: s2.win.requestAnimationFrame,
    cancelAnimationFrame: s2.win.cancelAnimationFrame,
  });
  const anchor=`try {
        const r = virtualKeyboard && virtualKeyboard.boundingRect;
        // 不要求 vkGeomHits 增长：部分 Android PWA 只更新 boundingRect，不派 geometrychange。
        if (r && r.height === 0) {
          dismissSoftKeyboardLayout();
          return;
        }
      } catch (_) {}`;
  const empty=`try {
        const r = virtualKeyboard && virtualKeyboard.boundingRect;
        // (旧实现：信号 3 要求 vkGeomHits 增长——WebView 不再发 geometrychange 时永远不成立)
        if (r && r.height === 0 && vkGeomHits > (signalBaseline?.vkHits || 0)) {
          estimatedKbH = 0;
          clearInterval(collapseTimer); collapseTimer = 0;
          settleChatLayout();
          return;
        }
      } catch (_) {}`;
  const legacy=src.replace(anchor, empty);
  if(legacy===src){ console.error('❌ 反证锚点未命中'); process.exit(1); }
  vm.runInContext(legacy, ctx2);
  s2.setActive(s2.cin);
  s2.emit(s2.listeners.document,'focusin',{ target:s2.cin });
  await tick(300);
  const h1=parseInt(s2.hall.style.height,10);
  s2.vk.boundingRect={height:340};
  s2.emit(s2.listeners.virtualKeyboard,'geometrychange',{ target:s2.vk });
  await tick(20);
  s2.setActive(s2.cin);
  s2.emit(s2.listeners.document,'focusin',{ target:s2.cin });
  await tick(300);
  s2.vk.boundingRect={height:0};
  // 关键：旧实现下，不再重新发 geometrychange，只靠轮询 → 旧代码信号 3 要求 vkGeomHits 增长 → 无法清零
  await tick(400);
  const h2=parseInt(s2.hall.style.height,10);
  console.log('  旧实现 focus→',h1,' close→',h2);
  assert(h2<700, '反证: 信号 3 空实现时、WebView 不主动发 geometrychange, hall 就会残留矮高 (旧 bug 必现)');

  console.log('\n✅ 键盘收起残留旅程：当前实现绿、空实现必红。');
  process.exit(0); // 沙盒中的生产轮询定时器仍存活；旅程完成后显式收尾，避免 CI 悬挂
})().catch(err=>{ console.error(err); process.exit(1); });
