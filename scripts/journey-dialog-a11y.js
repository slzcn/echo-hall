#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const h=fs.readFileSync('index.html','utf8'),s=fs.readFileSync('js/app.js','utf8');

function extractFunction(name){
  const start=s.indexOf(`function ${name}(`); assert(start>=0,`missing ${name}`);
  const brace=s.indexOf('{',start); let depth=0, quote=null, esc=false;
  for(let i=brace;i<s.length;i++){
    const c=s[i];
    if(quote){ if(esc) esc=false; else if(c==='\\') esc=true; else if(c===quote) quote=null; continue; }
    if(c==='"'||c==="'"||c==='`'){quote=c;continue;}
    if(c==='{') depth++; else if(c==='}'&&--depth===0) return s.slice(start,i+1);
  }
  throw new Error(`unterminated ${name}`);
}
function attrsFor(id){ const m=h.match(new RegExp(`<[^>]+id="${id}"[^>]*>`)); assert(m,`missing #${id}`); return m[0]; }

assert(/id="modalMask" role="dialog" aria-modal="true"/.test(h));
assert(/id="modalX" aria-label="关闭"/.test(h)&&/<button[^>]+id="modalX"/.test(h));
assert(/id="confirmMask" role="dialog" aria-modal="true" aria-labelledby="confirmTitle"/.test(h));
assert(/id="toast" role="status" aria-live="polite"/.test(h));
assert(/id="stream" role="log" aria-live="polite"/.test(h));
assert(h.includes('[role="button"]:focus-visible')&&h.includes('input:focus-visible'));

const titles={mCreate:'activeModalTitle',mCreated:'createdModalTitle',mJoin:'joinModalTitle',mReg:'regModalTitle',mReset:'resetModalTitle',mProfile:'profileModalTitle'};
for(const [panel,title] of Object.entries(titles)){
  assert(new RegExp(`id="${panel}"`).test(h),`missing panel ${panel}`);
  assert(new RegExp(`id="${title}"`).test(h),`missing title ${title}`);
}
const openModal=extractFunction('openModal');
for(const [panel,title] of Object.entries(titles)) assert(openModal.includes(`${panel}:'${title}'`),`${panel} label mapping missing`);
assert(openModal.includes("mask.setAttribute('aria-labelledby',titleIds[which]"));

const trapConfirm=extractFunction('_trapConfirmKey'), confirm=extractFunction('ehConfirm');
assert(trapConfirm.includes("e.key==='Escape'")&&trapConfirm.includes("e.key!=='Tab'"));
assert(trapConfirm.includes('last.focus()')&&trapConfirm.includes('first.focus()'));
assert(confirm.includes('_confirmReturnFocus=document.activeElement'));
assert(confirm.includes('_confirmReturnFocus.focus()'));
assert(s.includes("if(_trapConfirmKey(e)) return; _trapModalKey(e)"));
assert(s.includes('@media (prefers-reduced-motion:reduce){.eh-replay-modal{animation:none!important}'));

// Behaviour: confirm Tab/Shift+Tab wraps and Esc invokes the active close callback.
function el(id){return {id,focused:0,offsetParent:{},focus(){this.focused++;document.activeElement=this;}};}
const no=el('confirmNo'),yes=el('confirmYes');
const mask={classList:{contains:c=>c==='on'},querySelectorAll:()=>[no,yes]};
const document={activeElement:yes}; let escaped=null;
const ctx={document,_confirmDone:v=>{escaped=v;},$:(q)=>q==='#confirmMask'?mask:null};
vm.runInNewContext(`${extractFunction('_focusables')};${trapConfirm}; this.trap=_trapConfirmKey;`,ctx);
let prevented=0; ctx.trap({key:'Tab',shiftKey:false,preventDefault(){prevented++;}}); assert.equal(no.focused,1); assert.equal(prevented,1);
document.activeElement=no; ctx.trap({key:'Tab',shiftKey:true,preventDefault(){prevented++;}}); assert.equal(yes.focused,1);
ctx.trap({key:'Escape',shiftKey:false,preventDefault(){prevented++;}}); assert.equal(escaped,false);

const legacyConfirm="function ehConfirm(){mask.classList.add('on'); yes.onclick=done; no.onclick=done;}";
assert(!legacyConfirm.includes('Escape')&&!legacyConfirm.includes('activeElement')&&!legacyConfirm.includes("key!=='Tab'"));
console.log('✓ 各面板动态命名；confirm Tab/Shift+Tab 圈定、Esc 关闭、焦点恢复契约与行为通过');
console.log('✓ 旧实现反证：固定标题且 confirm 无键盘闭环时必红');
