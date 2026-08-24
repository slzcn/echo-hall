(function(){
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;
  if(reduce) { window.EhFx={warp(){},soundwave(){},typeSpark(){},mood(){}}; return; }
  const coarse = window.matchMedia && matchMedia('(hover:none)').matches;  // 触屏设备

  // ---- 1. 光标/触摸赛博拖尾 ----
  (function cursorTrail(){
    if(coarse) return;  // 优化批A#3: 触屏无 hover,跳过整套 rAF 死循环
    const N=6, dots=[]; let x=innerWidth/2,y=innerHeight/2, tx=x,ty=y, active=false, hideT=null, raf=0;
    for(let i=0;i<N;i++){ const d=document.createElement('div'); d.className='cursor-trail'; d.style.opacity='0'; document.body.appendChild(d); dots.push({el:d,x,y}); }
    const frame=()=>{
      raf=0;
      if(document.hidden || !active) return;
      x+=(tx-x)*.35; y+=(ty-y)*.35;
      let px=x,py=y;
      dots.forEach((d,i)=>{ d.x+=(px-d.x)*.5; d.y+=(py-d.y)*.5; px=d.x; py=d.y;
        d.el.style.transform=`translate(${d.x-4}px,${d.y-4}px) scale(${1-i/N*0.7})`;
        d.el.style.opacity=String((1-i/N)*0.55); });
      raf=requestAnimationFrame(frame);
    };
    const stop=()=>{ active=false; if(raf){ cancelAnimationFrame(raf); raf=0; } dots.forEach(d=>{ d.el.style.opacity='0'; }); };
    const move=(px,py)=>{
      tx=px; ty=py; active=true; clearTimeout(hideT); hideT=setTimeout(stop,600);
      if(!document.hidden && !raf) raf=requestAnimationFrame(frame);
    };
    window.addEventListener('mousemove',e=>move(e.clientX,e.clientY),{passive:true});
    // coarse 触屏在函数入口已整体跳过，不再注册永远不会使用的 touchmove；把监听预算留给后台停帧。
    document.addEventListener('visibilitychange',()=>{ if(document.hidden) stop(); },{passive:true});
  })();

  // ---- 2. 深夜氛围: 本地时间 0-5 点 → deep-night ----
  (function deepNight(){
    var _dnT=null;
    const check=()=>{ let h; try{ h=new Date().getHours(); }catch(_){ return; }
      document.body.classList.toggle('deep-night', h>=0 && h<5); };
    check(); _dnT=setInterval(check, 5*60*1000);
    window._ehDeepNight = { stop: function(){ if(_dnT){ clearInterval(_dnT); _dnT=null; } } };
  })();

  // ---- 3. 灵魂心情天气: 轮询 roomSouls 主导情绪, 染 mood-aura + 微调全房氛围色 ----
  // TOP10 #4: moodWeather 轮询按进/离房启停,离房后不再吃CPU
  (function(){
    const aura=document.getElementById('moodAura');
    // 每种心情: 光晕色 c + 动画类 cls + 氛围叠加色 tint(用于给全房 --mood-tint, 融进边框/辉光)
    const MOOD={ excited:{c:'#FF6B35',cls:'mood-excited',tint:'#FF6B35'}, happy:{c:'#FFD24D',cls:'',tint:'#FFC24D'},
      caring:{c:'#B57EDC',cls:'mood-caring',tint:'#C77DFF'}, calm:{c:'#0ABAB5',cls:'',tint:''} };
    let _moodT=null, _lastDom=null;
    function tick(){
      try{
        if(!document.body.classList.contains('hall-on') || typeof roomSouls==='undefined' || !roomSouls.length){ aura.className='mood-aura'; if(_lastDom!==null){ clearMoodTint(); _lastDom=null; } return; }
        const cnt={}; roomSouls.forEach(s=>{ const e=s.emotion||'calm'; cnt[e]=(cnt[e]||0)+1; });
        let dom='calm',mx=0; Object.keys(cnt).forEach(e=>{ if(cnt[e]>mx){mx=cnt[e];dom=e;} });
        const m=MOOD[dom]||MOOD.calm;
        aura.style.setProperty('--mood-c', m.c);
        aura.className='mood-aura on '+(m.cls||'');
        // 主导心情变化时, 平滑把氛围色融进全房(边框/辉光轻微偏移), calm 则恢复房间原主题色
        if(dom!==_lastDom){ _lastDom=dom; applyMoodTint(m.tint, dom); }
      }catch(_){}
    }
    // 用 --mood-tint(色) + body class 让 CSS 把灵魂心情融进边框光晕; calm=清空回归房间主题
    function applyMoodTint(tint, dom){
      const root=document.documentElement;
      if(!tint){ clearMoodTint(); return; }
      root.style.setProperty('--mood-tint', tint);
      document.body.classList.add('mood-tinted');
      document.body.setAttribute('data-mood', dom);
    }
    function clearMoodTint(){
      document.documentElement.style.removeProperty('--mood-tint');
      document.body.classList.remove('mood-tinted');
      document.body.removeAttribute('data-mood');
    }
    window.startMoodWeather = function(){ if(_moodT) return; _moodT=setInterval(tick, 3000); tick(); };
    window.stopMoodWeather  = function(){ if(_moodT){ clearInterval(_moodT); _moodT=null; } if(aura) aura.className='mood-aura'; clearMoodTint(); _lastDom=null; };
    window.destroyMoodWeather = function(){ if(_moodT){ clearInterval(_moodT); _moodT=null; } };
    // deep-night 定时器清理已在上面的 deepNight 闭包内就地处理(var _dnT + window._ehDeepNight);
    // 此处不再重复挂载——旧的 `const dnOrig=check` 引用了 deepNight 闭包内的 check(此作用域不可见),
    // 会抛 ReferenceError: check is not defined, 直接崩掉整个 ambient-fx.js → 进厅链路断(点哪都进不去)。
  })();

  // ---- 供主脚本调用的钩子 ----
  const warpEl=document.getElementById('warp');
  const swEl=document.getElementById('soundwave');
  window.EhFx={
    // 进房空间穿越
    warp(){ if(!warpEl) return; warpEl.classList.remove('on'); void warpEl.offsetWidth; warpEl.classList.add('on'); },
    // 多人发言声波涟漪, strength 0~1
    soundwave(strength){ if(!swEl) return;
      // 日间浅底峰值压半(0.35上限), 夜间维持沉浸(0.7上限); 配合CSS日间收窄扩散, 边缘泛光不糊成顶部光带
      var _day = document.documentElement.getAttribute('data-mode')==='day';
      var _cap = _day ? 0.35 : 0.7, _base = _day ? 0.12 : 0.25;
      swEl.style.setProperty('--sw-strength', Math.min(_cap,_base+(strength||0)*0.15));
      swEl.classList.remove('pulse'); void swEl.offsetWidth; swEl.classList.add('pulse'); },
    // 打字流光: 在 (x,y) 溅出 n 个粒子
    typeSpark(x,y,n){ n=n||3; for(let i=0;i<n;i++){ const s=document.createElement('div'); s.className='type-spark';
      document.body.appendChild(s); const ang=Math.random()*Math.PI*2, dist=8+Math.random()*22, dur=400+Math.random()*300;
      const dx=Math.cos(ang)*dist, dy=Math.sin(ang)*dist-10;
      s.style.transform=`translate(${x}px,${y}px)`; s.style.opacity='1';
      s.animate([{transform:`translate(${x}px,${y}px)`,opacity:1},{transform:`translate(${x+dx}px,${y+dy}px)`,opacity:0}],{duration:dur,easing:'ease-out'});
      setTimeout(()=>s.remove(),dur+50); } },
  };
})();
