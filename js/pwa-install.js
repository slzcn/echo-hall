(function(){
  // 版本号常显
  try{ var vl=document.getElementById('lobbyVer'); if(vl) vl.textContent='回声厅 · v'+(window.__EH_BUILD_VER||'?'); }catch(_){}
  var btn = document.getElementById('installBtn');
  if(!btn) return;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  // 【standalone 判据 07-28 02:46】不能只信 display-mode:standalone——小米/MIUI 系实测该 media query 不可靠报 false
  //   （同 L9089 键盘那段踩过的同一个坑）。多重兵判：standalone / fullscreen / minimal-ui 任一命中 + iOS navigator.standalone
  //   + 从桌面图标启动时 document.referrer 常为空或 android-app://。
  function detectStandalone(){
    try{
      if(window.navigator.standalone===true) return true;   // iOS 装成 App
      if(window.matchMedia){
        if(matchMedia('(display-mode:standalone)').matches) return true;
        if(matchMedia('(display-mode:fullscreen)').matches) return true;
        if(matchMedia('(display-mode:minimal-ui)').matches) return true;
      }
      // 安卓从桌面图标启动: TWA/PWA 常带 android-app:// referrer
      if(document.referrer && document.referrer.indexOf('android-app://')===0) return true;
    }catch(_){}
    return false;
  }
  var isStandalone = detectStandalone();
  // 已装(standalone 打开) → 藏安装按钮
  if(isStandalone){ btn.style.display='none'; return; }
  // ★兼容小米系 display-mode 报 false 的情况: 异步用 getInstalledRelatedApps 反查——若系统报告已装本 PWA, 也藏按钮
  try{
    if(navigator.getInstalledRelatedApps){
      navigator.getInstalledRelatedApps().then(function(apps){
        if(apps && apps.length){ try{ btn.style.display='none'; }catch(_){} }
      }).catch(function(){});
    }
  }catch(_){}
  // 统一走 PWA 安装(iOS 分享添加 / 安卓 Chrome 一键装): 无安全警告、独立图标、自动更新。
  // (放弃 apk 方案: 自签名 apk 在 MIUI 等会被安全扫描拦, 体验差; PWA 才是最顺的。)

  var READY='📲 立即安装 App', IDLE='📲 安装到桌面';
  function markReady(){ btn.textContent=READY; btn.classList.add('ready'); }
  // 事件已就绪(head 捕获器早于本脚本接到)→ 立即高亮; 晚到则由回调高亮
  if(window.__ehDeferredPrompt) markReady();
  window.__ehOnInstallReady = markReady;
  window.__ehOnInstalled = function(){ try{ btn.style.display='none'; toast('已添加到桌面 🎉'); }catch(_){} };

  btn.addEventListener('click', function(){
    var dp = window.__ehDeferredPrompt;
    if(dp){   // 标准安装(Chrome/小米新版等): 唤起系统原生安装弹窗
      try{
        Promise.resolve(dp.prompt()).catch(function(){});
        dp.userChoice.then(function(r){
          if(r && r.outcome==='accepted'){ btn.style.display='none'; toast('正在添加到桌面…'); }
          else toast('已取消安装');
        }).catch(function(){ toast('安装未完成，请重试'); }).then(function(){ window.__ehDeferredPrompt=null; });
      }catch(e){ toast('无法调起安装（可能已装过），请查桌面或用菜单添加'); window.__ehDeferredPrompt=null; btn.classList.remove('ready'); btn.textContent=IDLE; }
      return;
    }
    if(isIOS){ try{ toast('点底部「分享」→「添加到主屏幕」即可装成 App'); }catch(_){ alert('分享 → 添加到主屏幕'); } return; }
    // 其它安卓浏览器: 事件未就绪, 走菜单添加
    try{ toast('若无弹窗，请点浏览器菜单 →「添加到主屏幕/安装应用」'); }catch(_){ alert('浏览器菜单 → 添加到主屏幕'); }
  });
})();
