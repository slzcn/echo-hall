/**
 * sfx-engine.js — 音效与 CSS 动画钩子 (拆分自 app.js)
 * EhSfx: Web Audio 合成音效，挂载 window.EhSfx
 * ehFx/ehRipple: CSS 动画与涟漪特效，挂载 window.ehFx / window.ehRipple
 * AudioEngine: BGM 引擎，挂载 window.AudioEngine
 */

(function() {
  // ---- EhSfx ----
  const EhSfx=(function(){
    let ctx=null, master=null, enabled=true, lastClickAt=0;
    const VOL=.38;
    function ensure(){
      if(!ctx){
        try{
          try{ if(navigator.audioSession) navigator.audioSession.type='playback'; }catch(e){}
          ctx=new (window.AudioContext||window.webkitAudioContext)();
          master=ctx.createGain(); master.gain.value=VOL;
          const comp=ctx.createDynamicsCompressor();
          comp.threshold.setValueAtTime(-8,ctx.currentTime); comp.knee.setValueAtTime(10,ctx.currentTime);
          comp.ratio.setValueAtTime(4,ctx.currentTime); comp.attack.setValueAtTime(.004,ctx.currentTime); comp.release.setValueAtTime(.12,ctx.currentTime);
          master.connect(comp); comp.connect(ctx.destination);
        }catch(e){ ctx=null; }
      }
      if(ctx && ctx.state!=='running'){ try{ctx.resume();}catch(e){} }
      return ctx;
    }
    function tone(freq,start,dur,type,peak,glideTo){
      if(!ctx||!master) return;
      const t0=ctx.currentTime+start, o=ctx.createOscillator(), g=ctx.createGain();
      o.type=type||'sine'; o.frequency.setValueAtTime(freq,t0);
      if(glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(24,glideTo),t0+dur);
      g.gain.setValueAtTime(.0001,t0);
      g.gain.exponentialRampToValueAtTime(peak||.18,t0+.012);
      g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0+dur+.03);
      o.onended=function(){ try{o.disconnect();g.disconnect();}catch(e){} };
    }
    function noise(start,dur,peak,lpFrom,lpTo){
      if(!ctx||!master) return;
      const t0=ctx.currentTime+start, n=Math.floor(ctx.sampleRate*dur);
      const buf=ctx.createBuffer(1,n,ctx.sampleRate), d=buf.getChannelData(0);
      for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*(1-i/n);
      const src=ctx.createBufferSource(); src.buffer=buf;
      const lp=ctx.createBiquadFilter(); lp.type='lowpass';
      lp.frequency.setValueAtTime(lpFrom||2400,t0);
      if(lpTo) lp.frequency.exponentialRampToValueAtTime(Math.max(80,lpTo),t0+dur);
      const g=ctx.createGain(); g.gain.setValueAtTime(peak||.3,t0); g.gain.exponentialRampToValueAtTime(.0001,t0+dur);
      src.connect(lp); lp.connect(g); g.connect(master); src.start(t0); src.stop(t0+dur+.02);
      src.onended=function(){ try{src.disconnect();lp.disconnect();g.disconnect();}catch(e){} };
    }
    const lib={
      click(){ tone(1180,0,.045,'triangle',.17); tone(1760,.012,.04,'sine',.09); },
      enter(){ tone(392,0,.16,'sine',.18); tone(587,.055,.18,'triangle',.16); tone(784,.12,.22,'sine',.13); },
      send(){ tone(880,0,.075,'triangle',.18); tone(1320,.024,.07,'sine',.10); },
      receive(){ tone(660,0,.07,'sine',.11); tone(990,.032,.06,'triangle',.075); },
      soul(){ tone(523,0,.16,'sine',.13); tone(784,.055,.18,'triangle',.11); tone(1175,.13,.24,'sine',.08); },
      echo(){ tone(1320,0,.05,'sine',.13); tone(880,.028,.08,'triangle',.08,720); },
      mention(){ tone(988,0,.09,'triangle',.18); tone(1480,.07,.12,'sine',.12); },
      void(){ tone(220,0,.22,'sine',.16,130); tone(440,.04,.18,'triangle',.08,300); },
      error(){ tone(360,0,.12,'sine',.16,260); tone(220,.09,.18,'triangle',.13,160); },
      back(){ tone(660,0,.13,'sine',.15,494); tone(392,.06,.17,'triangle',.11,330); },
      punch(){ noise(0,.14,.72,2000,180); tone(150,0,.16,'sine',.5,52); tone(90,.02,.14,'triangle',.34,38); },
      boom(){ noise(0,.36,.82,2800,80); tone(70,0,.46,'sine',.55,30); tone(120,.03,.32,'triangle',.34,42); tone(300,0,.07,'sawtooth',.26,120); },
      whoosh(){ noise(0,.5,.42,600,4600); tone(520,0,.42,'sine',.1,1500); },
      sparkle(){ tone(1568,0,.11,'sine',.22); tone(2093,.06,.13,'triangle',.17); tone(2637,.13,.15,'sine',.15); tone(3136,.2,.17,'triangle',.11); },
      bloom(){ tone(523,0,.22,'sine',.2); tone(784,.07,.24,'sine',.17); tone(1046,.15,.28,'triangle',.13); },
      arrive(){ tone(587,0,.14,'triangle',.24); tone(880,.06,.16,'sine',.2); tone(1175,.14,.2,'triangle',.15); },
      deal(){ noise(0,.05,.34,5200,1400); noise(.06,.05,.3,4800,1200); noise(.12,.05,.28,4400,1000); noise(.18,.06,.24,4000,800); noise(.25,.06,.2,3600,700); },
      cardplay(){ noise(0,.085,.5,4200,600); tone(340,0,.055,'triangle',.13,190); },
      cardsel(){ tone(2400,0,.028,'triangle',.075); },
      pass(){ noise(0,.14,.24,1600,340); tone(420,0,.11,'sine',.06,240); },
      yourturn(){ tone(784,0,.1,'sine',.16); tone(1175,.07,.17,'triangle',.13); },
      landlord(){ tone(392,0,.16,'sawtooth',.2,392); tone(587,.1,.18,'triangle',.18); tone(784,.22,.26,'sine',.16); tone(1046,.34,.3,'triangle',.13); },
      spring(){ tone(659,0,.16,'triangle',.2); tone(880,.1,.18,'sine',.18); tone(1175,.2,.2,'triangle',.16); tone(1568,.3,.24,'sine',.15); tone(2093,.42,.3,'triangle',.13); },
      chip(){ noise(0,.045,.2,5600,1500); tone(2050,0,.035,'triangle',.1); tone(1580,.03,.045,'sine',.085); noise(.05,.04,.14,5000,1300); }
    };
    function unlock(){ ensure(); }
    function play(name){
      if(!enabled) return;
      if(!ensure()) return;
      const fn=lib[name]||lib.click;
      const emit=()=>{ try{fn();}catch(e){} };
      if(ctx.state!=='running'){
        try{ctx.resume();}catch(e){}
        let n=0;(function wait(){ if(ctx.state==='running'||n++>16) emit(); else setTimeout(wait,18); })();
      }else emit();
      try{ if(navigator.vibrate && ['enter','send','echo','mention','void','error','back'].includes(name)) navigator.vibrate(name==='error'?[18,30,18]:8); }catch(e){}
    }
    function playClick(){ const now=performance.now?performance.now():Date.now(); if(now-lastClickAt<80) return; lastClickAt=now; play('click'); }
    let _voice=null, _voiceTried=false, _voicePool=null;
    function pickVoice(){
      try{
        const vs=(window.speechSynthesis&&speechSynthesis.getVoices())||[];
        if(!vs.length) return null;
        return vs.find(v=>/zh[-_]?CN/i.test(v.lang)&&/China|普通话|Tingting|Mandarin|Yaoyao|Kangkang/i.test(v.name))
            || vs.find(v=>/zh[-_]?(CN|Hans)/i.test(v.lang))
            || vs.find(v=>/^zh/i.test(v.lang)) || null;
      }catch(e){ return null; }
    }
    function buildVoicePool(){
      let vs=[]; try{ vs=(window.speechSynthesis&&speechSynthesis.getVoices())||[]; }catch(e){ vs=[]; }
      const zh=vs.filter(v=>/^zh|zh[-_]?(CN|Hans|TW|HK)/i.test(v.lang));
      const all=zh.length?zh:vs;
      const F=/Tingting|Ting-?Ting|Sinji|Meijia|Mei-?Jia|Yaoyao|Yao-?Yao|Huihui|Hui-?Hui|Female|婷婷|美佳|女/i;
      const M=/Kangkang|Kang-?Kang|Yunyang|Yun-?Yang|Liang|Yunye|Male|康康|云扬|男/i;
      return { all, female:all.filter(v=>F.test(v.name)), male:all.filter(v=>M.test(v.name)) };
    }
    const SOUL_VOICE={
      '狼姐':{g:'f',pitch:0.96,rate:1.14}, '老K':{g:'m',pitch:0.80,rate:1.02}, '阿夜':{g:'m',pitch:0.90,rate:1.06},
      '回音':{g:'f',pitch:1.14,rate:1.08}, '图灵':{g:'m',pitch:0.94,rate:1.20}, '小暖':{g:'f',pitch:1.16,rate:1.00},
      '小绵羊':{g:'f',pitch:1.24,rate:1.10}
    };
    function _hash(s){ let h=0; s=String(s||''); for(let i=0;i<s.length;i++) h=(h*31 + s.charCodeAt(i))>>>0; return h; }
    function voiceProfile(who){
      if(!_voicePool) _voicePool=buildVoicePool();
      if(!who) return { voice:_voice, pitch:1.0, rate:1.12 };
      const name=String(who.name||who.key||'').replace(/·[0-9a-f]{4,}$/i,'').trim();
      const sv=who.isSoul ? SOUL_VOICE[name] : null;
      const h=_hash(who.key||who.uid||name||'x');
      const g = sv ? sv.g : ((h&1)?'f':'m');
      const bucket = g==='f' ? _voicePool.female : _voicePool.male;
      const use = (bucket&&bucket.length) ? bucket : (_voicePool.all||[]);
      const voice = use.length ? use[h%use.length] : _voice;
      const pitch = sv ? sv.pitch : (g==='f' ? 1.10 : 0.82) + ((h>>3)%7)*0.03;
      const rate  = sv ? sv.rate  : 1.04 + ((h>>6)%6)*0.035;
      return { voice, pitch, rate };
    }
    let _lastSayText='', _lastSayAt=0;
    function say(text, who){
      if(!enabled||!text) return;
      // 静音闸: 报牌/操作语音(TTS)跟随全局 🎵/🔇 开关(EH_BGM)。此前只查内部 enabled,
      //   导致静音后 BGM 停了、报牌语音仍照念。EH_BGM.on()===false 即静音, 直接不发声。
      try{ if(window.EH_BGM && !window.EH_BGM.on()){ try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} return; } }catch(e){}
      // 丝滑: 极短窗内相同文本重复(如一圈里两三席连续"不出", 或同牌型齐发)只念一次。
      //   否则后一句会 speechSynthesis.cancel() 把前一句拦腰砍断 → 听感是"不出—不"的结巴。
      //   纯时间比较、不排队、不依赖 onend, 绝不会卡死后续语音(某些浏览器 onend 会丢失)。
      const _now=Date.now();
      if(String(text)===_lastSayText && _now-_lastSayAt<900) return;
      _lastSayText=String(text); _lastSayAt=_now;
      try{
        if(!('speechSynthesis' in window)||typeof SpeechSynthesisUtterance==='undefined') return;
        if(!_voiceTried){ _voice=pickVoice(); _voicePool=buildVoicePool(); _voiceTried=true;
          try{ speechSynthesis.onvoiceschanged=()=>{ _voice=pickVoice(); _voicePool=buildVoicePool(); }; }catch(e){} }
        const p=voiceProfile(who);
        const u=new SpeechSynthesisUtterance(String(text));
        u.lang='zh-CN'; u.rate=p.rate||1.12; u.pitch=(p.pitch!=null?p.pitch:1.0); u.volume=.9;
        if(p.voice) u.voice=p.voice;
        try{ speechSynthesis.cancel(); }catch(e){}
        speechSynthesis.speak(u);
      }catch(e){}
    }
    try{
      ['pointerdown','touchstart','keydown'].forEach(ev=>document.addEventListener(ev,unlock,{capture:true,passive:true,once:true}));
      document.addEventListener('visibilitychange',()=>{ if(!document.hidden&&ctx&&ctx.state!=='running') ctx.resume(); },{passive:true});
    }catch(e){}
    return {play,playClick,setEnabled(v){enabled=!!v; if(!enabled){ try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} }},isEnabled(){return enabled},unlock,say};
  })();
  window.EhSfx=EhSfx;

  // ---- ehFx / ehRipple ----
  function ehFx(el, cls, ms){ if(!el) return; try{ el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(()=>el.classList.remove(cls),ms||650); }catch(e){} }
  window.ehFx = ehFx;

  function ehRipple(el, ev){
    try{
      if(!el || el.dataset.noRipple==='1') return;
      const r=el.getBoundingClientRect(); if(!r.width||!r.height) return;
      if(getComputedStyle(el).position==='static') el.style.position='relative';
      if(getComputedStyle(el).overflow==='visible') el.style.overflow='hidden';
      const sp=document.createElement('span'); sp.className='eh-ripple';
      const x=(ev&&ev.clientX?ev.clientX-r.left:r.width/2), y=(ev&&ev.clientY?ev.clientY-r.top:r.height/2);
      const d=Math.max(r.width,r.height)*1.35; sp.style.width=sp.style.height=d+'px'; sp.style.left=x+'px'; sp.style.top=y+'px';
      el.appendChild(sp); setTimeout(()=>sp.remove(),620);
    }catch(e){}
  }
  window.ehRipple = ehRipple;

  // ---- AudioEngine ----
  const AudioEngine=(function(){
    let el=null, cur=null, fadeTimer=null, mode='loop', chainPool=null;
    const VOL_ON=0.55, VOL_DUCK=0.12, FADE_MS=1000;
    function pickNext(pool){
      const list=(pool||[]).filter(c=>c&&c.url);
      if(!list.length) return null;
      if(list.length===1) return list[0];
      let n; do{ n=list[Math.floor(Math.random()*list.length)]; }while(cur&&n.url===cur.url&&list.length>1);
      return n;
    }
    function onEnded(){
      if(mode!=='chain'||!bgmOn()) return;
      const nx=pickNext(chainPool); if(nx) playCfg(nx);
    }
    function ensure(){
      if(!el){
        try{
          el=new Audio(); el.preload='auto'; el.crossOrigin='anonymous';
          el.volume=0;
          el.addEventListener('error',()=>{ if(mode==='chain'){ const nx=pickNext(chainPool); if(nx&&(!cur||nx.url!==cur.url)) setTimeout(()=>{ if(mode==='chain') playCfg(nx); },500); } });
          el.addEventListener('ended',onEnded);
        }catch(e){ el=null; }
      }
      return el;
    }
    function fadeTo(target, ms){
      if(!el) return;
      if(fadeTimer){ clearInterval(fadeTimer); fadeTimer=null; }
      const from=el.volume, to=Math.max(0,Math.min(1,target)), steps=Math.max(1,Math.round(ms/40));
      let n=0;
      fadeTimer=setInterval(()=>{
        n++; const k=n/steps; el.volume=from+(to-from)*k;
        if(n>=steps){ clearInterval(fadeTimer); fadeTimer=null; el.volume=to; if(to===0){ try{el.pause();}catch(_){}} }
      },40);
    }
    function playCfg(cfg){
      if(!cfg||!cfg.url) return;
      ensure(); if(!el) return;
      el.loop=(mode==='loop');
      if(cur && cur.url===cfg.url && !el.paused){ fadeTo(VOL_ON,FADE_MS); cur=cfg; return; }
      cur=cfg;
      try{ el.pause(); }catch(_){}
      el.src=cfg.url;
      el.volume=0;
      const pr=el.play();
      if(pr && pr.catch) pr.catch(()=>{ });
      fadeTo(VOL_ON,FADE_MS);
    }
    return {
      start(cfg){ if(!bgmOn()) return; mode='loop'; chainPool=null; if(el) el.loop=true; playCfg(cfg); },
      chain(pool){ if(!bgmOn()) return; mode='chain'; chainPool=pool||[]; if(el) el.loop=false;
        if(!(el && cur && !el.paused)){ const nx=pickNext(chainPool); if(nx) playCfg(nx); } },
      toChainAfter(pool){ mode='chain'; chainPool=pool||[]; if(el) el.loop=false;
        if(bgmOn() && !(el && cur && !el.paused)){ const nx=pickNext(chainPool); if(nx) playCfg(nx); } },
      stop(){ mode='loop'; chainPool=null; if(!el) { cur=null; return; } fadeTo(0,700); setTimeout(()=>{cur=null;}, 720); },
      resume(){ if(!el||!cur) return; if(el.paused){ try{ const pr=el.play(); if(pr&&pr.catch) pr.catch(()=>{}); }catch(_){} } },
      playing(){ return !!(el && cur && !el.paused); },
      curName(){ return cur?cur.name:null; },
      curUrl(){ return cur?cur.url:null; },
      duck(on){ if(!el||!cur) return; fadeTo(on?VOL_DUCK:VOL_ON, 300); },
    };
  })();
  window.AudioEngine = AudioEngine;
})();
