/**
 * eh-stt — 语音公网转写 Edge
 * 入口: POST { audio_b64, mime?, lang? } 或 multipart file
 * 策略: 1) MiniMax ASR(若配置) 2) 返回 use_browser_sr 指示前端用浏览器 SR
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ ok: false, error: 'method' }, 405)
  try {
    const auth = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!auth) return json({ ok: false, error: 'auth_required' }, 401)
    let audioB64 = '', mime = 'audio/webm', lang = 'zh-CN'
    const ct = req.headers.get('Content-Type') || ''
    if (ct.includes('application/json')) {
      const body = await req.json().catch(() => ({}))
      audioB64 = String(body.audio_b64 || body.audio || '')
      mime = String(body.mime || 'audio/webm')
      lang = String(body.lang || 'zh-CN')
    } else {
      const fd = await req.formData().catch(() => null)
      const f = fd && fd.get('file')
      if (f && typeof f.arrayBuffer === 'function') {
        const ab = await f.arrayBuffer()
        let s = ''
        const bytes = new Uint8Array(ab)
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
        audioB64 = btoa(s)
        mime = f.type || mime
      }
    }
    if (!audioB64) return json({ ok: false, error: 'missing_audio' }, 400)

    const mmKey = Deno.env.get('MINIMAX_API_KEY') || Deno.env.get('MIFY_KEY') || ''
    if (mmKey) {
      // MiniMax speech recognition / audio understanding (兼容多端点)
      const candidates = [
        {
          url: 'https://api.minimaxi.chat/v1/audio/transcriptions',
          body: { model: 'whisper-1', file: audioB64, language: lang },
        },
        {
          url: 'https://api.minimax.chat/v1/audio/transcriptions',
          body: { model: 'whisper-1', file: audioB64, language: lang },
        },
        {
          url: 'https://api.minimaxi.chat/v1/audio_understanding',
          body: { model: 'abab6.5s-chat', audio: audioB64, prompt: '请把语音转成中文文字，只输出转写结果' },
        },
      ]
      for (const c of candidates) {
        try {
          const r = await fetch(c.url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${mmKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(c.body),
          })
          const t = await r.text()
          let j = null
          try { j = JSON.parse(t) } catch { /* noop */ }
          if (!r.ok || !j) continue
          const text = j.text || j.transcript || j.data?.text || j.choices?.[0]?.message?.content || ''
          if (text && String(text).trim()) return json({ ok: true, text: String(text).trim(), provider: 'minimax' })
        } catch { /* next */ }
      }
    }
    // 公网可用回退: 前端浏览器 SpeechRecognition
    return json({ ok: false, fallback: 'browser_sr', reason: 'cloud_stt_unavailable' }, 200)
  } catch (e) {
    return json({ ok: false, error: 'exception', detail: String(e && e.message || e) }, 500)
  }
})
