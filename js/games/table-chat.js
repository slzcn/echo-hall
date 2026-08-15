'use strict';
/**
 * table-chat.js — 牌桌内嵌「聊天坞 + 弹幕层」(F2 边打边聊)
 *
 * 为什么存在: 牌桌原本把聊天室整个盖死, 你在跟灵魂打牌却没法跟它/房间说一句话 ——
 * 对一个以 AI 灵魂居民为魂的聊天室是最大浪费。本模块给牌桌镶一条可收起的聊天坞
 * (最近几条 + mini 输入框) + 房间消息以弹幕横掠绒面, 全程复用现有 realtime/发送
 * 通道(不新增传输): 发出去的就是正常房间消息, 会同步进聊天室 #stream, 别人也收得到。
 *
 * 与牌桌 UI 解耦: 只吃一个 roomEl + 一个 send 回调, 自注样式、用独立 tchat- 类名,
 * 不依赖 ddz/gd 前缀。斗地主/掼蛋两桌都 mount 它。app.js 把每条房间消息喂给 onRoomMsg。
 *
 * API:
 *   const dock = EHTableChat.mount(roomEl, {
 *     send(text) -> Promise,          // 发一条房间消息(app.js 注入, 走 eh_messages)
 *     me: { uid, name, emoji, color },// 判定"这条是不是我发的"
 *   });
 *   dock.onRoomMsg(m);   // m: {user_id,name,emoji,color,text,kind,is_bot} —— 房间来消息时喂进来
 *   dock.destroy();      // 关桌时清理
 */
