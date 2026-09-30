#!/usr/bin/env node
'use strict';
const assert=require('assert');

async function scenario(legacy=false){
  let epoch=0, curRoom=null, msgChan=null, heartbeat=null;
  const removed=[];
  let releaseLeave;
  const delayedDelete=new Promise(r=>releaseLeave=r);
  async function enter(room, auth){
    const myEpoch=++epoch; curRoom=room;
    await auth;
    if(!legacy && (myEpoch!==epoch || !curRoom || curRoom.id!==room.id)) return false;
    msgChan='msg-'+room.id; heartbeat='hb-'+room.id; return true;
  }
  async function leave(){
    const oldRoom=curRoom, oldMsg=msgChan, oldHb=heartbeat, oldEpoch=epoch;
    if(!legacy){ epoch++; curRoom=null; msgChan=null; heartbeat=null; }
    await delayedDelete;
    if(legacy){
      if(msgChan) removed.push(msgChan);
      if(heartbeat) removed.push(heartbeat);
      curRoom=null; msgChan=null; heartbeat=null;
    }else{
      if(oldMsg) removed.push(oldMsg);
      if(oldHb) removed.push(oldHb);
      if(epoch===oldEpoch+1){ curRoom=null; msgChan=null; heartbeat=null; }
    }
  }
  await enter({id:'A'},Promise.resolve());
  const leaving=leave();
  const enterB=enter({id:'B'},Promise.resolve());
  await enterB; releaseLeave(); await leaving;
  return {epoch,curRoom,msgChan,heartbeat,removed};
}

(async()=>{
  const now=await scenario(false);
  assert.equal(now.curRoom.id,'B','快速进入 B 后当前房必须仍为 B');
  assert.equal(now.msgChan,'msg-B','旧离房不得删除 B 消息频道');
  assert.equal(now.heartbeat,'hb-B','旧离房不得清理 B 心跳');
  assert(!now.removed.includes('msg-B'),'捕获式清理只能移除 A 资源');
  console.log('✓ A 房延迟清理不碰 B 房资源');

  const old=await scenario(true);
  assert(old.curRoom===null && old.removed.includes('msg-B'),'旧实现反证应稳定误删 B 资源');
  console.log('✓ 旧实现反证：await 后读取全局句柄会误删 B 房');

  const fs=require('fs'); const src=fs.readFileSync('js/app.js','utf8');
  assert(src.includes('const enterEpoch = ++roomEpoch'));
  assert(src.includes('enterEpoch!==roomEpoch || !curRoom || curRoom.id!==room.id'));
  assert(src.includes('const leavingMsgChan=msgChan'));
  assert(src.includes('leavePresence(leavingRoom, leavingHeartbeatTimer)'));
  assert(!/if\(msgChan\)\{ sb\.removeChannel\(msgChan\)/.test(src));
  console.log('✓ 生产实现含代次校验、捕获式资源清理且移除旧全局清理');
})().catch(e=>{ console.error('✗',e.stack||e); process.exit(1); });
