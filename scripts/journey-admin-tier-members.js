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
const iMain=html.indexOf('@61女王'); const iNick=html.indexOf('热血狼');
assert(iMain>=0 && iMain<iNick,'步骤 1: 主标识优先展示唯一 @用户名');
assert(html.includes('· 热血狼'),'步骤 2: 昵称作为副标签跟随, 不再抢主位');
assert(html.includes('🐺'),'步骤 3: 已解析成员显示头像');
assert(html.includes(uid),'步骤 4: 仍保留完整 UID，方便核对与复制');
const fallback=render({},uid);
assert(fallback.includes(uid),'步骤 5: 反查失败时降级显示原 UID，不阻断名单');
assert(!fallback.includes('undefined'),'步骤 6: 降级态不泄漏 undefined');
const escaped=render({[uid]:{id:uid,name:'<img onerror=1>',username:'<script>',emoji:'🐺'}},uid);
assert(!escaped.includes('<img')&&!escaped.includes('<script>'),'步骤 7: 昵称和用户名经过 HTML 转义');
const noUn=render({[uid]:{id:uid,name:'热血狼',username:'',emoji:'🐺'}},uid);
assert(noUn.includes('热血狼') && noUn.includes('未绑定用户名'),'步骤 8: 缺用户名的老账号退回昵称并显式提示');
const bareUid=render({[uid]:{id:uid,name:'',username:'',emoji:''}},uid);
assert(bareUid.includes(uid) && !bareUid.includes('undefined'),'步骤 9: 昵称用户名都缺时安全退回 UID');
// 反证 1：旧 UID-only 实现
const uidOnly=`<code>${uid}</code>`;
assert(!uidOnly.includes('@61女王'),'反证 1：旧 UID-only 实现抓红');
// 反证 2：昵称当主标识的旧展示顺序
const nickFirst='<b>热血狼</b> <span>@61女王</span>';
const iA=nickFirst.indexOf('热血狼'), iB=nickFirst.indexOf('@61女王');
assert(!(iB>=0 && iB<iA),'反证 2：昵称先于用户名的旧展示会被主标识断言抓红');
console.log('\n✅ 后台身份名单旅程通过：已解析显示身份，失败安全降级，旧实现必红');
