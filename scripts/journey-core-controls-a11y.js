#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const h=fs.readFileSync('index.html','utf8'),s=fs.readFileSync('js/app.js','utf8');
const ids=['counterBtn','guardBtn','loginToggle','toRegLink','toReset','wallX','meDx','gearDx','bgmBtnLobby','skinBtn','meBtn','backBtn','hallIcon','wallBtn','bgmBtnHall','skinBtnHall','meBtnHall','toLatestBtn','mentionJump','songJump','rpX','plusBtn','emojiBtn','pmVoice','pmVoid','pmSong','pmBottle'];
function tag(id,src=h){const m=src.match(new RegExp(`<[^>]+id="${id}"[^>]*>`));assert(m,`missing #${id}`);return m[0];}
for(const id of ids){
  const t=tag(id); assert(/role="button"/.test(t),`#${id} role`); assert(/tabindex="0"/.test(t),`#${id} tabindex`); assert(/aria-label="[^"]+"/.test(t),`#${id} name`);
}
for(const kind of ['public','private']){ const m=h.match(new RegExp(`<div class="opt[^"]*" data-kind="${kind}"[^>]*>`)); assert(m&&/role="button"/.test(m[0])&&/tabindex="0"/.test(m[0])&&/aria-label=/.test(m[0])); }
assert(s.includes('function _activateRoleButtonOnKey(e)'));
assert(s.includes("e.key!=='Enter'&&e.key!==' '")&&s.includes('e.preventDefault(); el.click();'));
assert(s.includes('_trapModalKey(e); _activateRoleButtonOnKey(e)'));

// Behaviour: Enter and Space synthesize one click; other keys and native buttons are untouched.
const role={clicks:0,click(){this.clicks++;}}, plain={clicks:0,click(){this.clicks++;}};
const document={addEventListener(){}};
const ctx={document};
const fn=s.match(/function _activateRoleButtonOnKey\(e\)\{[\s\S]*?\n\}/)[0]; vm.runInNewContext(`${fn};this.activate=_activateRoleButtonOnKey;`,ctx);
for(const key of ['Enter',' ']){let p=0;ctx.activate({key,target:{closest:q=>q==='[role="button"]'?role:null},preventDefault(){p++;}});assert.equal(p,1);}
ctx.activate({key:'ArrowDown',target:{closest:()=>role},preventDefault(){throw Error('must not prevent');}});
ctx.activate({key:'Enter',target:{closest:()=>null},preventDefault(){throw Error('native must not be handled');}});
assert.equal(role.clicks,2); assert.equal(plain.clicks,0);

const legacy='<div id="backBtn"></div><div id="plusBtn" title="更多"></div>';
assert(!/role="button"/.test(legacy)&&!/tabindex="0"/.test(legacy));
console.log('✓ 核心非原生控件语义、焦点、可访问名称及 Enter/Space 激活行为通过');
console.log('✓ 旧实现反证：仅 click 的 div 无 role/tabindex 时必红');
