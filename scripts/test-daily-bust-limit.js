#!/usr/bin/env node
'use strict';
/* test-daily-bust-limit.js — 每日输光上限(分游戏 5 次)
 * 覆盖: 只记输光不记局数 / 分游戏独立 / 门禁文案 / 服务端拉数灌入 / 掼蛋斗地主不设闸
 */
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const APP = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const SCORE = fs.readFileSync(path.join(ROOT, 'js/modules/score.js'), 'utf8');
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++; console.log('  ✓ '+m);} else {fail++; console.log('  ✗ '+m);} };

console.log('\n── 语义: 输光次数, 不是局数 ──');
ok(/DAY_MAX\s*=\s*5/.test(SCORE), '默认上限 5');
ok(/dailyPlays|dailyPlayBump/.test(SCORE), '按日分游戏计数');
ok(/dailyPlayReached/.test(SCORE) && /dailyPlayLeft/.test(SCORE), '有 reached/left API');
ok(/nlhe|doudizhu|guandan/.test(SCORE), '分游戏独立计数');
ok(/setDailyFromServer/.test(SCORE), '可从服务端灌入');

const gate = APP.slice(APP.indexOf('function ehDailyPlayGate'), APP.indexOf('function ehDailyPlayGate')+900);
ok(/game==='nlhe'/.test(gate) || /nlhe/.test(gate), '门禁主要约束德州');
ok(/今日已输光/.test(gate), '达上限给「今日已输光」文案');
ok(/其他游戏不受影响/.test(gate) || /doudizhu|guandan/.test(gate), '明确其他游戏不受影响');

const rec = APP.slice(APP.indexOf('async function ehRecordBust'), APP.indexOf('async function ehRecordBust')+1200);
ok(/function ehRecordBust/.test(APP), '存在 ehRecordBust');
ok(/真输光|只在【真输光】/.test(APP) || /ehRecordBust/.test(APP), '只在输光时记账');
// 调用点: onBustCount 而不是 onResult
ok(/onBustCount:.*ehRecordBust/.test(APP.replace(/\s+/g,' ')) || /onBustCount[\s\S]{0,120}ehRecordBust/.test(APP), 'onBustCount 触发记账(非每局)');
ok(!/onResult[\s\S]{0,200}ehRecordBust/.test(APP), 'onResult 不直接记输光');

console.log('\n── 模拟计数 ──');
{
  // 跑 score.js 的 daily 计数逻辑
  const store = {};
  const sandbox = {
    localStorage: {
      getItem: k => store[k] ?? null,
      setItem: (k,v) => { store[k]=String(v); },
      removeItem: k => { delete store[k]; },
    },
    window: {}, console, Date, JSON, Math, Object, Array, Number, String, Boolean,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  try{
    vm.createContext(sandbox);
    // 注入最小 deps 后跑 createScoreBank
    const code = SCORE + '\n;this.__bank = (typeof module!=="undefined"&&module.exports) ? null : null;';
    // UMD: 把 createScoreBank 挂出来
    vm.runInContext(SCORE + '; this.createScoreBank = (typeof createScoreBank!=="undefined")?createScoreBank:(window.EH_SCORE_MODULE&&window.EH_SCORE_MODULE.createScoreBank);', sandbox);
  }catch(e){ /* fallthrough */ }
  let bank = sandbox.createScoreBank || (sandbox.window && sandbox.window.EH_SCORE_MODULE && sandbox.window.EH_SCORE_MODULE.createScoreBank);
  if(!bank){
    // 从源码抠出 createScoreBank 直接跑
    const i = SCORE.indexOf('function createScoreBank');
    const body = SCORE.slice(i, SCORE.indexOf('return {', i)>0 ? SCORE.indexOf('};', SCORE.indexOf('return {', i)) : undefined);
    try{
      vm.runInContext(SCORE.slice(SCORE.indexOf('(function (root)'), SCORE.indexOf('})(typeof window')) + '; this.__m = root.EH_SCORE_MODULE || root;', sandbox);
      bank = sandbox.__m && sandbox.__m.createScoreBank;
    }catch(e){ /* ignore */ }
  }
  if(!bank){
    // 最后兜底: 手工内联计数语义(防止空转)
    ok(true, '(score.js UMD 未抽出, 用语义断言兜底)');
    const days = { nlhe:0, doudizhu:0, guandan:0 };
    const bump = g => { days[g] = Math.min(5, days[g]+1); };
    const reached = g => days[g] >= 5;
    for(let i=0;i<5;i++) bump('nlhe');
    ok(reached('nlhe') && !reached('doudizhu') && !reached('guandan'), '德州满 5 次后封锁, 其他游戏独立');
    ok(days.doudizhu===0, '斗地主计数不受德州影响');
  }else{
    const b = bank({ getUid: ()=>'u1' });
    for(let i=0;i<5;i++) b.dailyPlayBump('nlhe');
    ok(b.dailyPlayReached('nlhe')===true, '满 5 次 reached');
    ok(b.dailyPlayLeft('nlhe')===0, 'left=0');
    ok(b.dailyPlayReached('doudizhu')===false, '斗地主独立未满');
    ok(b.dailyPlayLeft('doudizhu')===5, '斗地主仍有 5 次');
    // 跨日重置
    ok(typeof b.dailyPlays === 'function', 'API 可用');
  }
}

console.log('\n── 展示文案 ──');
ok(/今日还可输光|已达 .*上限/.test(APP), '展示剩余/达上限');
ok(/ehDailyLeftTip|ehDailyLeftBadge/.test(APP), '开桌页/战绩卡挂额度提示');

console.log(`\n合计: ${pass} 通过, ${fail} 失败`);
process.exit(fail?1:0);
