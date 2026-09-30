#!/usr/bin/env node
'use strict';
/**
 * probe-suno-api.js — open.suno.cn 文生歌探针
 * 用法: SUNO_API_KEY=xxx node scripts/probe-suno-api.js
 * 流程: 查余额 → 自定义歌词生成 → 轮询 task → 打出 mp3Url
 * 新用户注册送 60 积分, 一次生成返回 2 首(2 task_id)。
 */
const KEY = process.env.SUNO_API_KEY || process.env.SUNO_ACCESS_KEY || '';
if (!KEY) { console.error('缺 SUNO_API_KEY'); process.exit(2); }
const BASE = 'https://open.suno.cn/api/v1';
const H = { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function jget(url) {
  const r = await fetch(url, { headers: H });
  const t = await r.text();
  let b = null; try { b = JSON.parse(t); } catch {}
  return { status: r.status, body: b, text: t.slice(0, 300) };
}
async function jpost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const t = await r.text();
  let b = null; try { b = JSON.parse(t); } catch {}
  return { status: r.status, body: b, text: t.slice(0, 300) };
}

(async () => {
  // 1) 余额
  const bal = await jget(BASE + '/points/balance');
  console.log('余额 HTTP', bal.status, JSON.stringify(bal.body));
  if (bal.status === 401) { console.error('鉴权失败: 检查 access_key'); process.exit(1); }

  // 2) 自定义歌词生成(对齐 eh-sing-gen 的 lyric+tags 形态)
  const gen = await jpost(BASE + '/music/generate', {
    prompt: '[Verse]\n回声厅里说句话\n明天还能听见吗\n\n[Chorus]\n回声厅里说句话\n明天还能听见吗',
    tags: 'pop, catchy, female vocals',
    make_instrumental: false,
    mv: 'chirp-hawk',
    title: '回声测试',
  });
  console.log('生成 HTTP', gen.status, JSON.stringify(gen.body));
  if (gen.status !== 200 && gen.status !== 201) { console.error('生成失败'); process.exit(1); }
  const ids = (gen.body && gen.body.data && gen.body.data.task_ids) || [];
  console.log('task_ids', ids);
  if (!ids.length) { console.error('无 task_id'); process.exit(1); }

  // 3) 轮询第一首
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const q = await jget(BASE + '/music/task?id=' + ids[0]);
    const d = q.body && q.body.data;
    const st = d && d.status;
    console.log(`[${i}] status=${st}`);
    if (st === 'completed') {
      const fi = d.result && d.result.fileInfo;
      console.log('custom_id', d.result && d.result.custom_id);
      console.log('mp3Url', fi && fi.mp3Url);
      console.log('duration', fi && fi.duration);
      console.log('OK');
      process.exit(0);
    }
    if (st === 'failed') {
      console.error('失败', d.result && d.result.errormsg);
      process.exit(1);
    }
  }
  console.error('轮询超时');
  process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
