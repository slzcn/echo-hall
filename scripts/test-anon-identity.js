#!/usr/bin/env node
'use strict';
// 验证 ensureAuth 匿名登录分支: 纯临时身份保留名字, 残留正式账号才重掷。
// 直接从 app.js 抽取该分支源码在 vm 里跑真实逻辑, 不复制。
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('js/app.js','utf8');

// 定位匿名登录分支里那段"防冒充"逻辑
const anchor='const hadRegIdentity = !!(me && (me.registered || me.username || me.email));';
const i=src.indexOf(anchor);
if(i<0) throw new Error('找不到防冒充逻辑锚点');
const END="}catch(e){ _ehCatch('ensureAuth',e); }";   // 分支尾: 与生产代码的错误上报 catch 对齐
const end=src.indexOf(END,i);
if(end<0) throw new Error('找不到分支结尾');
const branch=src.slice(i,end+END.length);

function assert(ok,msg){ if(!ok) throw new Error(msg); console.log('✓ '+msg); }

function runBranch(meIn){
  let rolled=false;
  const ctx={
    me:meIn,
    rollIdentity:()=>{ rolled=true; ctx.me={id:ctx.me&&ctx.me.id,name:'随机重掷名',emoji:'🦊',color:'#abc'}; },
    _ehCatch:()=>{},   // 生产分支 catch 里的错误上报, 测试里做空桩
  };
  vm.createContext(ctx);
  vm.runInContext(branch,ctx);
  return {me:ctx.me,rolled};
}

// 1. 纯临时身份: 用户登录前选中随机名"熵增狼" → 匿名登录后应保留
let r=runBranch({id:null,name:'熵增狼',emoji:'🐺',color:'#89f',registered:false});
assert(r.rolled===false,'纯临时身份不重掷随机名');
assert(r.me.name==='熵增狼','纯临时身份保留用户已选中的名字');

// 2. 残留正式账号(registered=true): 应重掷防冒充
r=runBranch({id:null,name:'yiran',emoji:'😀',color:'#f00',registered:true});
assert(r.rolled===true,'残留 registered 正式账号触发重掷');
assert(r.me.name!=='yiran','重掷后不再带正式账号名字');

// 3. 残留 username(无 registered 标记也算正式痕迹): 应重掷
r=runBranch({id:null,name:'yiran',emoji:'😀',color:'#f00',username:'yiran'});
assert(r.rolled===true,'残留 username 同样触发重掷');

// 4. 残留 email: 应重掷
r=runBranch({id:null,name:'somebody',email:'a@b.com'});
assert(r.rolled===true,'残留 email 同样触发重掷');

// 5. 无论哪条, registered/username 标记都被清掉
r=runBranch({id:null,name:'熵增狼',registered:false});
assert(!r.me.registered && !r.me.username,'临时身份分支清空 registered/username 标记');

console.log('\n全部 6 项匿名名字保留行为回归通过');
