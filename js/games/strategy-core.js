// 三层牌局策略协调器：本地合法引擎 > 公开信息估计 > 可选异步教练。
// 安全边界：只接收本方手牌与公开牌面/出牌计数；不接收 deck、seed、日志原文或他人手牌。
(function(root){ if(root.EHStrategy) return;
  'use strict';
  var VERSION=3, DEFAULT_TTL=12000, MAX_PENDING=64, MAX_CACHE=256, WINDOW=60000, MAX_REQ=6;
  var ENDPOINT='https://cddkniwbhvcbfgkgomtl.supabase.co/functions/v1/eh-game-strategy';
  var cache=new Map(), coachCache=new Map(), pending=new Map(), generations=new Map(), backoff=new Map(), requests=[];
  var lastRequest=-Infinity;
  var RISK=['low','medium','high'], PRI=['finish_self','protect_partner','block_opponent','preserve_control','calculate'];
  var PRESS=['avoid_giving_lead','take_control','let_partner_lead','play_for_equity','preserve_bombs'];
  var FALLBACK={risk_level:'medium',priority:'calculate',pressure:'preserve_bombs',target_seat:null,confidence:0,expires_after:'next_turn',ttl_ms:DEFAULT_TTL,source:'local'};
  function num(v,d){return v==null||v===''||!Number.isFinite(Number(v))?d:Number(v);}
  function clamp(v,a,b){return Math.max(a,Math.min(b,num(v,a)));}
  function card(c){return {rank:num(c&&c.rank,0),suit:typeof(c&&c.suit)==='string'?c.suit.slice(0,3):'',joker:!!(c&&c.joker)};}
  function policy(raw){raw=raw&&typeof raw==='object'?raw:{}; var p=Object.assign({},FALLBACK);
    if(RISK.indexOf(raw.risk_level)>=0)p.risk_level=raw.risk_level;if(PRI.indexOf(raw.priority)>=0)p.priority=raw.priority;if(PRESS.indexOf(raw.pressure)>=0)p.pressure=raw.pressure;
    p.target_seat=Number.isInteger(raw.target_seat)?raw.target_seat:null;p.confidence=clamp(raw.confidence,0,1);p.expires_after=typeof raw.expires_after==='string'?raw.expires_after.slice(0,24):p.expires_after;p.ttl_ms=clamp(raw.ttl_ms,1000,60000);p.source=raw.source==='coach'?'coach':'local';return p; }
  function validCoach(raw){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))return false;
    var allowed={risk_level:1,priority:1,pressure:1,target_seat:1,confidence:1,expires_after:1,ttl_ms:1};
    for(var k in raw)if(!Object.prototype.hasOwnProperty.call(allowed,k))return false;
    if(RISK.indexOf(raw.risk_level)<0||PRI.indexOf(raw.priority)<0||PRESS.indexOf(raw.pressure)<0)return false;
    if(raw.target_seat!==null&&!Number.isInteger(raw.target_seat)||!Number.isFinite(raw.confidence)||raw.confidence<0||raw.confidence>1||raw.expires_after!=='next_turn'||!Number.isFinite(raw.ttl_ms)||raw.ttl_ms<1000||raw.ttl_ms>60000)return false;
    return true;
  }
  function counts(kind,x){
    var raw=x&&x.publicCounts, played=[];
    if(raw&&typeof raw==='object'&&raw.played!=null)raw=raw.played;
    for(var i=0;i<18;i++)played[i]=Math.floor(clamp(raw&&raw[i],0,(i>=16?1:4)*(kind==='guandan'?2:1)));
    var total=kind==='guandan'?108:(kind==='ddz'?54:52);
    var known=(Array.isArray(x&&x.hand)?Math.min(54,x.hand.length):0)+(Array.isArray(x&&x.board)?Math.min(5,x.board.length):0);
    return {played:played,known:known,unseen:Math.max(0,total-known-played.reduce(function(a,b){return a+b;},0)),total:total};
  }
  function estimate(kind,x){var left=Array.isArray(x&&x.handsLeft)?x.handsLeft.map(function(v){return Math.max(0,Math.floor(num(v,0)));}):[];var seat=Number.isInteger(x&&x.seat)?x.seat:-1,me=seat>=0?left[seat]:null;var team=function(i){return kind==='ddz'?(i===seat||(x&&Number.isInteger(x.landlord)&&((seat===x.landlord)===(i===x.landlord)))):(i>=0&&seat>=0&&i%2===seat%2);};var opp=left.filter(function(v,i){return v>0&&!team(i);}),mate=left.filter(function(v,i){return v>0&&i!==seat&&team(i);});var c=counts(kind,x),danger=opp.length?Math.min.apply(Math,opp):null;var winChance=me==null?.5:(me<=3?.78:me<=6?.58:.42);if(danger!=null)winChance-=danger<=2?.22:danger<=4?.08:0;if(mate.some(function(v){return v<=2;}))winChance+=.06;return {hands_left:left,self_left:me,opponent_min:danger,partner_min:mate.length?Math.min.apply(Math,mate):null,opponents:opp.length,partners:mate.length,public_counts:c,finish_probability:clamp(winChance,0,1)};}
  function safePublic(kind,x){x=x&&typeof x==='object'?x:{};var e=estimate(kind,x);return {kind:kind,version:VERSION,seat:Number.isInteger(x.seat)?x.seat:null,hand:Array.isArray(x.hand)?x.hand.slice(0,54).map(card):[],hands_left:e.hands_left,public_counts:e.public_counts,landlord:Number.isInteger(x.landlord)?x.landlord:null,last_seat:Number.isInteger(x.lastSeat)?x.lastSeat:null,table:x.tableParse?{type:String(x.tableParse.type||'').slice(0,24),key:num(x.tableParse.key,0),len:num(x.tableParse.len,0)}:null,level:Number.isFinite(x.level)?x.level:null,board:Array.isArray(x.board)?x.board.slice(0,5).map(card):[],opponents:Number.isFinite(x.opponents)?Math.max(0,Math.min(8,Math.floor(x.opponents))):null,pot:Number.isFinite(x.pot)?Math.max(0,Math.min(100000000,x.pot)):null,current_bet:Number.isFinite(x.currentBet)?Math.max(0,Math.min(100000000,x.currentBet)):null,to_call:Number.isFinite(x.toCall)?Math.max(0,Math.min(100000000,x.toCall)):null,street:typeof x.street==='string'?x.street.slice(0,20):null,phase:typeof x.phase==='string'?x.phase.slice(0,20):null};}
  function match(x){return String(x&&x.matchId!=null?x.matchId:x&&x.gameId!=null?x.gameId:'default');}
  function hand(x){return String(x&&x.handId!=null?x.handId:'default');}
  function coachKey(kind,x){return JSON.stringify([kind,match(x),hand(x),x&&x.seat]);}
  function key(kind,x){return coachKey(kind,x)+':'+JSON.stringify([safePublic(kind,x),x&&x.equity]);}
  // 每桌只保留当前一手的generation；对象身份避免clear后同名新局发生ABA。
  function activate(x){
    var id=match(x), h=hand(x), g=generations.get(id);
    if(g&&g.hand===h)return g;
    clear(id);g={hand:h};generations.set(id,g);
    while(generations.size>MAX_CACHE)clear(generations.keys().next().value);
    return g;
  }
  function local(kind,x){var e=estimate(kind,x),p=Object.assign({},FALLBACK);if(kind==='poker'){var eq=num(x&&x.equity,.5);p.pressure=eq>=.62?'take_control':eq<.35?'avoid_giving_lead':'play_for_equity';p.risk_level=eq>=.62?'high':eq<.35?'low':'medium';p.confidence=.35;return policy(p);}if(e.opponent_min!=null&&e.opponent_min<=2){p.priority='block_opponent';p.pressure='take_control';p.risk_level='high';p.confidence=.7;}else if(e.self_left!=null&&e.self_left<=3){p.priority='finish_self';p.pressure='take_control';p.risk_level='high';p.confidence=.65;}else if(e.partner_min!=null&&e.partner_min<=2){p.priority='protect_partner';p.pressure='let_partner_lead';p.confidence=.55;}else if(x&&x.tableParse)p.priority='preserve_control';return policy(p);}
  function trim(map,max){while(map.size>max)map.delete(map.keys().next().value);}
  function get(kind,x){
    x=x||{};activate(x);
    var k=key(kind,x),now=Date.now(),co=coachCache.get(coachKey(kind,x));
    if(co&&co.until>now)return co.value;
    var h=cache.get(k);if(h&&h.until>now)return h.value;
    var p=local(kind,x);cache.set(k,{value:p,until:now+p.ttl_ms,matchId:match(x)});trim(cache,MAX_CACHE);return p;
  }
  function request(kind,x,opts){
    opts=opts||{};x=x||{};
    var endpoint=typeof opts.endpoint==='string'?opts.endpoint:(root.__EH_STRATEGY_ENDPOINT||'');
    var base=get(kind,x),id=match(x),ck=coachKey(kind,x),k=key(kind,x),now=Date.now();
    // JWT绝不能交给可重定向/任意自定义URL；不透传调用方headers。
    if(endpoint!==ENDPOINT||typeof opts.token!=='string'||!opts.token)return Promise.resolve(base);
    var co=coachCache.get(ck);if(co&&co.until>now)return Promise.resolve(co.value);
    if(pending.has(ck))return pending.get(ck).job;
    var fail=backoff.get(ck);if(fail&&fail.until>now)return Promise.resolve(base);
    requests=requests.filter(function(t){return now-t<WINDOW;});
    if(requests.length>=MAX_REQ||now-lastRequest<11000||pending.size>=MAX_PENDING)return Promise.resolve(base);
    requests.push(now);lastRequest=now;
    var gen=generations.get(id),ctl=new AbortController(), entry={matchId:id,ctl:ctl,job:null}, timer;
    var live=function(){return generations.get(id)===gen&&pending.get(ck)===entry&&!ctl.signal.aborted;};
    var stop=new Promise(function(_,reject){
      ctl.signal.addEventListener('abort',function(){reject(Error('strategy aborted'));},{once:true});
      timer=setTimeout(function(){ctl.abort();},Math.max(300,Math.min(12000,num(opts.timeout,10000))));
    });
    var input=safePublic(kind,x),seatMax=kind==='ddz'?2:kind==='guandan'?3:8;
    pending.set(ck,entry);
    var work=Promise.resolve().then(function(){
      if(!live())throw Error('strategy obsolete');
      return fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+opts.token},body:JSON.stringify({game:kind,input:input}),signal:ctl.signal,redirect:'error'});
    }).then(function(r){if(!r.ok||r.redirected)throw Error('strategy response');return r.json();});
    entry.job=Promise.race([work,stop]).then(function(d){
      if(!live())return base;
      if(!d||typeof d!=='object'||Object.keys(d).some(function(k){return k!=='policy'&&k!=='source'&&k!=='error';})||d.source!=='coach'||d.error!=null||!validCoach(d.policy))throw Error('strategy invalid');
      var raw=d.policy;
      if(raw.target_seat!==null&&(raw.target_seat<0||raw.target_seat>seatMax)||raw.confidence<Math.max(.55,num(opts.minConfidence,.55)))throw Error('strategy confidence');
      var p=policy(Object.assign({},raw,{source:'coach'})),record={value:p,until:Date.now()+p.ttl_ms,matchId:id};
      coachCache.set(ck,record);cache.set(k,record);backoff.delete(ck);trim(coachCache,MAX_CACHE);trim(cache,MAX_CACHE);return p;
    }).catch(function(){
      // 失败不调用get：离桌abort后不能复活旧局缓存。
      if(generations.get(id)===gen&&pending.get(ck)===entry){
        var n=Math.min(5,(fail&&fail.n||0)+1);
        backoff.set(ck,{matchId:id,n:n,until:Date.now()+Math.min(60000,11000*Math.pow(2,n-1))});trim(backoff,MAX_CACHE);
      }
      return base;
    }).finally(function(){clearTimeout(timer);if(pending.get(ck)===entry)pending.delete(ck);});
    return entry.job;
  }
  function advise(kind,x,opts){var p=get(kind,x||{});request(kind,x||{},opts);return p;}
  function score(kind,candidate,x,strat){var p=strat||get(kind,x||{}),s=0;if(!candidate)return 0;var n=Array.isArray(candidate.cards)?candidate.cards.length:0;if(p.priority==='finish_self'&&n>0)s+=n*8;if(p.priority==='block_opponent'&&candidate.parse&&candidate.parse.key)s+=candidate.parse.key*.15;if(p.pressure==='take_control'&&candidate.parse&&candidate.parse.key)s+=candidate.parse.key*.08;if(p.pressure==='preserve_bombs'&&candidate.isBomb)s-=18;if(p.pressure==='let_partner_lead'&&candidate.isBomb)s-=40;return s;}
  function clear(matchId){
    var all=matchId==null,id=String(matchId);
    // 删除generation先于abort，所有旧Promise的catch/then都失去写权限。
    if(all)generations.clear();else generations.delete(id);
    pending.forEach(function(e,k){if(all||e.matchId===id){pending.delete(k);e.ctl.abort();}});
    [cache,coachCache,backoff].forEach(function(m){m.forEach(function(e,k){if(all||e.matchId===id)m.delete(k);});});
    // 离桌/换局不能重置用户全局请求配额。
  }
  root.EHStrategy={VERSION:VERSION,ENDPOINT:ENDPOINT,policy:policy,estimate:estimate,publicInput:safePublic,local:local,get:get,request:request,advise:advise,score:score,setEndpoint:function(v){root.__EH_STRATEGY_ENDPOINT=typeof v==='string'?v:'';},clear:clear};
})(typeof window!=='undefined'?window:globalThis);
if(typeof module!=='undefined'&&module.exports)module.exports=globalThis.EHStrategy;