(function(root){
  var STYLE_ID = 'eh-tchat-style';
  var CSS = ''
    // 弹幕层: 铺在绒面上半"死区"(只显示上家最后一手), 不吃点击, 不挡手牌/按钮
    + '.tchat-dm{position:absolute;left:0;right:0;top:48px;height:34%;overflow:hidden;pointer-events:none;z-index:14}'
    + '.tchat-bullet{position:absolute;right:-4px;white-space:nowrap;font-size:12.5px;line-height:1.5;padding:3px 10px;'
    +   'border-radius:14px;background:rgba(8,16,24,.62);border:1px solid var(--line,rgba(0,229,212,.24));'
    +   'color:var(--ink,#eaf6ff);backdrop-filter:blur(3px);will-change:transform;box-shadow:0 2px 8px rgba(0,0,0,.3)}'
    + '.tchat-bullet .bn{color:var(--sub,#86cbc6);margin-right:6px}'
    + '.tchat-bullet.soul{border-color:var(--magenta,#ff2d8e);background:rgba(40,10,28,.6)}'
    + '.tchat-bullet.soul .bn{color:var(--magenta,#ff2d8e)}'
    + '.tchat-bullet.me{border-color:var(--accent,#00e5d4);background:rgba(6,34,32,.6)}'
    + '@keyframes tchatFly{from{transform:translateX(0)}to{transform:translateX(calc(-100vw - 100%))}}'
    // 聊天坞: 左沿可收起。收起=一个 💬 圆钮(带未读角标); 展开=左侧半透明小面板
    + '.tchat{position:absolute;left:8px;top:50%;transform:translateY(-50%);z-index:16;display:flex;flex-direction:column;'
    +   'align-items:flex-start;gap:6px;max-width:78%}'
    + '.tchat-toggle{width:42px;height:42px;border-radius:50%;border:1px solid var(--line2,rgba(0,229,212,.4));'
    +   'background:rgba(8,16,24,.7);color:var(--ink,#eaf6ff);font-size:19px;cursor:pointer;position:relative;flex:none;'
    +   'box-shadow:0 2px 10px rgba(0,0,0,.4);backdrop-filter:blur(4px)}'
    + '.tchat-toggle:active{transform:scale(.92)}'
    + '.tchat-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;'
    +   'background:var(--magenta,#ff2d8e);color:#fff;font-size:10px;line-height:16px;text-align:center;display:none}'
    + '.tchat-badge.on{display:block}'
    + '.tchat-panel{display:none;flex-direction:column;width:min(76vw,300px);height:min(46vh,240px);'
    +   'background:rgba(8,14,22,.86);border:1px solid var(--line,rgba(0,229,212,.24));border-radius:14px;overflow:hidden;'
    +   'backdrop-filter:blur(8px);box-shadow:0 8px 28px rgba(0,0,0,.5)}'
    + '.tchat[data-open="1"] .tchat-panel{display:flex}'
    + '.tchat-list{flex:1;overflow-y:auto;padding:8px 10px;display:flex;flex-direction:column;gap:6px;'
    +   'scrollbar-width:none;-ms-overflow-style:none}'
    + '.tchat-list::-webkit-scrollbar{display:none}'
    + '.tchat-hint{color:var(--dim,#498d88);font-size:11.5px;line-height:1.5;text-align:center;padding:10px 4px}'
    + '.tchat-row{font-size:12.5px;line-height:1.45;word-break:break-word}'
    + '.tchat-row .rn{font-weight:600;margin-right:5px}'
    + '.tchat-row.me{text-align:right}'
    + '.tchat-row.me .rn{color:var(--accent,#00e5d4)}'
    + '.tchat-row.soul .rn{color:var(--magenta,#ff2d8e)}'
    + '.tchat-inputbar{display:flex;gap:6px;padding:7px 8px;border-top:1px solid var(--line,rgba(0,229,212,.18));flex:none}'
    + '.tchat-in{flex:1;min-width:0;background:rgba(0,0,0,.3);border:1px solid var(--line,rgba(0,229,212,.24));'
    +   'border-radius:10px;color:var(--ink,#eaf6ff);font-size:13px;padding:7px 10px;outline:none}'
    + '.tchat-in:focus{border-color:var(--accent,#00e5d4)}'
    + '.tchat-send{flex:none;border:none;border-radius:10px;background:var(--accent,#00e5d4);color:#04201d;'
    +   'font-size:13px;font-weight:600;padding:0 12px;cursor:pointer}'
    + '.tchat-send:active{opacity:.8}';

  function ensureStyle(doc){
    if(doc.getElementById(STYLE_ID)) return;
    var s = doc.createElement('style'); s.id = STYLE_ID; s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function mount(roomEl, opts){
    opts = opts || {};
    var doc = roomEl.ownerDocument || document;
    ensureStyle(doc);
    var send = typeof opts.send === 'function' ? opts.send : function(){ return Promise.resolve(); };
    var me = opts.me || {};

    // 弹幕层
    var dm = doc.createElement('div'); dm.className = 'tchat-dm';
    // 聊天坞
    var wrap = doc.createElement('div'); wrap.className = 'tchat'; wrap.setAttribute('data-open','0');
    wrap.innerHTML =
      '<button class="tchat-toggle" aria-label="牌桌聊天">💬<span class="tchat-badge"></span></button>'
      + '<div class="tchat-panel">'
      +   '<div class="tchat-list"><div class="tchat-hint">在牌桌里也能和大家聊天，说的话会同步到聊天室</div></div>'
      +   '<form class="tchat-inputbar"><input class="tchat-in" maxlength="200" placeholder="对牌桌说点什么…" '
      +     'autocomplete="off" enterkeyhint="send"><button type="submit" class="tchat-send">发送</button></form>'
      + '</div>';
    roomEl.appendChild(dm);
    roomEl.appendChild(wrap);

    var toggle = wrap.querySelector('.tchat-toggle');
    var badge  = wrap.querySelector('.tchat-badge');
    var panel  = wrap.querySelector('.tchat-panel');
    var list   = wrap.querySelector('.tchat-list');
    var form   = wrap.querySelector('.tchat-inputbar');
    var input  = wrap.querySelector('.tchat-in');
    var hint   = list.querySelector('.tchat-hint');

    var unread = 0, open = false, destroyed = false;
    var MAX_ROWS = 40;
    var _pendingSelf = [];   // 最近自发文本: 乐观上屏后 realtime 回声命中则跳过, 防重复

    function setBadge(){
      if(unread > 0){ badge.textContent = unread > 99 ? '99+' : String(unread); badge.classList.add('on'); }
      else badge.classList.remove('on');
    }
    function setOpen(v){
      open = !!v; wrap.setAttribute('data-open', open ? '1' : '0');
      if(open){ unread = 0; setBadge(); list.scrollTop = list.scrollHeight;
        try{ input.focus(); }catch(_){} }
    }
    toggle.addEventListener('click', function(){ setOpen(!open); });

    function esc(s){ return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

    // 往列表加一行(mine=我发的, soul=灵魂)
    function addRow(name, emoji, text, mine, soul){
      if(hint && hint.parentNode){ hint.remove(); hint = null; }
      var atBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) < 24;
      var row = doc.createElement('div');
      row.className = 'tchat-row' + (mine ? ' me' : '') + (soul ? ' soul' : '');
      row.innerHTML = '<span class="rn">' + esc((emoji || '') + (mine ? '我' : (name || '')))
        + '</span>' + esc(text);
      list.appendChild(row);
      while(list.children.length > MAX_ROWS) list.removeChild(list.firstChild);
      if(atBottom || mine) list.scrollTop = list.scrollHeight;
    }

    // 弹幕: 从右往左掠过绒面(牌桌可见时才飞; 折叠/隐藏时只进列表)
    function fly(name, emoji, text, mine, soul){
      if(destroyed) return;
      // 房间被折叠(display:none)时 offsetParent 为 null, 不飞(省算力, 展开后列表里仍在)
      if(!roomEl.offsetParent) return;
      var b = doc.createElement('div');
      b.className = 'tchat-bullet' + (soul ? ' soul' : (mine ? ' me' : ''));
      b.innerHTML = '<span class="bn">' + esc((emoji || '') + (mine ? '我' : (name || ''))) + '</span>' + esc(text);
      // 随机分布到弹幕层不同高度, 避免叠一起
      var lanes = 4;
      var lane = Math.floor((list.children.length + dm.children.length) % lanes);
      b.style.top = (6 + lane * 24) + 'px';
      var dur = Math.min(9, Math.max(5, 4 + text.length * 0.14));
      b.style.animation = 'tchatFly ' + dur.toFixed(1) + 's linear forwards';
      dm.appendChild(b);
      b.addEventListener('animationend', function(){ b.remove(); });
      // 兜底清理(动画事件万一没触发)
      setTimeout(function(){ if(b.parentNode) b.remove(); }, dur * 1000 + 800);
    }

    // 收到房间消息(app.js 转发)。只认聊天类 msg/act, 其余(proj/enter/interact...)不进牌桌
    function onRoomMsg(m){
      if(destroyed || !m) return;
      if(m.kind !== 'msg' && m.kind !== 'act') return;
      var text = String(m.text || '').trim();
      if(!text) return;
      var mine = !!(me.uid && m.user_id === me.uid);
      // 我从坞里发的已乐观上屏, realtime 又把这条回声推回来 → 命中待去重集则忽略, 防重复
      if(mine){
        var idx = _pendingSelf.indexOf(text);
        if(idx >= 0){ _pendingSelf.splice(idx, 1); return; }
      }
      var soul = !!m.is_bot;
      addRow(m.name, m.emoji, text, mine, soul);
      // 弹幕只飞别人的(自己说的自己知道, 不飞); 收起态记未读
      if(!mine){ fly(m.name, m.emoji, text, false, soul); if(!open){ unread++; setBadge(); } }
    }

    // mini 输入: 提交=发一条房间消息 + 乐观进列表(realtime 回声会被上面去重跳过)
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var text = (input.value || '').trim();
      if(!text) return;
      input.value = '';
      addRow(me.name, me.emoji, text, true, false);
      _pendingSelf.push(text); if(_pendingSelf.length > 8) _pendingSelf.shift();
      try{ Promise.resolve(send(text)).catch(function(){}); }catch(_){}
    });

    return {
      onRoomMsg: function(m){ return onRoomMsg(m); },
      open: function(){ setOpen(true); },
      isOpen: function(){ return open; },
      destroy: function(){ destroyed = true; try{ wrap.remove(); }catch(_){} try{ dm.remove(); }catch(_){} },
    };
  }

  root.EHTableChat = { mount: mount };
})(typeof window !== 'undefined' ? window : globalThis);
