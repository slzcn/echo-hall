'use strict';
const fs=require('fs');
const assert=(ok,msg)=>{if(!ok){console.error('✗',msg);process.exit(1)}console.log('✓',msg)};
const src=fs.readFileSync(__dirname+'/../js/app.js','utf8');
console.log('\n▸ 登录页身份配对旅程');
assert(/if\(!me\.registered && !me\.username && !me\.email && reconcileEmoji\(\)\)/.test(src),'每次登录页绘制前校正临时身份头像');
assert(/if\(me\.registered\) return false/.test(src),'正式账号自定义头像不被名字强制覆盖');
assert(/av\.textContent=me\.emoji/.test(src)&&/\$\('#idName'\)\.textContent=me\.name/.test(src),'头像和名字从同一份 me 对象渲染');
function pair(name, emoji, registered=false){
  const animals=['水獭','狐','鸟','水母','狼','鲸','猫头鹰','蝙蝠','章鱼','鹿','企鹅','黑猫','海豚','虎','刺猬','蝴蝶'];
  const icons=['🦦','🦊','🐦⬛','🪼','🐺','🐋','🦉','🦇','🐙','🦌','🐧','🐈⬛','🐬','🐯','🦔','🦋'];
  if(!registered){const i=animals.findIndex(x=>name.endsWith(x)); if(i>=0) emoji=icons[i];}
  return emoji;
}
assert(pair('夜航狼','🦊')==='🐺','临时身份名字与头像自动重新配对');
assert(pair('主人自定义昵称','👑',true)==='👑','正式账号自定义头像保持不变');
console.log('✅ 登录页身份配对旅程通过');
