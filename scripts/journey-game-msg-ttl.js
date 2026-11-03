#!/usr/bin/env node
'use strict';
/* journey-game-msg-ttl.js — 游戏记录 1 小时消散契约(主人诉求)
 *   聊天室里的游戏记录(kind='game': 牌桌卡/战绩卡/海龟汤)默认只留 1 小时, 到点消散:
 *   ① 创建带 expires_at=now+GAME_TTL(默认 1h, tuning.gameTtlMs 可调)
 *   ② 渲染: 已过期不渲染(历史/补拉过滤), 未到期 scheduleGameDissolve 到点淡出
 *   ③ 活桌卡消散后由 gtSurfaceTable 无缝补活视图(记录寿命与活桌入口解耦) */
const fs=require('fs'), path=require('path');
const R=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const app=R('js/app.js');
let step=0, failed=false;
function assert(c,m){ step++; if(!c){failed=true;console.error('✗ ['+step+'] '+m);} else console.log('✓ ['+step+'] '+m); }

// ① TTL 常量: 默认 1 小时, 走 tuning 可远程调
assert(/const GAME_TTL\s*=\s*\(\)=>TUNE\('gameTtlMs',\s*3600000\)/.test(app),
  'GAME_TTL = TUNE(gameTtlMs, 3600000) — 默认 1 小时');
// ② 创建即带 expires_at: 三处 kind:'game' payload(桌卡)全部带过期时间(数真实 payload, 不数注释)
const payloadsWithTtl=(app.match(/kind:'game',expires_at/g)||[]).length;
const payloadsStale=(app.match(/kind:'game'\}/g)||[]).length;   // 紧跟 } 的 = 旧式无过期 payload
assert(payloadsWithTtl>=3 && payloadsStale===0,
  'kind:\'game\' 三处创建 payload 均带 expires_at(无旧式无过期 payload)');
// ③ 渲染过滤 + 消散调度
assert(/if\(m\.expires_at && Date\.now\(\) > new Date\(m\.expires_at\)\.getTime\(\)\) return null;/.test(app),
  '已过期游戏记录不渲染(历史/补拉过滤)');
assert(/scheduleGameDissolve\(el, m\.expires_at\)/.test(app), '渲染即挂 scheduleGameDissolve');
assert(/function scheduleGameDissolve\(/.test(app), 'scheduleGameDissolve 实现存在');
assert(/el\.classList\.add\('fading'\)[\s\S]{0,600}el\.remove\(\)/.test(app),
  '到点淡出并移除(消散语义, 与虚空同族)');
// ④ 活桌解耦: 消散时活桌(lbby/playing)由 gtSurfaceTable 补回本地活视图
assert(/function scheduleGameDissolve[\s\S]{0,900}gtSurfaceTable\(row\)/.test(app),
  '活桌卡消散后 gtSurfaceTable 无缝补回(活桌入口不受 1h 影响)');

// 反证(旧实现必红): 旧的 game 分支不带过期处理
const oldBranch=/if\(m\.kind==='game'\)\{\s*const el=buildGameEl\(m, isHistory\);/;
assert(!oldBranch.test(app), '旧实现(渲染无过期处理)已不存在');

console.log('\n'+(failed?'❌ 有失败':'✅ 游戏记录 1 小时消散契约通过'));
process.exit(failed?1:0);
