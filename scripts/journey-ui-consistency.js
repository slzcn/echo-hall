#!/usr/bin/env node
'use strict';
/* journey-ui-consistency.js — 文案/结构/性能严谨一致性 */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const ddz=R('js/games/game-ui.js'), gd=R('js/games/guandan-ui.js'), pk=R('js/games/poker-ui.js');
const app=R('js/app.js'), sh=R('js/games/table-shared.css'), net=R('js/games/table-net.js');
const ver=R('ver.txt').trim(), html=R('index.html'), sw=R('sw.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

console.log('\n── 文案一致 ──');
// 2026-09-29 拉齐: 主客同一套状态词, 不露「引擎/提交/确认/裁决」; 出口一律「返回房间」
const uf = (s)=>s.split('\n').filter(l=>/toast\(|textContent\s*=|innerHTML\s*=|callLbl\s*=|hint\s*=\s*['"`]/.test(l)).join('\n');
assert(!/已提交|等待确认|等待裁决|引擎持有者|接管了牌桌/.test(uf(ddz)+uf(gd)+uf(pk)+uf(app)), '用户文案无「已提交/等待确认/引擎」黑话');
assert(/返回房间/.test(ddz) && /返回房间/.test(gd) && /返回房间/.test(pk), '出口统一「返回房间」');
assert(/思考中|等待 /.test(pk) && /思考中|等待 /.test(ddz) && /思考中|等待 /.test(gd), '等他家统一「轮到X/思考中」');
assert(/轮到你/.test(pk) && /轮到你/.test(ddz) && /轮到你/.test(gd), '自己回合统一「轮到你」');
assert(/出牌没成功/.test(app), '出错提示统一「出牌没成功，再试一次」');
assert(/今日已输光|还可输光/.test(app) && /reached\(/.test(pk), '每日【输光】次数文案与门禁一致');

console.log('\n── 人人平等 ──');
const gtSql = R('sql/eh_game_tables.sql');
const leaveFn = (gtSql.match(/function public\.eh_gt_leave[\s\S]*?\$\$;/)||[''])[0];
assert(leaveFn && !/host_uid\s*=\s*v_me/.test(leaveFn), 'eh_gt_leave 不再因开桌人离席解散整桌(输光/离席只腾座)');
assert(/人人平等/.test(leaveFn), 'leave 契约注释: 离席只腾座, 散桌走 close/reap');
assert(!/你接管了牌桌引擎|你来主持牌局/.test(app), '引擎转移静默, 不向玩家暴露「谁是引擎」');
assert(/if\(empties > 0\)/.test(net) && !/if\(ctx\.isHost && empties/.test(net), '一键补位人人可点(不按 isHost 门)');
// 真人路径同一套: 出牌后本地立刻进下家, 不再插「等待其他玩家」中间态
assert(/Engine\.applyAction\(st, mySeat/.test(pk) && /guestOptimistic/.test(pk) === false ? true : /var r=Engine\.applyAction/.test(pk), '德州 guest 也走 Engine.applyAction');
assert(/isGuest[\s\S]{0,300}Engine\.applyCall/.test(ddz), '斗地主 guest 叫分本地 applyCall');
assert(/isGuest[\s\S]{0,400}Engine\.applyPlay/.test(ddz), '斗地主 guest 出牌本地 applyPlay');
assert(/isGuest[\s\S]{0,400}Engine\.applyPlay/.test(gd), '掼蛋 guest 出牌本地 applyPlay');
assert(!/setBanner\(\); renderCtrl\(\); toast\('等待其他玩家'\)/.test(ddz), '斗地主出牌后不再弹「等待其他玩家」');
// 常规手不弹结算大面板: 真人同一套「横幅+自动下一手」; 完整面板只留输光/通吃
assert(/if \(!iBustNow && !iWonAllNow\)/.test(pk), '德州常规手人人走横幅+自动下一手(不再仅单机)');
assert(/if \(!isGuest\)/.test(pk) && /nextHand\(\)/.test(pk), 'host 自动下一手, 客人等快照');
assert(/findIndex\(function\(x\)\{ return x && String\(x\)===String\(payloadUid\); \}\)/.test(app), 'host 按 uid 认座位(防座号错位拒招)');
// 满 2 席(含灵魂/AI)自动开局, 且有「开始」兜底 —— 否则 1 真人+1 灵魂永远开不了
assert(/occupied>=2/.test(app) || /occupied >= 2/.test(app) || /kind\s*!==\s*'empty'\)\.length/.test(app), '自动开局按占用席(含灵魂)');
assert(/data-lob="start"/.test(pk), '招募态有「▶ 开始」兜底按钮');

console.log('\n── 旁观=让座 ──');
// 旁观 = 起身让座(不是 AI 代打/托管); 德州无代打
assert(/mySeat = -1/.test(pk) || /mySeat=-1/.test(pk), '旁观后 mySeat=-1(不占席)');
assert(!/isAI\[mySeat\] = true/.test(pk.match(/function doEnterSpectator[\s\S]{0,600}/)||[''])[0], '旁观不把我的席交 AI');
assert(/vacate:true/.test(pk), '旁观通知腾座');
assert(/onSeatIdle/.test(app) && /gtLeave/.test(app), 'app 侧 onSeatIdle 腾 DB 座');
assert(/我来坐/.test(pk), '空位菜单有「我来坐」');
assert(/pk-preb\.queued|renderPreActBar/.test(pk), '预选功能保留(queued 标记, 无 .on 粘性选中)');
assert(!/pk-preb\$\{on===key\?' on'/.test(pk), '预选不用 .on 选中类');
assert(/gtCheckNoHumansThenClose/.test(app), '无在座真人自动散桌');
assert(/onGrabSeat/.test(app) && /点击入座|空位/.test(pk), '空位可入座');
assert(!/id="pkAuto"/.test(pk), '德州无托管钮');

console.log('\n── 结构一致 ──');
assert(/ddz-lobacts|ddz-acts/.test(ddz) && /gd-lobacts|gd-acts/.test(gd) && /pk-lobacts|pk-acts/.test(pk), '操作区容器命名各就各位');
assert(/pk-prehint/.test(pk) && (/自动开始|点空位/).test(pk), '德州招募提示(满2人自动开始)与另两桌同构');
assert(/min-height:\s*0/.test(sh) && /is-lobby/.test(sh), '招募/短屏骨架降级仍在');
assert(/var\(--accent/.test(sh), '台面/按钮跟主题变量');

console.log('\n── 性能收口 ──');
assert(/_ddzSeatSigs/.test(ddz) && /oppDirty/.test(ddz), '斗地主座位增量');
assert(/_seatSigs/.test(gd), '掼蛋座位增量');
assert(/structSig/.test(pk) && /positionSeats\._key/.test(pk), '德州签名+几何缓存');
assert(/EH_MESSAGES/.test(app) && /shouldPersistSnap/.test(app), '快照节流走模块');
assert(/_ehCatch\('rmMsgChan'/.test(app), '通道清理可观测');

console.log('\n── 严谨 ──');
const build=(html.match(/BUILD_VER='([^']+)'/)||[])[1];
const appVer=(app.match(/__EH_APP_VER = '([^']+)'/)||[])[1];
const swVer=(sw.match(/SW_VERSION = '([^']+)'/)||[])[1];
assert(!!ver && build===ver && appVer===ver && (swVer||'').includes(ver),
  `版本三元组一致 BUILD=app=ver.txt=${ver} · SW=${swVer}`);
assert(/isTrustedVoiceSrc/.test(R('js/modules/messages.js')), '语音白名单在模块');

console.log('\n'+(failed?'❌ 有失败':'✅ 文案/结构/性能一致性通过'));
process.exit(failed?1:0);
