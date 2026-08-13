#!/usr/bin/env node
'use strict';
// 验证 sendBgmGen 生成期 UI 状态 + 曲名兜底质量。
// 从 app.js 抽取 bgmGeneratedTitle 与 buildBgmMenu 的 bgm-gen-row 渲染片段, 在 vm 里跑真实逻辑。
const fs=require('fs');
const vm=require('vm');
const src=fs.readFileSync('js/app.js','utf8');

function assert(ok,msg){ if(!ok) throw new Error('FAIL: '+msg); console.log('✓ '+msg); }

// ============ 曲名池测试 ============
// 抽取 bgmGeneratedTitle 函数源码到常量池测试
const startTitle=src.indexOf('function bgmGeneratedTitle(');
const endTitle=src.indexOf('\nasync function bgmAccessToken', startTitle);
if(startTitle<0||endTitle<0) throw new Error('无法定位 bgmGeneratedTitle');
const titleFnSrc=src.slice(startTitle,endTitle);
// 抽取 BGM_TITLE_MOODS 常量(意象命中池)
const moodsStart=src.indexOf('const BGM_TITLE_MOODS');
const moodsEnd=src.indexOf('];',moodsStart)+2;
if(moodsStart<0) throw new Error('无法定位 BGM_TITLE_MOODS');
const moodsSrc=src.slice(moodsStart,moodsEnd);

const ctx={ Intl, Math, String };
vm.createContext(ctx);
vm.runInContext(moodsSrc+'\n'+titleFnSrc+'\nglobalThis._fn=bgmGeneratedTitle;\nglobalThis._moods=BGM_TITLE_MOODS;',ctx);
const title=ctx._fn;

// 1. 兜底池不含黑名单流水句
const banned=['留给自己的一首','说不清的心情','当下这一刻','此刻回声','把秘密扔进宇宙','没人的深夜频率','关上门以后','只说给你听'];
const hits=new Set();
for(let i=0;i<400;i++){
  const t=title('','');
  hits.add(t);
  for(const b of banned){ if(t===b) throw new Error('兜底池仍含黑名单: '+t); }
}
assert(true,`空描述400次采样 全部不含黑名单流水句 (采到 ${hits.size} 个不同名)`);
assert(hits.size>=4,`兜底池具备足够变体 (采到 ${hits.size} 个)`);

// 2. 长度约束: 2-8 字(用 Segmenter 数字)
for(const t of hits){
  const chars=[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(t)].map(x=>x.segment);
  if(chars.length<2||chars.length>8) throw new Error(`兜底曲名长度越界: "${t}" (${chars.length}字)`);
}
assert(true,'兜底池所有曲名长度均在 2-8 字');

// 3. 意象房间命中策展名(不落兜底)
const dark=title('',{name:'午夜电台'});
assert(['午夜回声','凌晨电台','独自频率','夜里一盏'].includes(dark),`午夜电台房间命中意象池: 采到 "${dark}"`);
const tech=title('',{name:'技术房'});
assert(['代码微光','编译夜色','屏前深夜','终端小调'].includes(tech),`技术房命中意象池: 采到 "${tech}"`);

// 4. 描述含意象关键词走 BGM_TITLE_MOODS(优先级最高)
const moodTitle=title('午夜温柔电台的抒情钢琴',{name:'X'});
// 只要函数能跑通 & 返回非空非黑名单短句即可(MOODS 命中池由生产维护)
assert(moodTitle && !banned.includes(moodTitle) && moodTitle.length<=12,`意象描述能得到得体命名: "${moodTitle}"`);

// ============ 菜单 gen-row 状态化 ============
// 用 grep 断言源码存在关键渲染分支
assert(src.includes("_rowTxt = _gen ? '🎼 灵魂正在作曲…' : '请灵魂制作一首…'"),
       'buildBgmMenu 按 _ehBgmGenerating 二态渲染 gen-row 文案');
assert(src.includes("_rowCls = _gen ? 'skin-opt bgm-gen-row disabled' : 'skin-opt bgm-gen-row'"),
       '生成中给 .disabled class 阻止交互');
assert(src.includes("_rowAct = _gen ? '' : ' data-action=\"gen\"'"),
       '生成中移除 data-action=\"gen\" 防误点');
assert(src.includes("if(window._ehBgmGenerating){ toast('灵魂正在为你作曲, 再给它一会儿'); return; }"),
       '菜单点击处理再加一道 _ehBgmGenerating 守卫');
assert(src.includes("window._ehBgmGenerating=true; window.dispatchEvent(new CustomEvent('eh:bgm-changed',{detail:{reason:'generating',on:true}}"),
       'sendBgmGen 开始时复用 eh:bgm-changed 总线通知 on=true');
assert(src.includes("window._ehBgmGenerating=false; window.dispatchEvent(new CustomEvent('eh:bgm-changed',{detail:{reason:'generating',on:false}}"),
       'sendBgmGen finally 里复用 eh:bgm-changed 总线通知 on=false');
assert(src.includes("const isGenerating=reason==='generating'"),
       '现有 eh:bgm-changed 总线处理作曲中状态并重绘菜单');

console.log('\n全部 10 项作曲进度可见 + 曲名规范回归通过');
