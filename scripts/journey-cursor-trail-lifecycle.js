const fs=require('fs'), vm=require('vm'), assert=require('assert');
const src=fs.readFileSync('js/ambient-fx.js','utf8');
let rafQ=[], cancelled=new Set(), hidden=false, listeners={};
const body={appendChild(){},classList:{toggle(){},add(){},remove(){}},setAttribute(){},removeAttribute(){}};
const ctx={
  window:{matchMedia:()=>({matches:false}),addEventListener:(t,f)=>(listeners[t]||(listeners[t]=[])).push(f),EhFx:null},
  matchMedia:()=>({matches:false}),innerWidth:1000,innerHeight:800,
  document:{body,hidden:false,documentElement:{style:{setProperty(){},removeProperty(){}}},getElementById:()=>({style:{setProperty(){}},className:'',classList:{remove(){},add(){}}}),createElement:()=>({className:'',style:{},animate(){return{}},remove(){}}),addEventListener:(t,f)=>(listeners[t]||(listeners[t]=[])).push(f)},
  requestAnimationFrame:f=>{rafQ.push(f);return rafQ.length;},cancelAnimationFrame:id=>cancelled.add(id),
  setTimeout:(f)=>{ctx._timeout=f;return 1},clearTimeout(){},setInterval:()=>1,clearInterval(){},Date,Math,console
};
ctx.window.window=ctx.window; vm.createContext(ctx); vm.runInContext(src,ctx);
assert.equal(rafQ.length,0,'空闲时不应启动 rAF');
listeners.mousemove[0]({clientX:20,clientY:30});
assert.equal(rafQ.length,1,'移动后启动一个 rAF');
let f=rafQ.shift(); f(); assert.equal(rafQ.length,1,'活跃时续帧');
ctx._timeout(); f=rafQ.shift(); f(); assert.equal(rafQ.length,0,'静止后停止续帧');
ctx.document.hidden=true; listeners.visibilitychange[0]();
listeners.mousemove[0]({clientX:30,clientY:40}); assert.equal(rafQ.length,0,'后台不启动 rAF');
ctx.document.hidden=false; listeners.visibilitychange[0]();
listeners.mousemove[0]({clientX:40,clientY:50}); assert.equal(rafQ.length,1,'回前台再次移动可恢复');
assert(!/requestAnimationFrame\(loop\);\s*\}\)\(\)/.test(src),'旧永久递归实现必须移除');
console.log('✓ 光标拖尾空闲／后台停帧，移动后按需恢复；旧永久循环反证通过');
