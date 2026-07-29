(function(){
  if(!/[?&]debug=1(&|$)/.test(location.search)) return;
  const box=document.createElement('div');
  box.style.cssText='position:fixed;right:6px;top:6px;width:260px;max-height:60vh;overflow:auto;background:rgba(0,0,0,.9);color:#0f0;font:11px/1.35 monospace;padding:8px 10px;z-index:99999;border:1px solid #0f0;border-radius:6px;pointer-events:none;white-space:pre-wrap;word-break:break-all';
  box.id='__ehdbg';
  document.body.appendChild(box);
  const H=(...a)=>{
    const l=document.createElement('div');
    l.textContent='['+new Date().toISOString().slice(11,19)+'] '+a.join(' ');
    box.appendChild(l);
    while(box.children.length>60) box.removeChild(box.firstChild);
    box.scrollTop=box.scrollHeight;
  };
  window.__ehdbg=H;
  H('debug on, ua=', navigator.userAgent.slice(0,50));
  // 抓 song-play click
  document.addEventListener('click', function(e){
    const b=e.target.closest && e.target.closest('.song-play');
    if(!b) return;
    const card=b.closest('.song-card');
    H('CLICK song-play sid=', card&&card.dataset.sid, 'lyric=', String(card&&card.dataset.lyric||'').slice(0,20));
    try{ const c=(window.ac&&ac()); H('ctx.state=', c && c.state); }catch(_){}
  }, true);
  // hook playSong
  const wait=setInterval(()=>{
    if(typeof playSong==='function' && !playSong.__hooked){
      const o=playSong;
      window.playSong=async function(...a){ H('playSong called sid=',a[1]); try{ return await o.apply(this,a); }catch(e){ H('playSong THREW',e.message); throw e; } };
      window.playSong.__hooked=true;
      clearInterval(wait);
      H('hooked');
    }
  },200);
  // 每 2s 报状态
  setInterval(()=>{
    try{
      const cs=window.curSong;
      const c=(window.ac&&ac());
      H('tick state=', c&&c.state, 'curSong=', !!cs, 'cover=', cs&&cs._cover, 'oscs=', cs&&cs.oscs&&cs.oscs.length);
    }catch(_){}
  },2000);
})();
