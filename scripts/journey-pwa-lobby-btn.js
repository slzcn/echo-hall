#!/usr/bin/env node
'use strict';
/* journey-pwa-lobby-btn.js — 移动端/PWA 斗地主「开始」可见 + 结构不挤 */
const fs=require('fs'), path=require('path');
const sh=fs.readFileSync(path.join(__dirname,'..','js/games/table-shared.css'),'utf8');
const ddz=fs.readFileSync(path.join(__dirname,'..','js/games/game-ui.js'),'utf8');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

assert(/max-width:\s*599px/.test(sh) && /max-height:\s*720px/.test(sh), '短屏媒体查询降级骨架');
assert(/\.ddz-room\.is-lobby[\s\S]{0,200}#ddzCtrl/.test(sh) || /is-lobby #ddzCtrl/.test(sh), '招募态 #ddzCtrl min-height 清零');
assert(/ddz-lobbtns/.test(sh) && /min-height:\s*44px/.test(sh), '招募按钮 ≥44px 可点');
assert(/is-lobby #ddzCtrl|is-lobby \.ddz-hand-wrap/.test(sh), 'lobby 手牌区让位给操作钮');
assert(/max-width:599px[\s\S]{0,80}#ddzCtrl/.test(ddz) || /is-lobby #ddzCtrl/.test(ddz), 'game-ui 短屏/lobby 控制区不硬撑 92px');
assert(/html\.pwa-standalone \.ddz-bar[\s\S]{0,200}min-height:\s*0/.test(sh), 'PWA 顶栏去掉大 min-height 地板');
assert(/position:\s*relative[\s\S]{0,80}z-index:\s*6/.test(sh), '操作区 z-index 保证可见可点');

console.log('\n'+(failed?'❌ 有失败':'✅ PWA/移动端 lobby 按钮与骨架契约通过'));
process.exit(failed?1:0);
