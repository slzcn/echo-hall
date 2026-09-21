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
    let audio = null, mode = 'none', duration = 0, structure = null, mmDebug = null, model = ''
    if (mmKey) {
      const mm = await minimaxGenerate({ apiKey: mmKey, lyric, sid, masterUrl })
      mmDebug = mm && mm.debug ? mm.debug.slice(0, 12) : null
      if (mm && mm.audio && mm.audio.length > 200) {
        audio = mm.audio; mode = mm.mode || 'sing'; duration = mm.duration || 0; structure = mm.structure; model = mm.model || ''
      }
    }
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
    try {
      let stObj = structure
      if (typeof stObj === 'string') stObj = JSON.parse(stObj)
      const segs = stObj && (stObj.segments || stObj.data && stObj.data.segments)
      const chorus = Array.isArray(segs) ? segs.find(x => String(x.label || '').toLowerCase().includes('chorus')) : null
      if (chorus && chorus.end > chorus.start) { chS = +chorus.start || 0; chE = +chorus.end || 0 }
      if (duration > 0 && chE > duration) { chE = duration; if (chE - chS < 8) chS = Math.max(0, chE - 8) }
    } catch { /* ignore */ }

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
    return json({ ok: true, mode, model, songUrl, chorusStart: chS, chorusEnd: chE, duration, bytes: audio.length, mmDebug })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e && e.message || e) }, 500)
  }
})
