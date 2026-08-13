#!/usr/bin/env node
'use strict';
// 右侧抽屉无轨滚动旅程：个人空间/房主设置/私信收件箱仍可滚，但不显示原生滚动条。
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');

function assert(ok,msg){if(!ok)throw new Error('FAIL: '+msg);console.log('✓ '+msg);}
function contract(source){
  const base=source.match(/\.drawer-body\s*\{([^}]*)\}/);
  const webkit=source.match(/\.drawer-body::\-webkit-scrollbar\s*\{([^}]*)\}/);
  const bodies=[...source.matchAll(/<div class="drawer-body" id="([^"]+)"/g)].map(m=>m[1]);
  const css=base?base[1]:'';
  const wk=webkit?webkit[1]:'';
  return {
    scrolls:/overflow-y\s*:\s*auto/.test(css),
    firefox:/scrollbar-width\s*:\s*none/.test(css),
    legacy:/-ms-overflow-style\s*:\s*none/.test(css),
    webkit:/width\s*:\s*0/.test(wk)&&/height\s*:\s*0/.test(wk)&&/display\s*:\s*none/.test(wk),
    bodies,
  };
}
function verify(source,quiet=false){
  const c=contract(source);
  const checks=[
    [c.scrolls,'抽屉内容仍保留纵向滚动能力'],
    [c.firefox,'Firefox 隐藏抽屉滚动条'],
    [c.legacy,'旧 Edge / IE 隐藏抽屉滚动条'],
    [c.webkit,'Chrome / Safari / WebView 隐藏抽屉滚动条'],
    [c.bodies.includes('meBody'),'个人空间使用通用无轨滚动容器'],
    [c.bodies.includes('gearBody'),'房主设置使用通用无轨滚动容器'],
    [c.bodies.includes('dmInboxBody'),'私信收件箱使用通用无轨滚动容器'],
  ];
  if(quiet) return checks.every(([ok])=>ok);
  checks.forEach(([ok,msg])=>assert(ok,msg));
  return true;
}

verify(html);

// 反证：恢复旧版「只有 overflow-y:auto、无隐藏规则」后，契约必须失败。
const mutant=html
  .replace(/;scrollbar-width:none;-ms-overflow-style:none/, '')
  .replace(/\s*\.drawer-body::\-webkit-scrollbar\{[^}]*\}/, '');
assert(!verify(mutant,true),'反证：旧版原生滚动条实现必红');

console.log('\n✅ 右侧抽屉无轨滚动旅程通过：三类抽屉仍可滚，Chrome/Safari/Firefox/旧 Edge 均隐藏轨道，旧实现必红。');
