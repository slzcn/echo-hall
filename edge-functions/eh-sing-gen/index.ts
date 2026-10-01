/**
 * eh-sing-gen — 文字神曲统一公网谱曲
 * 对齐 MiniMax 官方 2026-08+ 音乐生成 API:
 *   POST https://api.minimax.cn/v1/music_generation
 *   模型: music-cover / music-3.0(付费) ; free 档已停服但仍尝试
 *   output_format: url | hex(默认)
 *   cover 两步: /v1/music_cover_preprocess → cover_feature_id
 * 免费档停服或鉴权失败时: 退 eh-sing-tts 人声(可播), 前端可叠母版。
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

function b64ToBytes(b64) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
function pcmToWav(pcm, sr = 24000, ch = 1) {
  const len = pcm.length
  const buf = new Uint8Array(44 + len)
  const dv = new DataView(buf.buffer)
  const w = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i) }
  w(0, 'RIFF'); dv.setUint32(4, 36 + len, true); w(8, 'WAVE'); w(12, 'fmt ')
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true)
  dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true)
  dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true)
  w(36, 'data'); dv.setUint32(40, len, true)
  buf.set(pcm, 44)
  return buf
}
function decodeAudioPayload(raw) {
  if (!raw) return null
  const s = String(raw)
  if (/^[0-9a-fA-F]+$/.test(s) && s.length > 400 && s.length % 2 === 0) {
    const out = new Uint8Array(s.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16)
    return out
  }
  try { return b64ToBytes(s) } catch { return null }
}
function buildLyrics(lyric, sid) {
  const L = String(lyric || '').trim()
  const SHORT = 8
  const body = L.length < SHORT ? `${L}\n${L}` : L
  // 官方支持 [Intro]/[Verse]/[Chorus] 等标签
  return `[Verse]\n${body}\n\n[Chorus]\n${body}\n${body}`
}
// Suno 专用短歌词: 【不带段落标签】——实测 [Verse]/[Chorus]/[Outro] 会拖成 20~60s+
//   纯词两遍即可(主人: 最多循环 2 遍), 配合 tags 里的 "ending after two lines" 收尾
function sunoLyrics(lyric) {
  const L = String(lyric || '').trim().slice(0, 60)
  return `${L}\n${L}`
}
function stylePrompt(sid) {
  return ({
    dj: '流行音乐, 电子舞曲, 动感, 适合夜店, 人声演唱',
    funk: '放克, 律动感强, 迪斯科, 复古电子, 人声演唱',
    jazz: '爵士, 慵懒, 威士忌酒吧氛围, 萨克斯, 人声演唱',
    gufeng: '中国风, 古筝, 婉转, 江南烟雨, 人声演唱',
    rnb: 'R&B, 慢板情歌, 柔和, 午夜情调, 人声演唱',
    kid: '儿童歌曲, 欢快, 卡通, 明亮童声',
    acapella: '清唱, 无伴奏人声, 干净',
  })[sid] || '流行音乐, 人声演唱, 洗脑旋律'
}
async function tryJson(url, headers, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
    const text = await r.text()
    let j = null
    try { j = JSON.parse(text) } catch { /* noop */ }
    return { ok: r.ok, status: r.status, j, text: text.slice(0, 400) }
  } catch (e) {
    return { ok: false, status: 0, j: null, text: String(e) }
  }
}
function parseMusicResp(j) {
  if (!j) return null
  const code = j.base_resp && j.base_resp.status_code
  if (code != null && code !== 0) {
    return { fail: true, code, msg: (j.base_resp && j.base_resp.status_msg) || '', }
  }
  const d = j.data || {}
  const extra = j.extra_info || {}
  const audio = d.audio || d.audio_hex || null
  const bytes = typeof audio === 'string' ? decodeAudioPayload(audio) : null
  const status = d.status
  // status 2=完成; hex 默认
  if (bytes && bytes.length > 200 && (status == null || status === 2)) {
    const durMs = Number(extra.music_duration || 0)
    return {
      ok: true, bytes,
      duration: durMs > 2000 ? durMs / 1000 : (durMs || 0),
      structure: j.analysis_info || null,
      traceId: j.trace_id || null,
    }
  }
  return { fail: true, code: code != null ? code : -1, msg: 'no_audio status=' + status, text: JSON.stringify(j).slice(0, 200) }
}
// ── Suno(open.suno.cn): 自定义歌词生歌 → 轮询 → 下载回存 ──────────────
// 鉴权: Authorization: Bearer <SUNO_API_KEY>; 每次生成返回 2 个 task_id, 取第一首。
// 链接只 1h 有效, 必须立刻下载回存 eh-song。返回 m4a(ISO-MP4) 容器。
function sunoTags(sid) {
  // tags 要点名「唱出歌词」+「两遍即收」——否则模型易做成纯哼唱/长前奏/拖尾
  const end = ', short song, ends after two lines'
  return ({
    dj: 'mandarin pop, edm, energetic, female vocals singing lyrics' + end,
    funk: 'mandarin funk, groovy, disco, female vocals singing lyrics' + end,
    jazz: 'mandarin jazz, smooth, saxophone, female vocals singing lyrics' + end,
    gufeng: 'chinese traditional, guzheng, female vocals singing lyrics' + end,
    rnb: 'mandarin r&b, soul, slow jam, female vocals singing lyrics' + end,
    kid: 'kids song, happy, bright, singing lyrics' + end,
    acapella: 'a cappella, vocal only, singing lyrics clearly' + end,
  })[sid] || 'mandarin pop, catchy, female vocals singing lyrics' + end
}
// 目标时长: 词唱完(含 [Chorus][Outro] 两三遍) + 轻收。中文约 0.4s/字
//   实测 7 字 + 紧凑模板 ≈ 20s; 超 32s 才裁, 免误砍人声尾
function sunoTargetSec(lyric) {
  const n = String(lyric || '').trim().length
  return Math.min(32, Math.max(12, Math.round(n * 0.45 * 2 + 8)))
}
// 歌词时间戳对齐(异步): 拿人声起止, 供跑马灯/裁剪
async function sunoAlign({ apiKey, clipId, lyrics }) {
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const BASE = 'https://open.suno.cn/api/v1'
  try {
    const ar = await fetch(BASE + '/music/aligned-lyrics', {
      method: 'POST', headers: H,
      body: JSON.stringify({ lyrics, suno_id: clipId }),
    })
    const aj = await ar.json().catch(() => null)
    const id = aj && aj.data && (aj.data.task_id || aj.data.id)
    if (!ar.ok || id == null) return null
    for (let i = 0; i < 15; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const q = await fetch(BASE + '/music/task?id=' + id, { headers: H })
      const qj = await q.json().catch(() => null)
      const d = qj && qj.data
      if (!d) continue
      const ext = d.result && d.result.extend
      let obj = null
      if (typeof ext === 'string') { try { obj = JSON.parse(ext) } catch {} }
      else if (ext && typeof ext === 'object') obj = ext
      const al = obj && obj.alignment
      if (Array.isArray(al) && al.length) {
        // 只认真字词: [Chorus] 等标签会被当成"词"拖后 vE
        const ok = al.filter(x => x && x.success && x.end_s > 0 && !/^\[.*\]$/.test(String(x.word || '').trim()))
        if (ok.length) {
          // 保留完整逐词对齐, 供前端 buildLyricTimeline 映射到句行(替代均匀分布)
          return {
            start: Number(ok[0].start_s) || 0,
            end: Number(ok[ok.length - 1].end_s) || 0,
            words: ok.map(x => ({ word: String(x.word || '').trim(), start: Number(x.start_s) || 0, end: Number(x.end_s) || 0 })),
          }
        }
      }
      if (d.status === 'failed') return null
    }
  } catch { /* ignore */ }
  return null
}
// 按 clip_id 裁剪: 只留唱词段(避免 80s 前奏/间奏)
// ★字段名实测为 crop_start_s/crop_end_s(文档写 start_time/end_time 会 400)
async function sunoCrop({ apiKey, clipId, startSec, endSec }) {
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const BASE = 'https://open.suno.cn/api/v1'
  try {
    const cr = await fetch(BASE + '/music/crop', {
      method: 'POST', headers: H,
      body: JSON.stringify({ clip_id: clipId, crop_start_s: startSec, crop_end_s: endSec }),
    })
    const cj = await cr.json().catch(() => null)
    const ids = cj && cj.data && cj.data.task_ids
    const id = Array.isArray(ids) ? ids[0] : (cj && cj.data && cj.data.task_id)
    if (!cr.ok || id == null) return null
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 4000))
      const q = await fetch(BASE + '/music/task?id=' + id, { headers: H })
      const qj = await q.json().catch(() => null)
      const d = qj && qj.data
      if (!d) continue
      if (d.status === 'completed') {
        const fi = (d.result && d.result.fileInfo) || {}
        const url = fi.mp3Url || fi.wavUrl || fi.m4aUrl
        if (!url) return null
        const ar = await fetch(url)
        if (!ar.ok) return null
        const bytes = new Uint8Array(await ar.arrayBuffer())
        if (bytes.length < 800) return null
        return { audio: bytes, duration: Number(fi.duration) || (endSec - startSec) }
      }
      if (d.status === 'failed') return null
    }
  } catch { /* fallthrough */ }
  return null
}
async function sunoGenerate({ apiKey, lyric, sid }) {
  const H = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const BASE = 'https://open.suno.cn/api/v1'
  const lyrics = sunoLyrics(lyric)
  const target = sunoTargetSec(lyric)
  try {
    const gr = await fetch(BASE + '/music/generate', {
      method: 'POST', headers: H,
      body: JSON.stringify({
        prompt: lyrics,
        tags: sunoTags(sid),
        make_instrumental: false,
        mv: 'chirp-hawk',
        title: String(lyric || '回声').slice(0, 20),
      }),
    })
    const gj = await gr.json().catch(() => null)
    const ids = gj && gj.data && gj.data.task_ids
    if (!gr.ok || !Array.isArray(ids) || !ids.length) {
      return { fail: true, debug: 'suno_gen ' + gr.status + ' ' + JSON.stringify(gj).slice(0, 160) }
    }
    // 轮询第一首: /music/task 实测只回 status(processing→completed/failed), 无百分比进度字段。
    //   旧版硬超时 36×5s=3min → 生成偶尔慢过 3min 就误判 timeout 失败(用户报"无法生成"根因之一)。
    //   现把上限拉到 6min(72×5s), status 仍 processing 就耐心等, 只有真失败/真超时才退级。
    const POLL_MS = 5000, POLL_MAX = 72
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise(r => setTimeout(r, POLL_MS))
      const qr = await fetch(BASE + '/music/task?id=' + ids[0], { headers: H })
      const qj = await qr.json().catch(() => null)
      const d = qj && qj.data
      if (!d) continue
      if (d.status === 'completed') {
        const fi = (d.result && d.result.fileInfo) || {}
        const url = fi.mp3Url || fi.wavUrl || fi.m4aUrl
        if (!url) return { fail: true, debug: 'suno_no_url' }
        const fullDur = Number(fi.duration) || 0
        const customId = d.result && d.result.custom_id
        // 人声起止(跑马灯跟唱词); 无对齐则退 0~target
        let vS = 0, vE = Math.min(fullDur || target, target)
        let alignWords = null
        if (customId) {
          const al = await sunoAlign({ apiKey, clipId: customId, lyrics })
          if (al && al.end > al.start) {
            vS = Math.max(0, al.start - 0.3)
            vE = Math.min(fullDur || al.end + 1, al.end + 0.8)
            alignWords = al.words || null
          }
        }
        // 过长就裁: 纯词两遍正常 ≤15s, 偶发长曲/长前奏 → 只留人声段
        if (customId && fullDur > 22 && vE > vS + 3) {
          const cropStart = Math.max(0, vS - 0.4)
          const cut = await sunoCrop({ apiKey, clipId: customId, startSec: cropStart, endSec: Math.min(fullDur, vE + 0.8) })
          if (cut && cut.audio && cut.audio.length > 800) {
            // 裁后文件从 0 起 = 人声起点; 逐词时间戳需减去裁剪起点(夹到 ≥0)
            const words = alignWords ? alignWords.map(w => ({ word: w.word, start: Math.max(0, w.start - cropStart), end: Math.max(0, w.end - cropStart) })) : null
            return { audio: cut.audio, duration: cut.duration || (vE - vS), mode: 'sing', model: 'suno', customId, chorusStart: 0, chorusEnd: cut.duration || (vE - vS), words }
          }
        }
        const ar = await fetch(url)
        if (!ar.ok) return { fail: true, debug: 'suno_dl ' + ar.status }
        const bytes = new Uint8Array(await ar.arrayBuffer())
        if (bytes.length < 1000) return { fail: true, debug: 'suno_short ' + bytes.length }
        return {
          audio: bytes,
          duration: fullDur,
          mode: 'sing',
          model: 'suno',
          customId,
          chorusStart: vS,
          chorusEnd: vE,
          words: alignWords,
        }
      }
      if (d.status === 'failed') {
        return { fail: true, debug: 'suno_fail ' + String((d.result && d.result.errormsg) || '').slice(0, 120) }
      }
    }
    return { fail: true, debug: 'suno_timeout' }
  } catch (e) {
    return { fail: true, debug: 'suno_ex ' + String(e && e.message || e).slice(0, 120) }
  }
}
async function minimaxGenerate({ apiKey, lyric, sid, masterUrl }) {
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  // 官方文档 servers: https://api.minimax.cn ; 兼容旧域名
  const hosts = ['https://api.minimax.cn', 'https://api.minimaxi.chat', 'https://api.minimax.chat']
  const lyrics = buildLyrics(lyric, sid)
  const prompt = stylePrompt(sid)
  const audioSetting = { sample_rate: 44100, bitrate: 256000, format: 'mp3' }
  const debug = []
  const finish = (hit, host, model) => {
    if (hit && hit.bytes) return { audio: hit.bytes, ext: 'mp3', duration: hit.duration || 0, structure: hit.structure, mode: 'sing', model, host }
    return null
  }
  // ── 1) 翻唱: preprocess → music-cover (官方两步; free 已停, 仍试付费档) ──
  if (masterUrl && sid !== 'acapella') {
    for (const host of hosts) {
      const pre = await tryJson(host + '/v1/music_cover_preprocess', auth, { model: 'music-cover', audio_url: masterUrl })
      const fid = pre.j && (pre.j.cover_feature_id || pre.j.data && pre.j.data.cover_feature_id)
      const structure = pre.j && (pre.j.structure_result || null)
      debug.push(host + ' preprocess=' + (pre.status) + ' fid=' + (fid ? 'y' : 'n') + ' ' + ((pre.j && pre.j.base_resp && pre.j.base_resp.status_msg) || pre.text || '').slice(0, 80))
      const coverBodies = []
      if (fid) {
        coverBodies.push({
          model: 'music-cover', prompt: (prompt || 'catchy pop vocal').slice(0, 280),
          cover_feature_id: fid, lyrics, stream: false,
          output_format: 'hex', audio_setting: audioSetting,
        })
      }
      coverBodies.push({
        model: 'music-cover', prompt: (prompt || 'catchy pop vocal').slice(0, 280),
        audio_url: masterUrl, lyrics, stream: false,
        output_format: 'hex', audio_setting: audioSetting,
      })
      for (const body of coverBodies) {
        const res = await tryJson(host + '/v1/music_generation', auth, body)
        const hit = parseMusicResp(res.j)
        debug.push(host + ' cover ' + body.model + ' ' + (hit && hit.code) + (hit && hit.msg ? ':' + String(hit.msg).slice(0, 60) : ''))
        const out = finish(hit, host, 'music-cover')
        if (out) { out.structure = out.structure || structure; out.debug = debug; return out }
      }
    }
  }
  // ── 2) 文本生成: music-3.0(付费推荐) → free 兜底(已停服但仍试) ──
  const textModels = ['music-3.0', 'music-2.6', 'music-3.0-free', 'music-2.6-free']
  for (const host of hosts) {
    for (const model of textModels) {
      const body = {
        model,
        prompt,
        lyrics,
        stream: false,
        output_format: 'hex',
        audio_setting: audioSetting,
        lyrics_optimizer: false,
        is_instrumental: false,
      }
      const res = await tryJson(host + '/v1/music_generation', auth, body)
      const hit = parseMusicResp(res.j)
      const msg = hit && hit.msg ? String(hit.msg).slice(0, 80) : ''
      debug.push(host + ' ' + model + ' ' + (hit && (hit.ok ? 'ok' : hit.code)) + (msg ? ':' + msg : ''))
      const out = finish(hit, host, model)
      if (out) { out.debug = debug; return out }
    }
  }
  return { fail: true, debug }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  try {
    const auth = req.headers.get('Authorization') || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    if (!token) return json({ ok: false, error: 'auth_required' }, 401)
    const body = await req.json().catch(() => ({}))
    const lyric = String(body.lyric || body.text || '').trim().slice(0, 60)
    const sid = String(body.sid || 'acapella').trim()
    const mid = body.mid != null ? String(body.mid) : ''
    const roomId = String(body.roomId || body.room_id || '')
    const masterUrl = String(body.masterUrl || '')
    if (!lyric) return json({ ok: false, error: 'missing_lyric' }, 400)

    const sbUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('SB_URL') || ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_ROLE_KEY') || Deno.env.get('SB_SERVICE_KEY') || ''
    if (!sbUrl || !serviceKey) return json({ ok: false, error: 'server_config' }, 500)

    const mmKey = Deno.env.get('MINIMAX_API_KEY') || Deno.env.get('MIFY_KEY') || ''
    const sunoKey = Deno.env.get('SUNO_API_KEY') || Deno.env.get('SUNO_ACCESS_KEY') || ''
    let audio = null, mode = 'none', duration = 0, structure = null, mmDebug = null, model = ''
    let sunoChS = 0, sunoChE = 0
    let wordTimestamps = null   // Suno 逐词对齐(供前端真实时间戳同步, MiniMax 音乐 API 无逐词对齐)
    // 1) Suno(付费/试用积分): 真唱歌首选
    if (sunoKey) {
      const su = await sunoGenerate({ apiKey: sunoKey, lyric, sid })
      if (su && su.audio && su.audio.length > 200) {
        audio = su.audio; mode = su.mode || 'sing'; duration = su.duration || 0; model = su.model || 'suno'
        sunoChS = su.chorusStart || 0; sunoChE = su.chorusEnd || 0
        wordTimestamps = Array.isArray(su.words) && su.words.length ? su.words : null
      } else if (su && su.debug) {
        mmDebug = [su.debug]
      }
    }
    // 2) MiniMax(老 key; 新用户已停)
    if (!audio && mmKey) {
      const mm = await minimaxGenerate({ apiKey: mmKey, lyric, sid, masterUrl })
      mmDebug = (mmDebug || []).concat(mm && mm.debug ? mm.debug.slice(0, 12) : [])
      if (mm && mm.audio && mm.audio.length > 200) {
        audio = mm.audio; mode = mm.mode || 'sing'; duration = mm.duration || 0; structure = mm.structure; model = mm.model || ''
      }
    }
    // 3) 兜底: 公网 TTS 人声(可叠母版)
    if (!audio) {
      const r = await fetch(sbUrl + '/functions/v1/eh-sing-tts', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: lyric, lyric, sid: 'acapella', format: 'pcm' }),
      })
      if (r.ok) {
        const j = await r.json()
        if (j && j.audio) {
          const raw = b64ToBytes(j.audio)
          const isPcm = /pcm|s16le/i.test(String(j.format || ''))
          audio = isPcm ? pcmToWav(raw, j.sample_rate || 24000, j.channels || 1) : raw
          mode = 'voice'
          duration = lyric.length * 0.32
        }
      }
    }
    if (!audio) return json({ ok: false, error: 'generate_failed', detail: 'tts_and_music_empty', mmDebug }, 502)

    let chS = 0, chE = 0
    // Suno 已裁剪: 跑马灯铺满裁后全曲(0~dur), 不再找 chorus 段
    if (model === 'suno' && sunoChE > 0) {
      chS = sunoChS; chE = sunoChE
    }
    try {
      let stObj = structure
      if (typeof stObj === 'string') stObj = JSON.parse(stObj)
      const segs = stObj && (stObj.segments || stObj.data && stObj.data.segments)
      const chorus = Array.isArray(segs) ? segs.find(x => String(x.label || '').toLowerCase().includes('chorus')) : null
      if (chorus && chorus.end > chorus.start) { chS = +chorus.start || 0; chE = +chorus.end || 0 }
      if (duration > 0 && chE > duration) { chE = duration; if (chE - chS < 8) chS = Math.max(0, chE - 8) }
    } catch { /* ignore */ }

    // 桶策略: eh-song 只收 Content-Type: audio/mpeg(校验头, 不看真实容器)。
    // Suno 回 m4a / TTS 回 wav, 都按 audio/mpeg 上传; 浏览器 <audio> 按魔数嗅探可播。
    const path = `songs/${roomId || 'public'}/${mid || ('gen_' + Date.now())}.mp3`
    const up = await fetch(`${sbUrl}/storage/v1/object/eh-song/${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'audio/mpeg',
        'x-upsert': 'true',
      },
      body: audio,
    })
    if (!up.ok) {
      return json({ ok: false, error: 'upload_failed', detail: (await up.text()).slice(0, 200) }, 500)
    }
    // 逐词对齐 sidecar: 与音频同路径写 <path>.lrc.json —— 消息 text 只存 5 段(URL 等), 逐词时间戳太大不入 text;
    //   改存桶里, 前端渲染缺 lrc 时按 <songUrl>.lrc.json 懒加载 → 生成者与其他玩家跟唱一致(修显示不一致)。
    if (wordTimestamps && wordTimestamps.length) {
      try {
        await fetch(`${sbUrl}/storage/v1/object/eh-song/${path}.lrc.json`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${serviceKey}`, apikey: serviceKey,
            'Content-Type': 'application/json', 'x-upsert': 'true',
          },
          body: JSON.stringify(wordTimestamps),
        })
      } catch (_) { /* sidecar 失败不挡主流程, 前端退均匀分布 */ }
    }
    const songUrl = `${sbUrl}/storage/v1/object/public/eh-song/${path}?t=${Date.now()}`
    if (mid && /^\d+$/.test(mid)) {
      const enc = [sid, encodeURIComponent(lyric), songUrl, String(chS || 0), String(chE || 0)].join('|')
      const upd = await fetch(`${sbUrl}/rest/v1/eh_messages?id=eq.${mid}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ text: enc }),
      })
      if (!upd.ok) return json({ ok: false, error: 'patch_failed', detail: (await upd.text()).slice(0, 200), songUrl }, 500)
    }
    return json({ ok: true, mode, model, songUrl, chorusStart: chS, chorusEnd: chE, duration, bytes: audio.length, mmDebug, wordTimestamps: wordTimestamps || undefined })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e && e.message || e) }, 500)
  }
})
