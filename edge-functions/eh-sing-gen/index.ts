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
    dj: 'EDM club drop', funk: 'groovy disco', jazz: 'smooth jazz lounge',
    gufeng: 'Chinese traditional', rnb: 'slow R&B soul', kid: 'cartoon kids song',
    acapella: 'human voice',
  }
  const hint = styleHint[sid] || 'catchy pop hook'
  const body = L.length < SHORT ? `${L} ${L}` : L
  return `[Chorus]\n${body}\n(oh yeah)`
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
function pickAudio(j) {
  const d = (j && j.data) || (j && j.audio) || j || {}
  const b64 = d.audio || d.audio_b64 || d.mp3 || j?.extra_info?.audio
  const url = d.audio_url || d.url || j?.audio_url
  return {
    b64: typeof b64 === 'string' && b64.length > 200 ? b64 : undefined,
    url: typeof url === 'string' ? url : undefined,
    duration: Number(d.duration || j?.duration || 0) || 0,
    structure: d.structure || j?.structure || null,
  }
}
async function minimaxGenerate({ apiKey, lyric, sid, masterUrl }) {
  const auth = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
  const prompt = wrapLyric(lyric, sid)
  const hosts = ['https://api.minimaxi.chat', 'https://api.minimax.chat']
  const paths = ['/v1/music_generation', '/v1/t2a_v2', '/v1/text_to_speech']
  const musicBodies = masterUrl ? [
    { model: 'music-1.5', stream: false, lyrics: prompt, output_format: 'mp3', reference_audio: masterUrl },
    { model: 'music-cover', stream: false, lyrics: prompt, master_url: masterUrl, prompt },
    { model: 'music-1.5', stream: false, lyrics: prompt, prompt },
  ] : [{ model: 'music-1.5', stream: false, lyrics: prompt, prompt }]
  const ttsBodies = [{
    model: 'speech-02-hd',
    text: lyric,
    voice_setting: { voice_id: 'female-yunqi', speed: 1.05, vol: 1.0, pitch: 0 },
    audio_setting: { sample_rate: 24000, bitrate: 128000, format: 'mp3' },
  }]
  for (const h of hosts) {
    for (const b of musicBodies) {
      const res = await tryJson(h + '/v1/music_generation', auth, b)
      if (!res.ok || !res.j) continue
      const p = pickAudio(res.j)
      if (p.b64) {
        const raw = b64ToBytes(p.b64)
        return { audio: raw, ext: 'mp3', duration: p.duration, structure: p.structure, mode: 'cover' }
      }
      if (p.url) {
        const a = await fetch(p.url)
        if (a.ok) return { audio: new Uint8Array(await a.arrayBuffer()), ext: 'mp3', duration: p.duration, structure: p.structure, mode: 'cover' }
      }
    }
    for (const b of ttsBodies) {
      for (const path of ['/v1/t2a_v2', '/v1/text_to_speech']) {
        const res = await tryJson(h + path, auth, b)
        if (!res.ok || !res.j) continue
        const p = pickAudio(res.j)
        if (p.b64) return { audio: b64ToBytes(p.b64), ext: 'mp3', duration: p.duration, mode: 'mm-tts' }
        if (p.url) {
          const a = await fetch(p.url)
          if (a.ok) return { audio: new Uint8Array(await a.arrayBuffer()), ext: 'mp3', duration: p.duration, mode: 'mm-tts' }
        }
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
          ext = isPcm ? 'wav' : 'mp3'
          mode = 'edge-tts'
          duration = lyric.length * 0.32
        }
      }
    }
    if (!audio) return json({ ok: false, error: 'generate_failed' }, 502)

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
