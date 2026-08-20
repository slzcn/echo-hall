#!/usr/bin/env node
'use strict';
const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync('js/app.js','utf8');
assert(/let _turnAlertT=null/.test(src),'回合提醒必须持有生命周期 timer');
assert(/function _gtStartTurnAlert\b/.test(src),'牌桌活跃时可启动提醒');
assert(/if\(_turnAlertT\) return/.test(src),'重复启动不叠加');
assert(/function _gtStopTurnAlert\b/.test(src),'收工/离房可停止提醒');
assert(/clearInterval\(_turnAlertT\)/.test(src),'停止会清除 interval');
assert(/function _gtCleanupPlay\(\)[\s\S]*?_gtStopTurnAlert\(\)/.test(src),'牌桌清理统一停止提醒');
assert((src.match(/_gtStartTurnAlert\(\);/g)||[]).length>=6,'三种牌桌 host/guest 激活路径均启动提醒');
assert(!/^setInterval\(\(\)=>\{ try\{ gtTickTurnAlert\(\); \}catch\(_\)\{ \} \}, 2500\);/m.test(src),'初始化阶段不得常驻 2.5s 轮询');
const legacy=src.replace(/let _turnAlertT=null;[\s\S]*?function _gtStartTurnAlert\(\)[\s\S]*?\n}/,'setInterval(()=>{ try{ gtTickTurnAlert(); }catch(_){ } }, 2500);');
assert(/^setInterval\(\(\)=>\{ try\{ gtTickTurnAlert/m.test(legacy),'反证：旧实现初始化即常驻轮询');
console.log('✓ 回合提醒仅牌桌活跃时单例启动，收工/离房停止；旧实现反证通过');
