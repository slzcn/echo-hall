/**
 * eh-sing-gen — 文字神曲统一公网谱曲 Edge(零外部依赖, 仅用 fetch)
 * 主路径 MiniMax; 兜底 eh-sing-tts; 上传桶 + PATCH 消息。
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
function wrapLyric(lyric, sid) {
  const L = String(lyric || '').trim()
  const SHORT = 8
  const styleHint = {
    dj: 'EDM club drop with vocals', funk: 'groovy disco funk song with vocals',
    jazz: 'smooth jazz vocal song', gufeng: 'Chinese traditional vocal ballad',
    rnb: 'slow R&B soul vocal', kid: 'cartoon kids vocal song',
    acapella: 'human voice singing acapella',
  }
  const hint = styleHint[sid] || 'catchy pop vocal song'
  const body = L.length < SHORT ? `${L}\n${L}` : L
  // MiniMax music-1.5 认 [Verse]/[Chorus] 结构; 要唱不要念
  return `[Verse]\n${body}\n\n[Chorus]\n${body}\n${body}`
}
function decodeAudioPayload(raw) {
  if (!raw) return null
  const s = String(raw)
  // hex-encoded mp3/wav
  if (/^[0-9a-fA-F]+$/.test(s) && s.length > 400 && s.length % 2 === 0) {
    const out = new Uint8Array(s.length / 2)
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16)
    return out
  }
  // base64
  try {
    return b64ToBytes(s)
  } catch { return null }
}
function pickAudio(j) {
  const d = (j && (j.data || j.audio || j.payload)) || j || {}
  const nested = d.data || {}
  const raw = d.audio || d.audio_b64 || d.mp3 || nested.audio || j?.extra_info?.audio || j?.data?.audio
  const url = d.audio_url || d.url || nested.audio_url || j?.audio_url
  const bytes = typeof raw === 'string' ? decodeAudioPayload(raw) : null
  return {
    bytes: bytes && bytes.length > 200 ? bytes : undefined,
    url: typeof url === 'string' ? url : undefined,
    duration: Number(d.duration || nested.duration || j?.duration || 0) || 0,
    structure: d.structure || nested.structure || j?.structure || null,
    taskId: d.task_id || d.taskId || j?.task_id || j?.data?.task_id || null,
    traceId: j?.trace_id || null,
  }
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
async function fetchAudioUrl(url) {
  const a = await fetch(url)
  if (!a.ok) return null
  return new Uint8Array(await a.arrayBuffer())
}
async function minimaxGenerate({ apiKey, lyric, sid, masterUrl }) {
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const lyrics = wrapLyric(lyric, sid)
  const genre = ({
    dj: 'EDM dance club', funk: 'funk disco groove', jazz: 'jazz lounge',
    gufeng: 'Chinese traditional guzheng', rnb: 'R&B soul', kid: 'kids cartoon',
    acapella: 'a cappella human voice',
  })[sid] || 'catchy pop'
  const hosts = ['https://api.minimaxi.chat', 'https://api.minimax.chat']
  const musicBodies = [
    // 官方 music-1.5: prompt=风格, lyrics=结构化歌词(唱)
    { model: 'music-1.5', prompt: `${genre}, professional studio, clear lead vocals`, lyrics, stream: false,
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3' } },
    { model: 'music-1.5', prompt: genre, lyrics, stream: false },
    // cover 形态
    masterUrl ? { model: 'music-1.5', prompt: genre, lyrics, stream: false, reference_audio: masterUrl } : null,
    masterUrl ? { model: 'music-cover', prompt: `${genre}, vocals`, lyrics, master_url: masterUrl, stream: false } : null,
  ].filter(Boolean)
  const ttsBodies = [{
    model: 'speech-02-hd',
    text: lyric,
    voice_setting: { voice_id: 'female-yunqi', speed: 0.92, vol: 1.0, pitch: 1.05 },
    audio_setting: { sample_rate: 24000, bitrate: 128000, format: 'mp3' },
  }]
  const settle = async (p) => {
    if (!p) return null
    if (p.bytes) return { audio: p.bytes, ext: 'mp3', duration: p.duration, structure: p.structure, mode: 'sing' }
    if (p.url) {
      const b = await fetchAudioUrl(p.url)
      if (b && b.length > 200) return { audio: b, ext: 'mp3', duration: p.duration, structure: p.structure, mode: 'sing' }
    }
    return null
  }
  for (const h of hosts) {
    for (const body of musicBodies) {
      const res = await tryJson(h + '/v1/music_generation', auth, body)
      if (!res.ok || !res.j) continue
      const p = pickAudio(res.j)
      const hit = await settle(p)
      if (hit) return hit
      // 异步任务: 轮询结果
      if (p.taskId) {
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 2000))
          const q = await fetch(`${h}/v1/query/video_generation?task_id=${p.taskId}`, { headers: auth }).then(r => r.json()).catch(() => null)
            || await fetch(`${h}/v1/music_generation/query?task_id=${p.taskId}`, { headers: auth }).then(r => r.json()).catch(() => null)
          const pq = pickAudio(q)
          const hit2 = await settle(pq)
          if (hit2) return hit2
          if (q && (q.status === 'Fail' || q.status === 'failed')) break
        }
      }
    }
  }
  // 音乐失败 → 不再用「念课文」冒充唱歌; 只在显式 acapella 时退回 TTS 人声
  if (sid === 'acapella') {
    for (const h of hosts) {
      for (const path of ['/v1/t2a_v2', '/v1/text_to_speech']) {
        const res = await tryJson(h + path, auth, ttsBodies[0])
        if (!res.ok || !res.j) continue
        const p = pickAudio(res.j)
        const hit = await settle(p)
        if (hit) return { ...hit, mode: 'voice' }
      }
    }
  }
  return null
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
    let audio = null, ext = 'wav', mode = 'none', duration = 0, structure = null
    if (mmKey) {
      const mm = await minimaxGenerate({ apiKey: mmKey, lyric, sid, masterUrl })
      if (mm && mm.audio && mm.audio.length > 200) {
        audio = mm.audio; ext = mm.ext; mode = mm.mode; duration = mm.duration || 0; structure = mm.structure
      }
    }
    if (!audio) {
      // 公网兜底(主人: 现在要「能生成成功」): 所有曲风都可退回 TTS 人声,
      // 真 AI 唱歌仍取决于 MINIMAX_API_KEY 是否为有效 JWT; 密钥无效时至少出声、可播。
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
          ext = 'mp3'
          mode = 'voice'
          duration = lyric.length * 0.32
        }
      }
    }
    if (!audio) return json({ ok: false, error: 'generate_failed', detail: 'tts_and_music_empty' }, 502)

    let chS = 0, chE = 0
    try {
      const segs = structure && (structure.segments || structure.data?.segments)
      const chorus = Array.isArray(segs) ? segs.find(x => String(x.label || '').toLowerCase().includes('chorus')) : null
      if (chorus && chorus.end > chorus.start) { chS = +chorus.start || 0; chE = +chorus.end || 0 }
      if (duration > 0 && chE > duration) { chE = duration; if (chE - chS < 8) chS = Math.max(0, chE - 8) }
    } catch { /* ignore */ }

    const path = `songs/${roomId || 'public'}/${mid || ('gen_' + Date.now())}.mp3`
    // 桶 allowed_mime_types 仅 audio/mpeg|audio/mp3 → 一律按 mpeg 上传
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
      const t = await up.text()
      return json({ ok: false, error: 'upload_failed', detail: t.slice(0, 200) }, 500)
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
      const ut = await upd.text()
      if (!upd.ok) return json({ ok: false, error: 'patch_failed', detail: ut.slice(0, 200), songUrl }, 500)
    }
    return json({ ok: true, mode, songUrl, chorusStart: chS, chorusEnd: chE, duration, bytes: audio.length })
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e && e.message || e) }, 500)
  }
})
