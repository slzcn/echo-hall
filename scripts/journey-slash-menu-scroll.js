#!/usr/bin/env node
'use strict';
/**
 * journey-slash-menu-scroll.js — /命令 与 @提及 菜单"点选 vs 滑动分离"完整旅程
 *
 * 主人反馈(手机): /命令菜单"选择很不稳定、不支持上下滑动选择、而且遮挡"。
 * 三个根因 → 三条不可回退的旅程断言:
 *   ① 不稳定/滑不动: 旧实现 onpointerdown→preventDefault→立即 pick, 手指一落即选中, 无法滑动浏览。
 *      新: pointerdown 记起点(仍 preventDefault 保键盘), move 超阈值判"滑动"手动滚+置 moved,
 *          up 仅在 moved=false 才 pick。→ 滑动浏览绝不误选, 微抖动仍算点选。
 *   ② 遮挡: 菜单 position:absolute 往上长, #hall overflow:hidden 会裁掉超出部分。
 *      新: max-height 封顶 + overflow-y:auto, 溢出可滚不被裁。
 *   ③ @提及菜单同款毛病 → 同一个 bindMenuTap 一并治。
 *
 * 反 anti-pattern「只测功能点不测旅程」: 既做源级契约锁(防改回旧的一落即选 / 砍掉滚动封顶),
 * 又用纯函数复刻 bindMenuTap 状态机跑真实手势序列(点选/滑动/微抖/滑回), 锁死"滑动不误选"。
 */
const fs = require('fs');
const path = require('path');

function assert(ok, msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

const APP = fs.readFileSync(path.join(__dirname, '..', 'js', 'app.js'), 'utf8');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ── 源级契约: 共享 bindMenuTap, 两菜单都接入, 旧"一落即选"已铲除 ──
assert(/function bindMenuTap\(menu,\s*itemSel,\s*onPick\)/.test(APP), '存在共享 bindMenuTap(点选/滑动分离)');
assert(/bindMenuTap\(menu,\s*'\.slash-item'/.test(APP), 'renderSlashMenu 接入 bindMenuTap');
assert(/bindMenuTap\(menu,\s*'\.at-item'/.test(APP), 'renderAtMenu 接入 bindMenuTap');
// 反证: 旧的 onpointerdown 里直接 pick 的写法必须消失(否则又变回一落即选、滑不动)
assert(!/onpointerdown=ev=>\{\s*ev\.preventDefault\(\);\s*pickSlash/.test(APP), '旧 slash 一落即选写法已移除');
assert(!/onpointerdown=ev=>\{\s*ev\.preventDefault\(\);\s*pickAt/.test(APP), '旧 @提及 一落即选写法已移除');
// 关键点: pointerdown 仍 preventDefault(保键盘不收) + move 手动滚 + up 判 moved
assert(/pointerdown[\s\S]{0,120}ev\.preventDefault\(\)/.test(APP), 'pointerdown 仍 preventDefault(iOS 键盘不收)');
assert(/menu\.onpointermove=/.test(APP) && /menu\.scrollTop-=dy/.test(APP), 'move 阶段手动驱动 scrollTop(原生滚动已被挡)');
assert(/if\(i>=0 && !m\) onPick\(i\)/.test(APP), 'up 阶段仅 moved=false 才触发 pick(滑动不误选)');
assert(/setPointerCapture/.test(APP), '用 setPointerCapture 兜住滑出项外的 move/up');

// ── 源级契约: CSS 防遮挡(封顶+可滚)+ 关掉原生滚动交给手动 ──
for (const sel of ['.slash-menu', '.at-menu']){
  const block = HTML.split(sel+'{')[1] || '';
  const css = block.split('}')[0];
  assert(/max-height:min\(46vh/.test(css), `${sel} 有 max-height 封顶(防被 #hall 裁掉=遮挡)`);
  assert(/overflow-y:auto/.test(css), `${sel} overflow-y:auto(溢出可滚)`);
  assert(/touch-action:none/.test(css), `${sel} touch-action:none(原生滚动关掉, 交给手动, 不双倍滚)`);
}
assert(/\.slash-item\{[^}]*min-height:44px/.test(HTML), 'slash-item 触控目标≥44px');
assert(/\.at-item\{[^}]*min-height:44px/.test(HTML), 'at-item 触控目标≥44px');

// ── 行为复刻: 纯函数重跑 bindMenuTap 状态机(与 app.js 逻辑同构), 跑真实手势序列 ──
// 与生产同构的极简模型: 只保留 downI/sy/lastY/moved + scrollTop, TAP_SLOP=8。
function makeTap(){
  const S = { downI:-1, sy:0, lastY:0, moved:false, scrollTop:0, picked:null, SLOP:8 };
  return {
    state: S,
    down(i, y){ S.downI=i; S.moved=false; S.sy=S.lastY=y; },
    move(y){
      if(S.downI<0) return;
      const dy=y-S.lastY; S.lastY=y;
      if(Math.abs(y-S.sy)>S.SLOP){ S.moved=true; S.scrollTop-=dy; }
    },
    up(){
      const i=S.downI, m=S.moved; S.downI=-1; S.moved=false;
      if(i>=0 && !m) S.picked=i;
    },
  };
}

// 场景1: 原地点选(纯 tap)→ 选中
{ const t=makeTap(); t.down(2,100); t.up();
  assert(t.state.picked===2, '原地点选(无位移)→ 选中该项'); }

// 场景2: 明显滑动(手指上移浏览下方项)→ 不选中 + 列表向下滚
{ const t=makeTap(); t.down(2,100); t.move(80); t.move(60); t.up();
  assert(t.state.picked===null, '滑动浏览→ 不误选');
  assert(t.state.scrollTop===40, '滑动手动滚 scrollTop(20+20=40, 指上移列表下滚)'); }

// 场景3: 微抖动(位移<阈值)→ 仍算点选(不能因手抖丢掉选中)
{ const t=makeTap(); t.down(1,100); t.move(104); t.move(97); t.up();
  assert(t.state.picked===1, '阈值内微抖动仍算点选(手抖不丢选)');
  assert(t.state.scrollTop===0, '微抖动不触发滚动'); }

// 场景4(核心反证): 先滑出阈值再滑回起点 → moved 粘住, 松手不误选
//   这是"滑动不稳定/误选"的真正陷阱: 手势末尾恰好回到起点附近, 绝不能被当成点选。
{ const t=makeTap(); t.down(0,100); t.move(120); t.move(100); t.up();
  assert(t.state.picked===null, '滑出后滑回起点仍不选(moved 粘住, 反"滑动误选")'); }

// 场景5: 没 down 直接 move(异常序列)→ 不崩、不滚、不选
{ const t=makeTap(); t.move(80); t.up();
  assert(t.state.picked===null && t.state.scrollTop===0, '无 down 的游离 move 被忽略(不崩不误选)'); }

console.log('\n✅ /命令 与 @提及 菜单点选/滑动分离旅程全部通过');
