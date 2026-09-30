#!/usr/bin/env node
'use strict';
/**
 * journey-member-upsert.js — 公开房重复进房的成员写入幂等旅程
 *
 * 反证目标：旧版裸 insert 在第二次进入同一房间时会产生 409；
 * 当前实现必须始终走带复合冲突键的 ignore-duplicates upsert。
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');

function assert(ok, msg) {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('✓ ' + msg);
}

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  if (start < 0) throw new Error(`无法定位 ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`无法抽取 ${name} 完整函数`);
}

const fnSrc = extractFunction(src, 'joinAsMember');

function makeContext() {
  const calls = [];
  const builder = {
    select(){ calls.push({method:'select'}); return this; },
    eq(){ return this; },
    maybeSingle(){ calls.push({method:'maybeSingle'}); return Promise.resolve({data:{role:'member'},error:null}); },
    insert(row){ calls.push({method:'insert',row}); return Promise.resolve({error:{message:'duplicate key',status:409}}); },
    upsert(row, options){ calls.push({method:'upsert',row,options}); return Promise.resolve({error:null}); },
  };
  const ctx = {
    console,
    calls,
    sb:{from(table){ calls.push({method:'from',table}); return builder; }},
    withTimeout(p){ return p; },
    myUid:'user-1',
    me:{name:'旅人',emoji:'🙂',color:'#8B5CFF'},
    clearLastRoom(){}, setConn(){}, toast(){}, goScene(){}, renderLobby(){},
    curRoom:null, msgChan:null, presChan:null, _tailPollTimer:null,
    clearInterval(){},
  };
  vm.createContext(ctx);
  vm.runInContext(fnSrc, ctx);
  return ctx;
}

(async () => {
  const room = {id:'room-1', kind:'official'};
  const ctx = makeContext();

  assert(await ctx.joinAsMember(room) === true, '首次进入官方房成功');
  assert(await ctx.joinAsMember(room) === true, '重复进入同一官方房仍成功');
  const writes = ctx.calls.filter(x => x.method === 'upsert' || x.method === 'insert');
  assert(writes.length === 2 && writes.every(x => x.method === 'upsert'), '两次成员写入都使用 upsert，不产生裸 insert');
  assert(writes.every(x => x.options?.onConflict === 'room_id,user_id'), 'upsert 使用数据库真实复合唯一键 room_id,user_id');
  assert(writes.every(x => x.options?.ignoreDuplicates === true), '重复成员采用 ignoreDuplicates 幂等忽略');

  const privateCtx = makeContext();
  assert(await privateCtx.joinAsMember({id:'private-1',kind:'private'}) === true, '私密房已有成员资格校验通过');
  assert(!privateCtx.calls.some(x => x.method === 'upsert' || x.method === 'insert'), '私密房路径保持只读校验，不绕过邀请码写成员表');

  const oldSrc = fnSrc.replace(
    /\.upsert\(\{([\s\S]*?)\},\s*\{\s*onConflict:'room_id,user_id',\s*ignoreDuplicates:true\s*\}\)/,
    '.insert({$1})'
  );
  assert(oldSrc !== fnSrc, '反证准备：已构造旧版裸 insert 实现');
  const mutantCtx = makeContext();
  vm.runInContext(oldSrc.replace('async function joinAsMember(', 'async function oldJoinAsMember('), mutantCtx);
  await mutantCtx.oldJoinAsMember(room);
  await mutantCtx.oldJoinAsMember(room);
  const mutantWrites = mutantCtx.calls.filter(x => x.method === 'upsert' || x.method === 'insert');
  assert(mutantWrites.slice(-2).every(x => x.method === 'insert'), '反证通过：旧实现重复进入会走裸 insert，并暴露 409 冲突路径');

  console.log('\n✅ 公开房重复进房成员幂等旅程通过；旧错误实现必红、当前实现必绿');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
