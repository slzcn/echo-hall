/**
 * sfx-engine.js — 音效与 CSS 动画钩子 (拆分自 app.js)
 * EhSfx: Web Audio 合成音效，挂载 window.EhSfx
 * ehFx/ehRipple: CSS 动画与涟漪特效，挂载 window.ehFx / window.ehRipple
 * AudioEngine: BGM 引擎，挂载 window.AudioEngine
 */

(function() {
  // ---- EhSfx ----
  const EhSfx=(function(){
    // 音效/语音各自独立静音位(与 BGM 三分开关, 主人诉求"分开静音 BGM/音效/语音"):
    //   enabled = 音效(SFX) 开关, 持久化 localStorage['eh_sfx']; _voiceOn = 报牌/操作语音(TTS) 开关, 'eh_voice'。
    //   此前音效恒开(无 UI)、语音绑死在 BGM 开关上 → 三者无法分控。现在各读各的 flag, 默认全开。
    function _lsBool(k){ try{ const v=localStorage.getItem(k); return v===null?true:v==='1'; }catch(e){ return true; } }
    function _lsSet(k,v){ try{ localStorage.setItem(k, v?'1':'0'); }catch(e){} }
    let ctx=null, master=null, enabled=_lsBool('eh_sfx'), _voiceOn=_lsBool('eh_voice'), lastClickAt=0;
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
    // 每个灵魂一副专属嗓: 音高(pitch)/语速(rate)拉开距离, 让浏览器 TTS 也能听出是不同角色
    //   (系统中文嗓往往只有一把 → 只能靠音高语速塑形。真·录制级灵魂音色需预生成音频片, 属另一档工程)。
    //   拉宽后区间: pitch 0.70~1.34 / rate 0.90~1.30, 各角色按人设定调:
    //   狼姐御姐低缓 · 老K老练低沉慢 · 阿夜冷峻 · 回音空灵偏高 · 图灵机敏快(顺势演"AI感") · 小暖温软慢 · 小绵羊软萌高快
    const SOUL_VOICE={
      '狼姐':{g:'f',pitch:0.88,rate:1.04}, '老K':{g:'m',pitch:0.70,rate:0.94}, '阿夜':{g:'m',pitch:0.84,rate:1.02},
      '回音':{g:'f',pitch:1.22,rate:1.02}, '图灵':{g:'m',pitch:1.02,rate:1.30}, '小暖':{g:'f',pitch:1.12,rate:0.92},
      '小绵羊':{g:'f',pitch:1.34,rate:1.18}
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
      if(!text) return;
      // 静音闸: 报牌/操作语音(TTS)走【独立语音开关】_voiceOn(不再绑 SFX 的 enabled, 也不再绑 BGM)。
      //   三分开关后: 关音效不影响语音, 关语音不影响音效/BGM。语音关 → 直接静默并清掉在念的队列。
      if(!_voiceOn){ try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} return; }
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
    return {play,playClick,
      setEnabled(v){enabled=!!v; _lsSet('eh_sfx',enabled);},                                  // 音效开关(持久化)
      isEnabled(){return enabled},
      setVoice(v){_voiceOn=!!v; _lsSet('eh_voice',_voiceOn); if(!_voiceOn){ try{ if(window.speechSynthesis) speechSynthesis.cancel(); }catch(e){} }},   // 语音开关(持久化)
      isVoiceOn(){return _voiceOn},
      unlock,say};
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

  // ---- EhAudioPrefs: 三分音频开关的统一读写口(BGM/音效/语音) ----
  // BGM 仍走既有 EH_BGM(app.js 里定义, 本文件先加载故惰性取 window.EH_BGM); 音效/语音走 EhSfx 的独立位。
  window.EhAudioPrefs = {
    bgm(){ try{ return !window.EH_BGM || window.EH_BGM.on(); }catch(e){ return true; } },
    setBgm(v){ try{ if(window.EH_BGM) window.EH_BGM.set(!!v); }catch(e){} },
    sfx(){ try{ return window.EhSfx ? window.EhSfx.isEnabled() : true; }catch(e){ return true; } },
    setSfx(v){ try{ if(window.EhSfx) window.EhSfx.setEnabled(!!v); }catch(e){} },
    voice(){ try{ return window.EhSfx ? window.EhSfx.isVoiceOn() : true; }catch(e){ return true; } },
    setVoice(v){ try{ if(window.EhSfx) window.EhSfx.setVoice(!!v); }catch(e){} },
    // 任一开着即认"有声"(用于牌桌 🎵/🔇 图标: 全关才显 🔇)
    anyOn(){ return this.bgm()||this.sfx()||this.voice(); },
  };

  // ---- EhAudioMenu: 牌桌 🎵 钮点开的三档静音小面板(BGM/音效/语音各一个开关) ----
  // 主人诉求"分开静音 BGM/音效/语音"。三游戏顶栏 🎵 钮统一改成点开此面板, 而非单纯切 BGM。
  // 纯内联样式 + 主题变量, 不依赖 game CSS; 锚定在钮下方, 点面板外/滚动/切游戏即关。
  window.EhAudioMenu = (function(){
    let panel=null, onDoc=null, curAnchor=null;
    function close(){
      if(!panel) return;
      try{ document.removeEventListener('pointerdown', onDoc, true); }catch(e){}
      try{ panel.remove(); }catch(e){}
      panel=null; onDoc=null; curAnchor=null;
    }
    function row(label, get, set, repaint){
      const P=window.EhAudioPrefs;
      const r=document.createElement('button');
      r.type='button';
      r.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;'
        +'padding:9px 12px;border:none;background:transparent;color:var(--ink,#eaf6ff);'
        +'font:600 13px/1.2 inherit;cursor:pointer;border-radius:10px;-webkit-tap-highlight-color:transparent;';
      const nm=document.createElement('span'); nm.textContent=label; r.appendChild(nm);
      const sw=document.createElement('span');
      const paint=()=>{ const on=get();
        sw.textContent=on?'开':'关';
        sw.style.cssText='min-width:44px;text-align:center;padding:3px 0;border-radius:999px;font:800 11px/1 inherit;'
          +'transition:all .16s;'+(on
            ? 'background:var(--accent,#00e5d4);color:#04121a;box-shadow:0 0 10px rgba(0,229,212,.45);'
            : 'background:rgba(255,255,255,.10);color:var(--sub,#86cbc6);');
      };
      paint();
      r.appendChild(sw);
      r.addEventListener('click',(e)=>{ e.stopPropagation(); set(!get()); paint(); if(repaint) repaint();
        try{ if(window.EhSfx) window.EhSfx.play('click'); }catch(_){} });
      return r;
    }
    function open(anchor, repaint){
      close();
      const P=window.EhAudioPrefs;
      panel=document.createElement('div');
      panel.className='eh-audio-menu';
      panel.style.cssText='position:fixed;z-index:99999;min-width:186px;padding:6px;'
        +'background:linear-gradient(180deg,rgba(12,20,32,.97),rgba(8,14,24,.97));'
        +'border:1px solid var(--line2,rgba(0,229,212,.38));border-radius:14px;'
        +'box-shadow:0 14px 34px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset;'
        +'backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);'
        +'font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei","Segoe UI",sans-serif;';
      const hd=document.createElement('div');
      hd.textContent='声音';
      hd.style.cssText='padding:5px 12px 6px;font:800 11px/1 inherit;letter-spacing:.12em;color:var(--sub,#86cbc6);';
      panel.appendChild(hd);
      panel.appendChild(row('🎵 背景音乐', ()=>P.bgm(),  v=>P.setBgm(v),  repaint));
      panel.appendChild(row('🔔 音效',     ()=>P.sfx(),  v=>P.setSfx(v),  repaint));
      panel.appendChild(row('🗣️ 语音',     ()=>P.voice(),v=>P.setVoice(v),repaint));
      document.body.appendChild(panel);
      // 锚定: 钮正下方右对齐; 越界则贴边
      const ar=anchor.getBoundingClientRect(), pr=panel.getBoundingClientRect();
      let left=Math.min(ar.right-pr.width, window.innerWidth-pr.width-8);
      left=Math.max(8,left);
      let top=ar.bottom+8;
      if(top+pr.height>window.innerHeight-8) top=Math.max(8, ar.top-pr.height-8);
      panel.style.left=left+'px'; panel.style.top=top+'px';
      curAnchor=anchor;
      onDoc=(e)=>{ if(panel && !panel.contains(e.target) && e.target!==anchor && !anchor.contains(e.target)) close(); };
      setTimeout(()=>{ try{ document.addEventListener('pointerdown', onDoc, true); }catch(e){} },0);
    }
    // 点钮: 开则关, 关则开(toggle 面板显隐)
    function toggle(anchor, repaint){ if(panel && curAnchor===anchor){ close(); } else { open(anchor, repaint); } }
    return { open, toggle, close };
  })();
})();
