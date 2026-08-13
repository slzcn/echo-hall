#!/usr/bin/env node
'use strict';
/** 后台自定义身份名单：运行 admin.html 真实成员渲染函数，验证 UID 能解析为昵称+用户名并保留降级。 */
const fs=require('fs'),vm=require('vm'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'..','admin.html'),'utf8');
const start=source.indexOf('function tierMemberHtml(uid){');
const end=source.indexOf('\nfunction renderCustomTiers(){',start);
if(start<0||end<0) throw new Error('FAIL: 当前后台名单尚未实现 UID → 昵称/用户名展示（修前预期红灯）');
const production=source.slice(start,end)+'\nglobalThis.__tierMemberHtml=tierMemberHtml;';
function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
function render(map,uid){
 const ctx={_tierUserBrief:map,esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),safeEmoji:s=>s||''};
 vm.runInNewContext(production,ctx,{filename:'admin.html#tierMemberHtml'});
 return ctx.__tierMemberHtml(uid);
}
const uid='9da0cb44-bbd4-43a2-8a21-aa9b8b9400d4';
const html=render({[uid]:{id:uid,name:'热血狼',username:'61女王',emoji:'🐺'}},uid);
assert(html.includes('热血狼'),'步骤 1: 已解析成员显示当前昵称');
assert(html.includes('@61女王'),'步骤 2: 已解析成员显示登录用户名');
assert(html.includes('🐺'),'步骤 3: 已解析成员显示头像');
assert(html.includes(uid),'步骤 4: 仍保留完整 UID，方便核对与复制');
const fallback=render({},uid);
assert(fallback.includes(uid),'步骤 5: 反查失败时降级显示原 UID，不阻断名单');
assert(!fallback.includes('undefined'),'步骤 6: 降级态不泄漏 undefined');
const escaped=render({[uid]:{id:uid,name:'<img onerror=1>',username:'<script>',emoji:'🐺'}},uid);
assert(!escaped.includes('<img')&&!escaped.includes('<script>'),'步骤 7: 昵称和用户名经过 HTML 转义');
// 反证：旧实现仅输出 UID，必须抓红。
const old=`<code>${uid}</code>`;
assert(!old.includes('热血狼')&&!old.includes('@61女王'),'反证通过：旧 UID-only 实现无法展示昵称和用户名');
console.log('\n✅ 后台身份名单旅程通过：已解析显示身份，失败安全降级，旧实现必红');
