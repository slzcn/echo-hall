'use strict';
// 安卓折叠屏键盘避让 V62 策略旅程（真机四组数据推翻「38→39」系数微调后重写）。
//   真机结论：展开PWA私信✅、聊天室竖屏❌横屏✅；折叠浏览器私信❌聊天室❌。
//   根因不是系数偏小，是聊天室走「baseFullH − 估算」双变量减法、私信 _baseH 被地址栏波动污染。
//   本旅程锁住新策略的代码事实 + 数值反证（旧「已缩仍减」实现必红）。
const fs = require('fs');
const path = require('path');
const keyboard = fs.readFileSync(path.join(__dirname, '..', 'js', 'keyboard.js'), 'utf8');
const dm = fs.readFileSync(path.join(__dirname, '..', 'js', 'dm.js'), 'utf8');
function assert(ok, msg) {
  if (!ok) throw new Error('FAIL: ' + msg);
  console.log('✓ ' + msg);
}

// ── 代码事实：聊天室 visibleHeight 只在 vis 未缩（接近 full）时才减 VK/估算 ──
assert(/vkH > 0 && vis >= full - 4/.test(keyboard), '聊天室：VK 只在两信号未缩(真覆盖式)时才从全高减');
assert(/estimatedKbH > 0 && vis >= full - 4/.test(keyboard), '聊天室：估算只在两信号未缩时才生效，杜绝双减');
assert(/min\(vis, full - vkH\)/.test(keyboard) && /min\(vis, full - estimatedKbH\)/.test(keyboard), '聊天室：减法目标是全高分母 full，不是当前已缩 vis');

// ── 代码事实：私信 _baseH 稳定 300ms 才落地，防地址栏波动污染 ──
assert(/_baseStableAt/.test(dm) && /_baseStableH/.test(dm), '私信：引入无键盘态稳定基线时间戳/候选高');
assert(/Date\.now\(\)-_baseStableAt>=300/.test(dm), '私信：候选全高需稳定≥300ms 才落地为 _baseH');
assert(/cur>_baseH && Date\.now\(\)-_baseStableAt>=300/.test(dm), '私信：只在稳定的更大全高上抬升，不被地址栏收展中间态污染');

// ── 数值反证：模拟聊天室两平台已缩场景（resizes-content），旧「无条件减」双减、新策略不减 ──
function visNew(innerH, vvH, baseFullH, vkH, estKbH) {
  let vis = innerH;
  if (vvH) vis = Math.min(vis, vvH);
  const full = Math.max(baseFullH || 0, innerH, vvH || 0);
  if (vkH > 0 && vis >= full - 4) vis = Math.min(vis, full - vkH);
  if (estKbH > 0 && vis >= full - 4) vis = Math.min(vis, full - estKbH);
  return Math.max(1, Math.round(vis));
}
function visOld(innerH, vvH, baseFullH, vkH, estKbH) {
  let vis = innerH;
  if (vvH) vis = Math.min(vis, vvH);
  const full = Math.max(baseFullH || 0, innerH, vvH || 0);
  if (vkH > 0) vis = Math.min(vis, full - vkH);              // 旧：无条件减
  if (estKbH > 0) vis = Math.min(vis, full - estKbH);        // 旧：无条件减
  return Math.max(1, Math.round(vis));
}
// 场景：折叠/竖屏 resizes-content 设备，键盘弹起 innerH 已缩到 408（真可视高），baseFullH 仍是落键盘时 718，
//   但同时有一次陈旧 estKbH=280（39%×718）残留 → 旧实现 min(408, 718-280=438)=408 看似对，
//   但当 baseFullH 被地址栏污染成 800 时：旧 min(408, 800-280=520)=408……换更毒的场景：
//   innerH 已缩 408、vv 未同步(仍 718)、estKbH=280、baseFullH=718 →
//   旧 vis=min(408,718)=408，再 min(408, 718-280=438)=408（不炸）；
//   真正双减发生在 vv 也缩：innerH=408 vv=409 est=280 baseFullH=718 →
//   旧 vis=408，再 min(408, 438)=408……说明减法在“vis<full”时其实常被 min 挡住。
//   最毒是「vis 已缩得比 full-est 还大一点」：innerH=470 vv=470 est=280 baseFullH=719 →
//   旧 min(470, 719-280=439)=439（把已缩到 470 的真可视高又硬砍到 439，少了 31px → composer 上浮/留白）；
//   新 470>=719-4? 否 → 不减 → 470（正确用真可视高）。
const vNew = visNew(470, 470, 719, 0, 280);
const vOld = visOld(470, 470, 719, 0, 280);
assert(vNew === 470, '新策略：vis 已缩(470)则直接用真可视高，不再减估算');
assert(vOld === 439, '反证：旧无条件减把已缩真值 470 硬砍到 439（少 31px，正是竖屏/折叠错位来源）');
assert(vNew > vOld, '反证成立：旧实现在“vis 已缩”场景比新策略少给可视高，可区分单变量');

// 真覆盖式 IME（两信号都没缩）时，新策略仍要减，保证不被键盘盖 ──
const covNew = visNew(719, 719, 719, 0, 280);
assert(covNew === 439, '真覆盖式(两信号未缩)：新策略仍从全高减估算=439，露出输入框');

// ── 测试钩子仍只在 kbdebug 开放 ──
assert(/URLSearchParams\(location\.search\)\.has\('kbdebug'\)/.test(dm), '私信测试钩子只在 kbdebug 诊断页开放');
assert(/__ehDmKbDebug=\{/.test(dm) && /bind:bindChatViewport/.test(dm), 'CDP 可调用私信真实键盘绑定链路');

console.log('\n✅ V62 键盘避让策略旅程通过：已缩用真值免双减、真覆盖式仍减、私信基线防污染；旧无条件减实现必红。');
