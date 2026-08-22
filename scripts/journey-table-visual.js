#!/usr/bin/env node
'use strict';
/**
 * journey-table-visual.js — 三桌视觉一致性 + 融合升级验证
 *
 * 覆盖 2026-08-17 20260816-exp2 视觉升级：
 *   A. 卡牌不能落回 'Arial Narrow'（Windows/安卓无字体，回退丑）
 *   B. 卡牌背面不能是 45° 斜条纹（旧生硬风）
 *   C. 三款桌面（.ddz-felt / .gd-felt / .pk-felt）都要有绿绒毡径向渐变
 *   D. 顶栏 title 要 chip 化（背景 + border 非零）
 *   E. table-shared.css 在 index.html 里挂上
 *   F. .gd-tag 字号 ≥10.5px（不再 9px 眯眼级）
 *
 * 静态断言优先，能不启动浏览器就不启（CI 更快）；有 Chrome 时才做真机复验补一层。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const R = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

let step = 0, failed = false;
function assert(ok, msg){ step++; if(!ok){ failed = true; console.error(`✗ [${step}] ${msg}`); } else console.log(`✓ [${step}] ${msg}`); }

// ── 静态断言 ────────────────────────────────────────────────
const HTML   = R('index.html');
const SHARED = R('js/games/table-shared.css');
const DDZ    = R('js/games/game-ui.js');
const GD     = R('js/games/guandan-ui.js');
const PK     = R('js/games/poker-ui.js');

assert(/js\/games\/table-shared\.css\?v=20260821-table-lobby/.test(HTML),
  'index.html 挂了 table-shared.css?v=20260821-table-lobby');

// 横竖屏切换(功能3): index 挂了 table-orient.js, 三桌顶栏都有 ⟳ 钮且接了 EHTableOrient.toggle
assert(/js\/games\/table-orient\.js\?v=20260822-landscape-polish/.test(HTML),
  'index.html 挂了 table-orient.js?v=20260822-landscape-polish');
for(const [name, src, rid] of [['game-ui', DDZ, 'ddzRot'], ['guandan-ui', GD, 'gdRot'], ['poker-ui', PK, 'pkRot']]){
  assert(new RegExp('id="'+rid+'"').test(src) && /EHTableOrient\.toggle/.test(src),
    `${name}.js 顶栏有横竖屏钮 ${rid} 且接了 EHTableOrient.toggle`);
  assert(/EHTableOrient\.clear\(room\)/.test(src),
    `${name}.js 在 close/minimize 里 EHTableOrient.clear(room) 复位`);
}
assert(/\.ddz-rot,\s*\.gd-rot,\s*\.pk-rot\{/.test(SHARED), 'table-shared.css 定义了三桌横竖屏钮 .ddz-rot/.gd-rot/.pk-rot');
assert(/\.ddz-room\.eh-rot,\s*\.gd-room\.eh-rot,\s*\.pk-room\.eh-rot\{/.test(SHARED), 'table-shared.css 定义了 .eh-rot 旋转态定位/裁剪');

// A. 三款 UI 不能再出现 'Arial Narrow'（连回退都不允许，字体链已换成 SF Pro Rounded）
for(const [name, src] of [['game-ui', DDZ], ['guandan-ui', GD], ['poker-ui', PK]]){
  assert(!/Arial Narrow/.test(src), `${name}.js 里彻底移除了 'Arial Narrow' 字体`);
}

// B. 三款卡牌背面已经不是 repeating-linear-gradient
for(const [name, src] of [['game-ui', DDZ], ['guandan-ui', GD], ['poker-ui', PK]]){
  assert(!/card\.back\{background:repeating-linear-gradient/.test(src),
    `${name}.js 卡牌背面已废弃 45° 斜条纹`);
  assert(/card\.back\{background:radial-gradient/.test(src),
    `${name}.js 卡牌背面改成 radial-gradient 暗玻璃 + 微光`);
}

// C. 共享皮肤层核心块必须齐
assert(/\.ddz-felt.*\.gd-felt.*\.pk-felt[\s\S]{0,140}radial-gradient/.test(SHARED),
  'table-shared.css 给三款 felt 加了统一的桌面绒毡径向渐变');
assert(/\.ddz-title[\s\S]{0,80}\.gd-title[\s\S]{0,80}\.pk-title[\s\S]{0,400}border-radius:\s*999px/.test(SHARED),
  'table-shared.css 把三款 title 做成 999px chip');
assert(/\.gd-room \.gd-tag\{[^}]*font-size:\s*10\.5px/.test(SHARED),
  'table-shared.css 把掼蛋 gd-tag 字号提到 10.5px（原 9px 太小）');
assert(/\.ddz-room \.tchat-toggle[\s\S]{0,20}\.gd-room  \.tchat-toggle[\s\S]{0,20}\.pk-room  \.tchat-toggle/.test(SHARED),
  'table-shared.css 三桌 tchat-toggle 升级毛玻璃 + accent 呼应');
assert(/\.ddz-hand-wrap[\s\S]{0,40}\.gd-hand-wrap[\s\S]{0,240}rgba\(0,\s*0,\s*0,\s*\.28\)/.test(SHARED),
  'table-shared.css 手牌区补了底部渐隐托盘感');

// C2. 三桌顶栏必须吃 iOS 状态栏安全区(env(safe-area-inset-top)) —— 治真机顶栏与系统时钟/电量撞车
//     (反回退: 曾因游戏浮层只补 inset-bottom, 顶栏滑到刘海下与 23:00🛏/信号/电量叠成一团)
assert(/\.pk-bar\{[^}]*env\(safe-area-inset-top/.test(PK), '德州顶栏 pk-bar 补了 safe-area-inset-top');
assert(/\.gd-bar\{[^}]*env\(safe-area-inset-top/.test(GD), '掼蛋顶栏 gd-bar 补了 safe-area-inset-top');
assert(/\.ddz-bar\{[^}]*env\(safe-area-inset-top/.test(DDZ), '斗地主顶栏 ddz-bar 补了 safe-area-inset-top');

// C3. 德州结算不再是浮在纯黑上的裸文字, 收进带边框的面板卡(.pk-over-card)
assert(/\.pk-over-card\{/.test(PK), 'poker-ui 定义结算面板卡 .pk-over-card(治浮空/死黑)');
assert(/class="pk-over-card"/.test(PK), 'showOver 把结算内容包进 .pk-over-card');
assert(/\.pk-over \.pk-showbox\{[^}]*border-top/.test(PK), '结算摊牌区上方有分隔线(pk-showbox border-top)');

// C4. 牌桌浮层展开时隐藏聊天悬浮件(@提醒/回底/神曲球别漂在绒面上); 折叠回聊天(room 内联 display:none)时复原
assert(/#hall:has\(\.pk-room:not\(\[style\*="display: none"\]\)\)[\s\S]{0,400}\.song-jump\{display:none/.test(HTML),
  'index.html 用 :has() 在牌桌展开时隐藏 to-latest/mention-jump/song-jump');
// C5. 三桌顶栏都有牌桌内背景音乐开关按钮(大厅 🎵 被浮层盖住, 打牌时也要能开关 BGM)
assert(/id="pkMus"/.test(PK) && /\.pk-mus\{/.test(PK), '德州顶栏有 BGM 开关 pkMus');
assert(/id="gdMus"/.test(GD) && /\.gd-mus\{/.test(GD), '掼蛋顶栏有 BGM 开关 gdMus');
assert(/id="ddzMus"/.test(DDZ) && /\.ddz-mus\{/.test(DDZ), '斗地主顶栏有 BGM 开关 ddzMus');
for(const [name, src] of [['poker', PK], ['guandan', GD], ['ddz', DDZ]]){
  assert(/root\.EH_BGM/.test(src), `${name} BGM 开关复用 EH_BGM 控制器(不另造音频实现)`);
}

// C7. 对标一致性(2026-08-20 benchmark): 把已在某款验证过的手感统一到三款
//     ① 斗地主出牌钮牌型即时反馈 + 炸弹红钮(此前恒"出牌", 掼蛋早已有) —— 与掼蛋 typeLabel/boom-ready 同源
assert(/const isBoomType\s*=\s*\(p\)=>\s*!!p\s*&&\s*\(p\.type==='bomb'\|\|p\.type==='rocket'\)/.test(DDZ),
  '斗地主 updatePlayBtn 有 isBoomType(炸弹/火箭红钮)');
assert(/class="bt">\$\{lab\}/.test(DDZ) && /\.ddz-btn \.bt\{/.test(DDZ), '斗地主出牌钮报牌型名(.bt 标签)');
assert(/\.ddz-btn\.primary\.boom-ready\{/.test(DDZ), '斗地主炸弹/火箭钮 boom-ready 红发光');
//     ② 座位赢家金环: 斗/掼收局给赢家席位挂 .win(德州早有 .pk-seat.win), 三桌视觉一致
assert(/\.ddz-seat\.win \.ddz-avr \.av\{[^}]*var\(--amber/.test(DDZ), '斗地主座位赢家金环 .ddz-seat.win');
assert(/\.gd-seat\.win \.gd-avr \.av\{[^}]*var\(--amber/.test(GD), '掼蛋座位赢家金环 .gd-seat.win');
assert(/isWin\s*=\s*st\.phase==='over'\s*&&\s*st\.result\s*&&\s*st\.result\.winners\.includes\(seat\)/.test(DDZ),
  '斗地主 seatHTML 按 winners.includes(seat) 判赢家挂 .win');
assert(/isWin\s*=\s*st\.phase==='over'\s*&&\s*st\.result\s*&&\s*Engine\.teamOf\(seat\)===st\.result\.winnerTeam/.test(GD),
  '掼蛋 seatHTML 按 teamOf(seat)===winnerTeam 判赢家挂 .win');
//     ③ 德州筹码飞行动画(对标大厂差距最大项): 街结束身前筹码归池 + 结算底池归赢家 + 底池数字跳动
assert(/\.pk-flychip\{position:absolute/.test(PK) && /@keyframes pkChipFly/.test(PK), '德州飞行筹码 .pk-flychip + pkChipFly 动画');
assert(/function collectChipsFx\(\)/.test(PK) && /function maybeCollectChips\(\)/.test(PK), '德州街结束归池 collectChipsFx/maybeCollectChips');
assert(/function payoutChipsFx\(winners\)/.test(PK), '德州结算推池归赢家 payoutChipsFx');
assert(/maybeCollectChips\(\);\s*\/\/ 街结束→筹码归池/.test(PK), 'renderAll 在重建座位前调 maybeCollectChips(捕获旧 commit 位置)');
assert(/over\.classList\.add\('payout-in'\);\s*payoutChipsFx\(res\.winnersBySeat\)/.test(PK), 'showOver 触发推池动画 + 浮层延后淡入');
assert(/\.pk-pot\.bump\{animation:pkPotBump/.test(PK), '底池增额数字跳动 .pk-pot.bump');

// D. 三处版本号保持一致(随功能推进升号): BUILD_VER == ver.txt, 且 SW_VERSION 含 BUILD_VER
const buildVer = R('ver.txt').trim();
assert(buildVer && new RegExp(`BUILD_VER='${buildVer.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`).test(HTML), `index.html BUILD_VER=${buildVer}`);
assert(new RegExp(`SW_VERSION.*${buildVer.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`).test(R('sw.js')), `sw.js SW_VERSION 含 BUILD_VER（${buildVer}）`);
assert(buildVer === '20260822-table-focus', 'ver.txt=20260822-table-focus');

// C6. /德州 单人/联机合一: 只保留一条 /德州 命令(退休 /德州联机 面板项)。
//     第1条(主人:「开局后直接进入牌桌这个页面, 每个座位手动邀灵魂或真人, 也支持一键邀请, 之后再发牌」):
//     开桌【不再自动发牌】, 先落到座位页(牌桌大厅 gtOpenSeatingPage) —— 复用 EHTable.renderLobby 撑成全屏牌桌页,
//     每空位手动「加入」(真人自坐)/「🤝灵魂」下拉(指定灵魂坐某席), 或底部「🤝一键灵魂」「👥邀请真人」一键补位,
//     房主满意点「开始发牌 ▶」(=gtStart 空位补灵魂后发牌)才落打牌页。不再弹旧 gtOpenLobby 单独招募页。
//     反回退: 开桌不得直接 gtStart 自动发牌(那是"功能2"旧行为, 本次第1条明确改回"先摆阵再发牌")。
const APP = R('js/app.js');
const NET = R('js/games/table-net.js');
assert(!/\{c:'\/德州联机'/.test(APP), 'app.js 命令面板退休了 /德州联机 独立项(与 /德州 合一)');
const LT = (APP.match(/async function launchTexas\(\)\{[\s\S]*?\n\}/) || [''])[0];
assert(/eh_gt_open/.test(LT) && /eh_gt_set_msg/.test(LT), 'launchTexas 走真牌桌: eh_gt_open 开桌 + 贴牌桌卡');
assert(/gtOpenSeatingPage\s*\(/.test(LT) && !/\bgtStart\s*\(/.test(LT),
  '第1条: launchTexas 开桌先落座位页(gtOpenSeatingPage), 不再自动 gtStart 发牌');
assert(!/gtOpenLobby\s*\(/.test(APP), '不再调用 gtOpenLobby(旧单独招募页已退休)');
assert(/async function gtSeatSoulsIntoEmpties\([\s\S]*?eh_gt_seat_soul/.test(APP), '有 gtSeatSoulsIntoEmpties: 把空位坐满房里灵魂(eh_gt_seat_soul)');
// 座位页: gtOpenSeatingPage 复用 renderLobby 渲染, 开局/散桌自动关页; gtStart(开始发牌)仍先灵魂补位再发牌
const SP = (APP.match(/function gtOpenSeatingPage\(id\)\{[\s\S]*?\n\}/) || [''])[0];
assert(/renderLobby|gtRefreshSeatingPage/.test(APP) && /function gtOpenSeatingPage/.test(APP),
  '第1条: 有 gtOpenSeatingPage 座位页(复用 EHTable.renderLobby 撑成全屏牌桌页)');
assert(/gtRefreshSeatingPage\(row\)/.test(APP.match(/function gtRenderCard\(row\)\{[\s\S]*?\n\}/)[0]),
  '座位页随牌桌行更新即时刷新(本地 gtRpc + 远端 realtime 共 gtRenderCard 一路)');
const GS = (APP.match(/async function gtStart\(id\)\{[\s\S]*?\n\}/) || [''])[0];
assert(/gtSeatSoulsIntoEmpties/.test(GS), 'gtStart(开始发牌)前先灵魂补位(空位=灵魂来玩, 非匿名 AI)');
assert(/gtCloseSeatingPage/.test(GS), 'gtStart 发牌时收掉座位页');
// 手动开房路径: gtFillSouls 为【只召唤灵魂、不开局】的独立动作(与 gtStart 分开), 内里绝不调 eh_gt_start
const GF = (APP.match(/async function gtFillSouls\(id\)\{[\s\S]*?\n\}/) || [''])[0];
assert(/gtSeatSoulsIntoEmpties/.test(GF) && !/eh_gt_start/.test(GF), 'gtFillSouls 只召唤灵魂补位、不开局');
assert(/async function gtInviteHumans\(id\)/.test(APP) && /eh_messages/.test(APP.match(/async function gtInviteHumans\(id\)\{[\s\S]*?\n\}/)[0]),
  '第1条: 有 gtInviteHumans 一键邀真人(往聊天区发招呼, 房里真人点卡加入)');
assert(/开始发牌 ▶/.test(NET) && /ctx\.actions\.start\(\)/.test(NET), 'table-net 座位卡有「开始发牌 ▶」→ start(补灵魂+发牌)');
assert(/🤝一键灵魂/.test(NET) && /ctx\.actions\.fillSouls\(\)/.test(NET), 'table-net 座位卡有「🤝一键灵魂」→ fillSouls(只补位不发牌)');
assert(/👥邀请真人/.test(NET) && /ctx\.actions\.inviteHumans\(\)/.test(NET), 'table-net 座位卡有「👥邀请真人」→ inviteHumans(一键邀真人)');
assert(/gt-soulsel[\s\S]*?ctx\.actions\.seatSoul/.test(NET), 'table-net 每个空位保留「🤝灵魂」下拉(手动指定某灵魂坐某席)');
assert(/async function launchTexasOnline\(\)\{\s*return launchTexas\(\);\s*\}/.test(APP),
  'launchTexasOnline 已退化成 launchTexas 别名(兼容旧命令/调用点)');
assert(/table-net\.js\?v=20260822-table-focus/.test(HTML), 'index.html 挂 table-net.js?v=20260822-table-focus(随改动升号)');

// ── 真机复验 ─────────────────────────────────────────────
function findChrome(){
  const cands = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                 '/Applications/Chromium.app/Contents/MacOS/Chromium',
                 process.env.CHROME_PATH].filter(Boolean);
  return cands.find(p => { try { return fs.existsSync(p); } catch(_){ return false; } });
}
let chromium;
try { ({chromium} = require('playwright')); } catch(_){ try { ({chromium} = require('playwright-core')); } catch(__){} }

async function realCheck(){
  const exe = findChrome();
  if(!chromium || !exe){
    console.log('⏭ 跳过真机复验：' + (!chromium ? 'playwright 未安装' : '未找到 Chrome'));
    return;
  }
  const CSS_ROOT = ':root{--accent:#00e5d4;--amber:#ffc24d;--sub:#86cbc6;--ink:#eaf6ff;--bg:#070a12;--bg2:#0d1524;--line:rgba(0,229,212,.24);--line2:rgba(0,229,212,.4);--panel-solid:#132a29;--dim:#498d88;--glow-cyan:0 0 12px rgba(0,229,212,.5);--glow-mag:0 0 12px rgba(255,45,142,.5);--panel:rgba(21,50,48,.8);--magenta:#ff2d8e;--green:#34e0b0;--btn-ink:#04060c}html,body{margin:0;background:#070a12;color:#eaf6ff;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}#hall{position:relative;width:390px;height:844px;overflow:hidden}';
  const browser = await chromium.launch({ executablePath: exe });
  const ctx = await browser.newContext({ viewport:{width:390, height:844}, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.setContent('<!doctype html><meta charset=utf-8><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+CSS_ROOT+'</style><link rel="stylesheet" href="table-shared.css"><div id="hall"></div>');
  await page.addStyleTag({ content: SHARED });
  for(const f of ['deck.js', 'ddz-rules.js', 'ddz-engine.js', 'ddz-ai.js', 'game-ui.js']){
    await page.addScriptTag({ content: fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8') });
  }
  await page.evaluate(() => { window.__g = EHDdzGame.open({ mount: document.getElementById('hall'), seat:1, names:['我','西家','北家'], avatars:['🦞','🐼','🐺'] }); });
  await page.waitForTimeout(650);
  const dv = await page.evaluate(() => {
    const felt = document.querySelector('.ddz-felt');
    const title = document.querySelector('.ddz-title');
    const back = document.querySelector('.card.back');
    if(!felt || !title) return { err: 'no ddz-felt/title' };
    const feltCS = getComputedStyle(felt);
    const titleCS = getComputedStyle(title);
    const backCS = back ? getComputedStyle(back) : null;
    return {
      feltBg: feltCS.backgroundImage,
      titleRadius: titleCS.borderRadius,
      titleBg: titleCS.backgroundColor,
      titleFont: titleCS.fontFamily,
      backBg: backCS ? backCS.backgroundImage : ''
    };
  });
  assert(/radial-gradient/.test(dv.feltBg), '真机：斗地主 felt 桌面径向渐变生效');
  assert(/999px|9999px/.test(dv.titleRadius), '真机：斗地主 title 已 chip 化 border-radius 999px');
  assert(!/SF Mono|Arial Narrow/.test(dv.titleFont), '真机：斗地主 title 字体链已修正（无 SF Mono/Arial Narrow）');
  assert(!/repeating-linear-gradient/.test(dv.backBg), '真机：斗地主卡背不再是斜条纹');
  assert(/radial-gradient/.test(dv.backBg), '真机：斗地主卡背改成暗玻璃径向渐变');
  assert(errs.length === 0, '真机：斗地主视觉复验零 pageerror');
  await browser.close();
}

(async () => {
  await realCheck();
  if(failed){ console.error(`\n❌ 视觉一致性 ${step} 步有失败`); process.exit(1); }
  console.log(`\n✅ 视觉一致性 ${step} 步全通过：字体链修正 / 卡背换新 / 桌面绒毡 / title chip / 手牌托盘 / 融合毛玻璃`);
})().catch(e => { console.error(e); process.exit(1); });
