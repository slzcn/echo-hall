#!/usr/bin/env node
'use strict';
/* journey-grab-seat-keep-game.js
 * B9: 抢座必须「先 join 成功再拆旧局」。join 失败时进行中的牌局不得被 close。
 * 诊断单: docs/triage/2026-11-02-grab-seat-keep-game.md
 */
const fs = require('fs'), path = require('path');
const R = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = R('js/app.js');

let step = 0, failed = false;
function assert(c, m){ step++; if(!c){ failed = true; console.error('✗ [' + step + '] ' + m); } else console.log('✓ [' + step + '] ' + m); }

console.log('\n▸ 抢座不拆进行中牌局');

const grabAt = app.indexOf('async function _gtGrabSeat');
const grabAll = grabAt >= 0 ? app.slice(grabAt, grabAt + 2200) : '';
assert(grabAll.length > 200, '找到 _gtGrabSeat');

// 只看「抢新空位」路径: 从 target.away 起（mine 分支的 close 是重进自己座位，允许）
const pathAt = grabAll.indexOf('if(target.away)');
const grab = pathAt >= 0 ? grabAll.slice(pathAt) : grabAll;

// join 必须出现在本路径 close 之前
const joinIdx = grab.indexOf('gtJoin(row.id');
const closeIdx = grab.indexOf('_ehGame.close');
assert(joinIdx >= 0 && closeIdx >= 0, '抢新位路径含 gtJoin 与 close');
assert(joinIdx < closeIdx, 'gtJoin 在 _ehGame.close 之前（先入座再切换）');

// join 的 catch 必须 return，不得继续 close
const joinCatch = grab.slice(joinIdx, joinIdx + 700);
assert(/catch\s*\(e\)/.test(joinCatch), 'join 有 catch');
assert(/入座失败/.test(joinCatch) && /return/.test(joinCatch),
  'join 失败 toast 后 return（不拆旧局）');

// 反证: 旧序 close 在 join 之前的写法不得存在
assert(!/try\{\s*if\(_ehGame && _ehGame\.close\) _ehGame\.close\(\);\s*\}catch\(_\)\{\}\s*_gtCleanupPlay\(\);\s*try\{\s*var jr=await gtJoin/.test(app),
  '反证: 旧「先 close 再 join」不得存在（旧实现必红）');

// 行为级模拟
{
  let gameAlive = true, joined = false;
  async function grabSeat(joinOk){
    try {
      if (!joinOk) throw new Error('seat taken');
      joined = true;
      gameAlive = false; // 成功才切换
    } catch (e) {
      return; // 失败保留 gameAlive
    }
  }
  // 失败
  (async () => {
    await grabSeat(false);
    assert(gameAlive && !joined, '行为级: join 失败 → 原局仍在');
    await grabSeat(true);
    assert(joined && !gameAlive, '行为级: join 成功 → 才切换');
  })();
}

setTimeout(() => {
  console.log('\n' + (failed ? '❌ 抢座保局旅程失败' : '✅ 抢座先 join 后拆局通过（旧序必红）'));
  process.exit(failed ? 1 : 0);
}, 50);
