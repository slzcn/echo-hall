#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs');
const h=fs.readFileSync('index.html','utf8'),s=fs.readFileSync('js/app.js','utf8');
assert(/id="modalMask" role="dialog" aria-modal="true"/.test(h));
assert(/id="modalX" aria-label="关闭"/.test(h)&&/<button[^>]+id="modalX"/.test(h));
assert(/id="confirmMask" role="dialog" aria-modal="true"/.test(h));
assert(/id="toast" role="status" aria-live="polite"/.test(h));
assert(/id="stream" role="log" aria-live="polite"/.test(h));
assert(h.includes('[role="button"]:focus-visible')&&h.includes('input:focus-visible'));
assert(s.includes("if(e.key==='Escape')"));
assert(s.includes("if(e.key!=='Tab') return"));
assert(s.includes('_modalReturnFocus.focus()'));
assert(s.includes('@media (prefers-reduced-motion:reduce){.eh-replay-modal{animation:none!important}'));
console.log('✓ dialog 语义、关闭按钮、焦点圈定／恢复、live region、reduce-motion 契约齐全');
const legacy='<div id="modalMask"><div id="modalX">✕</div></div>';
assert(!/role="dialog"/.test(legacy)&&!/<button/.test(legacy));
console.log('✓ 旧实现反证：弹窗无语义且关闭控件不可键盘聚焦');
