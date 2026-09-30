#!/usr/bin/env node
'use strict';
const assert=require('assert'), fs=require('fs');
async function simulate(legacy=false){
  let epoch=1, room={id:'A'}, inserted=null, revoked=0, release;
  const upload=new Promise(r=>release=r);
  async function send(){
    const rid=room.id, ep=epoch; const local='blob:x';
    await upload;
    if(!legacy && (ep!==epoch || !room || room.id!==rid)){ revoked++; return; }
    inserted=legacy?room.id:rid; revoked++;
  }
  const p=send(); room={id:'B'}; epoch++; release(); await p;
  return {inserted,revoked};
}
(async()=>{
  const now=await simulate(false); assert.equal(now.inserted,null); assert.equal(now.revoked,1); console.log('✓ 切房后旧语音不落新房且释放 Blob URL');
  const old=await simulate(true); assert.equal(old.inserted,'B'); console.log('✓ 旧实现反证：await 后读取 curRoom 会写入 B 房');
  const s=fs.readFileSync('js/app.js','utf8');
  assert(s.includes('const voiceRoomId=curRoom.id'));
  assert(s.includes('room_id:voiceRoomId'));
  assert((s.match(/revokeLocal\(\)/g)||[]).length>=4,'成功/上传失败/插入失败/切房均应释放');
  assert(s.includes('voiceEpoch!==roomEpoch || !curRoom || curRoom.id!==voiceRoomId'));
  console.log('✓ 生产实现固定房间 ID、代次校验并覆盖对象 URL 各出口');
})().catch(e=>{console.error('✗',e.stack||e);process.exit(1)});
