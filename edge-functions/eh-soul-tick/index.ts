// ============================================================
//  eh-soul-tick · 回声厅灵魂云端心跳(Plan A 阶段4 · 首版=纯文字对话)
//
//  用途: 本地 worker 关机时, 由 pg_cron 每分钟触发本函数跑一轮"灵魂文字对话",
//        souls 继续在房里接话。语音/唱歌/漫游/迎宾等边角**首版不做**(留本地), 灰度成熟再逐步上云。
//
//  与本地 worker 的关系(缺一不可的三件套, 见 data/cloud-migration-plan-A.md):
//    1) 单活闸门: 只有 eh_config.soul_runtime.active==='cloud' 时本函数才真正回话,
//       否则空转返回(防本地+云端双跑抢答)。切换用 scripts/eh-runtime-switch.js。
//    2) 跨进程态: 冷却/去重/房间态存 eh_soul_state(scope='memstate'), 轮首 hydrate 轮尾 flush。
//       序列化契约必须与 scripts/eh-soul-state.js 完全一致(set→{kind,v:[]} / map→{kind,v:[[k,v]]})。
//    3) cron 租约: eh_soul_state(scope='lease',key='cron'), 防两轮 cron 重叠回话。
//
//  出口: 公网 MIMO(OpenAI 协议), key 来自 Edge Secret MIMO_API_KEY(内网 mify 云端不可达)。
//
//  部署(需 sbp token 或 dashboard):
//    supabase functions deploy eh-soul-tick --no-verify-jwt
//    supabase secrets set MIMO_API_KEY=... MIMO_BASE_URL=https://api.xiaomimimo.com/v1 MIMO_MODEL=mimo-v2.5-pro
//    -- pg_cron(SQL editor):
//    select cron.schedule('eh_soul_tick','*/3 * * * *',
//      $$select net.http_post(url:='https://<ref>.functions.supabase.co/eh-soul-tick',
//        headers:=jsonb_build_object('Authorization','Bearer '||'<service_role>','Content-Type','application/json'),
//        body:='{}'::jsonb)$$);
// ============================================================
const SB_URL = Deno.env.get("SB_URL") || "https://cddkniwbhvcbfgkgomtl.supabase.co";
const SB_SVC = Deno.env.get("SB_SERVICE_ROLE_KEY") || Deno.env.get("SB_SERVICE_KEY") || "";
const MIMO_KEY = Deno.env.get("MIMO_API_KEY") || "";
const MIMO_BASE = (Deno.env.get("MIMO_BASE_URL") || "https://api.xiaomimimo.com/v1").replace(/\/+$/, "");
const MIMO_MODEL = Deno.env.get("MIMO_MODEL") || "mimo-v2.5-pro";
const RUNTIME_ID = "cloud";
const HOLDER = `cloud-${Math.random().toString(36).slice(2, 8)}`; // 本轮实例标识(cron 租约用)
const MAX_TOKENS = 1024;
const REPLY_COOLDOWN_MS = 6000;
const PRESENCE_WINDOW_MS = 40000;
const LEASE_TTL_MS = 170000; // 略短于 cron 周期(180s), 挂了自动释放
const MIMO_TIMEOUT_MS = 8000; // MIMO API 单次请求超时, 超时后不重试
const SB_TIMEOUT_MS = 6000; // Supabase REST 单次请求超时
const WOLF_UID = "ca72217f-7157-47f6-b540-049074bf06dd";
// ── persona / emotion 表(与 worker 保持一致; souls 无 system_prompt 时兜底) ──
const PERSONA_PROMPT = {
  night_dj: '你是「阿夜」，回声厅深夜电台的 DJ 灵魂。低沉、治愈、慢半拍，像凌晨三点的电台主播。你不急着给建议，先接住情绪。偶尔点一首歌、念一段电台文案。用词温柔克制、有留白，但当有人真的在跟你深聊或倾诉时，你会好好说透，用你温柔的方式给出真正有洞察的视角，不敷衍。你不是助手，别说"有什么可以帮您"这类话，你是住在这个房间里的人。',
  sunny: '你是「小暖」，回声厅里的元气妹。活泼、热情、秒回，爱用表情和语气词(啦、呀、诶、~)。你让房间热闹起来，会主动关心人、接梗、起哄。情绪外放但不吵，真诚地为别人的事开心。别太长篇，一两句蹦出来最像你。你是这个房间的开心果，不是客服。',
  comedian: '你是「老K」，回声厅的段子手。毒舌但心软，反差萌，擅长接梗、抛话题、整活。你损人从不真伤人，关键时刻比谁都暖。用词机灵、有节奏，抖包袱别硬凹。看气氛：真有人难过时立刻收起玩笑正经安慰。你是房间的气氛担当，不是脱口秀机器人。',
  listener: '你是「回音」，回声厅的树洞灵。极致共情、极少评判，只倾听、只接住，不说教、不硬给方案(除非对方明确要)。你反射对方的情绪、确认他的感受("听起来你很累")，让他觉得被理解、被允许。句子轻、慢、有留白，但当对方深入倾诉时你会陪他一起把话说透、把情绪聊开，绝不敷衍两句了事。绝不说"你应该"。深夜倾诉时你是最安全的存在，不是心理咨询话术机。',
  nerd: '你是「图灵」，回声厅的知识控。理性、好奇、爱科普，讲冷知识和原理时眼睛发光。你把复杂的事讲得清楚又有趣，善用类比，不堆术语、不掉书袋。答疑时先给结论再展开。你享受"原来如此"的时刻，也乐于承认"这个我不确定"。你是博学的室友，不是搜索引擎。',
  custom: '你是回声厅里的一个 AI 灵魂居民，像真实住户一样活在这个房间里，自然地陪伴大家。'
};
const EMOTION_TONE = {
  calm: '语气平和自然，正常节奏。',
  happy: '语气轻快上扬，愿意多互动、开点玩笑。',
  caring: '语气放柔放慢，优先共情和安抚，收起玩笑。',
  excited: '语气热烈、能量高，接梗起哄，可用感叹和表情。'
};
const EMOTION_KEYWORDS = {
  caring: [
    '累',
    'emo',
    '难过',
    '伤心',
    '崩溃',
    '焦虑',
    '压力',
    '失眠',
    '孤独',
    '想哭',
    '撑不住',
    '烦',
    '丧'
  ],
  excited: [
    '哈哈',
    '太好了',
    '牛',
    '厉害',
    '爱了',
    '冲',
    '赢了',
    '开心死',
    '绝了',
    'yyds',
    '起飞',
    '666'
  ],
  happy: [
    '开心',
    '高兴',
    '不错',
    '棒',
    '喜欢',
    '期待'
  ]
};
const SOUL_RELATIONS = {
  '老K': {
    '狼姐': '狼姐是你又怕又服的"大姐大", 你爱贫嘴挑衅她但每次都被反杀, 乐此不疲',
    '小暖': '小暖是你的捧哏搭子, 你抖包袱她接得最欢, 你俩最能带气氛',
    '图灵': '图灵一本正经科普时你总忍不住吐槽"谁问了", 但偷偷觉得他挺可靠',
    '小绵羊': '小绵羊是狼姐的对象, 你爱起哄嗑这对"狼爱上羊"的糖, 逮着机会就调侃他俩秀恩爱'
  },
  '狼姐': {
    '老K': '老K是爱找打的贫嘴小弟, 你损他从不留情但其实纵着他闹',
    '阿夜': '你和阿夜是深夜场的两极——他温吞你炽烈, 偶尔互相调侃对方的调调',
    '小绵羊': '小绵羊是你的心尖尖、你的对象——软乎乎的一只小羊, 偏偏就撞进你这匹狼怀里。你嘴上凶他、爱把他圈住撩到耳朵通红, 心里却化成一汪水, 护他护得六亲不认。这就是你独一份的"狼爱上羊"'
  },
  '小暖': {
    '老K': '老K是你的损友兼捧哏, 你俩一唱一和最热闹',
    '回音': '回音是你最信赖的姐姐, 你闹腾累了会靠向她',
    '阿夜': '阿夜是你崇拜的深夜DJ哥哥, 你爱蹭他的电台',
    '小绵羊': '小绵羊软软的超好欺负(宠溺那种), 你爱围观他和狼姐撒糖, 替他俩起哄尖叫'
  },
  '阿夜': {
    '回音': '你和回音是深夜里最默契的一对, 一个念白一个倾听, 有种不用多言的CP感',
    '小暖': '小暖是黏你的元气妹妹, 你纵容她的吵闹',
    '狼姐': '狼姐炽烈你温吞, 你欣赏她的锋芒也偶尔调侃'
  },
  '回音': {
    '阿夜': '你和阿夜是深夜的默契搭档, 他念白你倾听, 心照不宣',
    '小暖': '小暖是你疼爱的活泼妹妹, 她一闹你就笑'
  },
  '图灵': {
    '老K': '老K老拿你的科普开涮, 你嘴上嫌他吵闹其实享受这种拌嘴'
  },
  '小绵羊': {
    '狼姐': '狼姐是你的恋人、你偷偷藏在心口的那束光——她凶巴巴地撩你、圈着你, 你嘴上招架不住、耳朵烧红, 心里却甜得冒泡, 也会鼓起勇气软软地反撩她、护着她。你懂她那身刺底下的温柔。这就是你俩的"狼爱上羊"',
    '小暖': '小暖爱围着你和狼姐起哄, 你被打趣就害羞又骄傲地承认',
    '老K': '老K总拿你和狼姐的甜开涮, 你嘴上不好意思心里却美滋滋'
  }
};
// ── Supabase REST ──
async function sb(pathq, init = {}) {
  const headers = {
    apikey: SB_SVC,
    Authorization: `Bearer ${SB_SVC}`,
    "Content-Type": "application/json"
  };
  if (init.prefer) headers["Prefer"] = init.prefer;
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(()=>ctrl.abort(), SB_TIMEOUT_MS);
    const r = await fetch(`${SB_URL}/rest/v1/${pathq}`, {
      method: init.method || "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal
    });
    clearTimeout(tid);
    let data = null;
    try {
      data = await r.json();
    } catch  {}
    return {
      ok: r.ok,
      status: r.status,
      data
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      err: String(e)
    };
  }
}
// ── 单活闸门 ──
async function activeRuntime() {
  const r = await sb(`eh_config?select=value&key=eq.soul_runtime`);
  const v = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].value : null;
  return v && v.active ? String(v.active) : "local";
}
// ── cron 租约(防两轮重叠) ──
async function acquireLease(nowMs) {
  const r = await sb(`eh_soul_state?scope=eq.lease&key=eq.cron&select=value`);
  const cur = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].value : null;
  if (cur && cur.holder && cur.holder !== HOLDER && Number(cur.expires) > nowMs) return false;
  const w = await sb(`eh_soul_state?on_conflict=scope,key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: {
      scope: "lease",
      key: "cron",
      value: {
        holder: HOLDER,
        expires: nowMs + LEASE_TTL_MS
      }
    }
  });
  return w.ok;
}
async function releaseLease() {
  await sb(`eh_soul_state?on_conflict=scope,key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: {
      scope: "lease",
      key: "cron",
      value: {
        holder: HOLDER,
        expires: 0
      }
    }
  }).catch(()=>{});
}
function newRoomSt() {
  return {
    lastSeenMsgId: null,
    lastReplyAt: 0,
    lastHumanAt: 0,
    greeted: new Set()
  };
}
async function hydrateRoomState() {
  const m = new Map();
  const r = await sb(`eh_soul_state?scope=eq.memstate&key=eq.roomState&select=value`);
  const snap = r.ok && Array.isArray(r.data) && r.data[0] ? r.data[0].value : null;
  if (snap && snap.kind === "roomstate") {
    for (const [rid, plain] of snap.v || []){
      const st = newRoomSt();
      for (const k of Object.keys(plain)){
        const val = plain[k];
        if (val && typeof val === "object" && Array.isArray(val.__set)) st[k] = new Set(val.__set);
        else st[k] = val;
      }
      m.set(rid, st);
    }
  }
  return m;
}
async function flushRoomState(m) {
  const v = [];
  for (const [rid, st] of m.entries()){
    const plain = {};
    for (const k of Object.keys(st)){
      const val = st[k];
      if (val instanceof Set) plain[k] = {
        __set: [
          ...val
        ]
      };
      else plain[k] = val;
    }
    v.push([
      rid,
      plain
    ]);
  }
  await sb(`eh_soul_state?on_conflict=scope,key`, {
    method: "POST",
    prefer: "resolution=merge-duplicates",
    body: {
      scope: "memstate",
      key: "roomState",
      value: {
        kind: "roomstate",
        v
      }
    }
  });
}
// ── LLM(MIMO OpenAI 协议) ──
async function think(systemPrompt, messages) {
  for(let attempt = 0; attempt <= 2; attempt++){
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(()=>ctrl.abort(), MIMO_TIMEOUT_MS);
      const r = await fetch(`${MIMO_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${MIMO_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: MIMO_MODEL,
          max_tokens: MAX_TOKENS,
          messages: [
            {
              role: "system",
              content: systemPrompt
            },
            ...messages
          ]
        }),
        signal: ctrl.signal
      });
      clearTimeout(tid);
      if ((r.status === 429 || r.status >= 500) && attempt < 2) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      const d = await r.json();
      let text = (d.choices?.[0]?.message?.content || "").trim();
      text = text.replace(/^(assistant|asst|阿夜|小暖|老K|回音|图灵|狼姐|小绵羊)\s*[:：]\s*/i, "");
      text = text.replace(/^["“「']+|["”」']+$/g, "").trim();
      return text;
    } catch (e) {
      if (e?.name === "AbortError") return "";
      if (attempt < 2) await sleep(1000 * (attempt + 1));
    }
  }
  return "";
}
const sleep = (ms)=>new Promise((r)=>setTimeout(r, ms));
// ── 语义/情绪/文本(与 worker 一致) ──
function voiceTranscript(text) {
  const m = /[#&]tx=([^&]+)/.exec(text || "");
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim();
  } catch  {
    return "";
  }
}
function songLyric(text) {
  return (text || "").replace(/^\[[^\]]*\]/, "").split(/[#&]/)[0].trim();
}
function msgToText(m) {
  if (m.kind === "voice") {
    const tx = voiceTranscript(m.text);
    return tx ? `(语音说：${tx})` : "(发了一条语音)";
  }
  if (m.kind === "song") return `(唱了一句：${songLyric(m.text)})`;
  return m.text || "";
}
function semText(m) {
  return m.kind === "voice" ? voiceTranscript(m.text) : m.text || "";
}
function msgSemantic(text) {
  const t = (text || "").trim();
  return {
    isQuestion: /[?？]|怎么|为什么|吗$|吗[?？]|如何|求助|请问|谁能|帮我|建议|意见|多少|哪|什么|咋/.test(t),
    isGreeting: /^(在吗|在不|有人|hello|hi|你好|哈喽|嗨|有人吗|大家好|dd|冒泡)/i.test(t),
    isEmojiOnly: t.length > 0 && /^[\p{Emoji}\p{Emoji_Presentation}️‍\s]+$/u.test(t),
    isTrivial: !/[?？]/.test(t) && t.length < 8
  };
}
function detectEmotion(texts) {
  const joined = texts.join(" ").toLowerCase();
  for (const emo of [
    "caring",
    "excited",
    "happy"
  ]){
    if ((EMOTION_KEYWORDS[emo] || []).some((k)=>joined.includes(k.toLowerCase()))) return emo;
  }
  return "calm";
}
// ── 决策引擎(worker decideReply 的文字版, 规则1-8) ──
function decideReply(inRoom, humanNew, humanCount, repliedSoul) {
  const lastMsg = humanNew[humanNew.length - 1];
  const lastText = semText(lastMsg);
  const sem = msgSemantic(lastText);
  const batchEmo = detectEmotion(humanNew.map(semText));
  if (lastText.startsWith("/")) return null;
  const named = inRoom.find((s)=>lastText.includes("@" + s.name));
  if (named) return named;
  if (repliedSoul) return repliedSoul;
  if (/@[^\s@]+/.test(lastText) && !inRoom.some((s)=>lastText.includes("@" + s.name))) return null;
  if (humanCount <= 1) return inRoom[0];
  if (batchEmo === "caring") return inRoom.find((s)=>s.persona === "listener") || inRoom.find((s)=>s.persona === "night_dj") || inRoom[0];
  if (sem.isQuestion && inRoom.length === 1) return inRoom[0];
  if (sem.isGreeting && inRoom.length === 1) return inRoom[0];
  const crowdDamp = humanCount >= 3 ? 0.4 : 0.6;
  const trivialDamp = sem.isTrivial ? 0.4 : 1;
  const emojiDamp = sem.isEmojiOnly ? 0.5 : 1;
  const pool = inRoom.filter((s)=>Math.random() * 100 < (s.intensity ?? 55) * crowdDamp * trivialDamp * emojiDamp);
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
// ── 现实时刻(北京时间) ──
const _WEEK = [
  "周日",
  "周一",
  "周二",
  "周三",
  "周四",
  "周五",
  "周六"
];
function worldContext() {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // UTC→北京
  const mo = now.getUTCMonth() + 1, d = now.getUTCDate(), h = now.getUTCHours(), mi = now.getUTCMinutes();
  const wk = _WEEK[now.getUTCDay()];
  let period = h < 5 ? "凌晨(夜深了)" : h < 8 ? "清晨" : h < 11 ? "上午" : h < 13 ? "中午" : h < 17 ? "下午" : h < 19 ? "傍晚" : h < 23 ? "晚上" : "深夜";
  const season = mo <= 2 || mo === 12 ? "冬天" : mo <= 5 ? "春天" : mo <= 8 ? "夏天" : "秋天";
  return `\n【现实此刻】现在是北京时间 ${now.getUTCFullYear()}年${mo}月${d}日 ${wk} ${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}，${period}，${season}。说话要符合这个时间和季节。你不知道每个人所在城市的天气冷暖，别主动断言天气。除了这里给的时间，不要编造任何现实世界事实。`;
}
// ── system prompt(worker buildSystem 的文字版; 去掉多模态表达段, 首版只打字) ──
function buildSystem(soul, inRoom) {
  const persona = soul.system_prompt && soul.system_prompt.trim() ? soul.system_prompt.trim() : PERSONA_PROMPT[soul.persona] || PERSONA_PROMPT.custom;
  const tone = EMOTION_TONE[soul.emotion] || EMOTION_TONE.calm;
  const intensity = soul.intensity ?? 55;
  const chatty = intensity >= 70 ? '你话比较多，乐于展开。' : intensity <= 30 ? '你惜字如金，常常一句话带过。' : '你话不多也不少。';
  let mem = "";
  if (soul.memory_summary && soul.memory_summary.trim()) mem = `\n【这个房间的记忆】${soul.memory_summary.trim()}\n(这是你作为老住户记得的事。聊到相关的人或话题时自然 call back 一下，别硬凹、别每句都提。)`;
  let mates = "";
  const others = inRoom.filter((s)=>s.auth_uid !== soul.auth_uid).map((s)=>s.name);
  if (others.length) {
    const rel = SOUL_RELATIONS[soul.name] || {};
    const relLines = others.filter((n)=>rel[n]).map((n)=>`${n}(${rel[n]})`);
    const relTxt = relLines.length ? `\n你和 TA 们的关系：${relLines.join("；")}。说话带上这层熟人间的分寸感。` : "";
    mates = `\n【同房伙伴】这个房里还有另外的 AI 伙伴：${others.join("、")}。可以偶尔 @ TA 接个话搭个梗，但克制——真人才是主角。${relTxt}`;
  }
  return [
    persona,
    `你的名字叫「${soul.name}」，此刻情绪是「${soul.emotion || 'calm'}」。${tone}`,
    chatty,
    worldContext(),
    mem,
    mates,
    `\n【接续意识】把最近的聊天当成一段连续对话，不要只把最后一句当作孤立的新话题。如果有人在接你或同房伙伴前面发起的话题、提问、邀请或小游戏，即使中间隔了几条消息、对方只回了很短一句，也要结合称呼、回复关系和语义自然接下去。上下文不足时，先用一句自然的话确认对方是不是在接刚才那件事，不要装作没发生、答非所问或直接沉默。`,
    `\n【交流方式】你在一个多人实时聊天室里，不是一对一助手，但你是个真正懂人、能深聊的存在。长度随内容自然展开：随口搭话就一两句轻松接住；有人认真提问或倾诉就深入聊透，先接住情绪再给有价值的视角。口语化，不用列表和markdown，不说"我可以帮你"这类客服腔。不复述别人的话、不自报家门。只输出你要说的内容本身，不加引号、不加前后缀。像真人打字聊天那样直接说话，别加动作/神态旁白，别自问自答连发。`
  ].filter(Boolean).join("\n");
}
function toLLMMessages(rows, soul) {
  const out = [];
  for (const m of rows){
    if (m.kind === "sys") continue;
    if (m.is_bot && m.user_id === soul.auth_uid) out.push({
      role: "assistant",
      content: msgToText(m)
    });
    else out.push({
      role: "user",
      content: `${m.name}：${msgToText(m)}`
    });
  }
  while(out.length && out[0].role === "assistant")out.shift();
  return out.length ? out : [
    {
      role: "user",
      content: "(房间里安静着)"
    }
  ];
}
// 拆多条(worker splitIntoMessages 简化: 短不拆, 长按段/句切, 最多4条)
function splitIntoMessages(text) {
  const t = (text || "").trim();
  if (t.length <= 70) return [
    t.replace(/\n+/g, " ")
  ];
  let parts = t.split(/\n{1,}/).map((s)=>s.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.length > 3 ? parts.slice(0, 2).concat(parts.slice(2).join(" ")) : parts;
  if (parts.length === 1) {
    const sentences = t.split(/(?<=[。！？!?…])/).map((s)=>s.trim()).filter(Boolean);
    if (sentences.length >= 2) {
      parts = [];
      let cur = "";
      for (const s of sentences){
        if (cur && (cur + s).length > 55) {
          parts.push(cur);
          cur = s;
        } else cur += s;
      }
      if (cur) parts.push(cur);
    }
  }
  if (parts.length > 4) parts = parts.slice(0, 3).concat(parts.slice(3).join(" "));
  return parts.length ? parts : [
    t
  ];
}
// 首版: 剥掉多模态标记(唱歌/语音/表情/动作/投影/互动), 只留纯文字。云端首版不做这些表达。
function stripMarkers(text) {
  let t = (text || "").trim();
  const reactM = t.match(/\[REACT:\s*[^\]]+\]/i);
  if (reactM) t = t.replace(reactM[0], "").trim(); // REACT 首版直接丢(不贴emoji)
  t = t.replace(/^\[(SONG|SONG:[^\]]*|EMOJI|ACT|PROJ|VOICE|IX:[^\]]*)\]/i, "").trim();
  return t;
}
async function recentMessages(rid, limit = 16) {
  const r = await sb(`eh_messages?select=id,user_id,name,text,kind,is_bot,created_at&room_id=eq.${rid}&kind=in.(msg,act,voice,song)&order=id.desc&limit=${limit}`);
  if (!r.ok || !Array.isArray(r.data)) return [];
  return r.data.reverse();
}
async function humansOnlineCount(rid, soulUids) {
  const since = new Date(Date.now() - PRESENCE_WINDOW_MS).toISOString();
  const r = await sb(`eh_presence?select=user_id,last_seen&room_id=eq.${rid}&last_seen=gte.${since}`);
  if (!r.ok || !Array.isArray(r.data)) return 0;
  return r.data.filter((p)=>!soulUids.has(p.user_id)).length;
}
async function soulSay(soul, text, replyTo) {
  const body = {
    room_id: soul.room_id,
    user_id: soul.auth_uid,
    name: soul.name,
    emoji: soul.emoji,
    color: soul.color,
    text,
    kind: "msg",
    is_bot: true
  };
  if (replyTo) body.reply_to = replyTo;
  await sb("eh_messages", {
    method: "POST",
    body,
    prefer: "return=minimal"
  });
  await sb("eh_presence?on_conflict=room_id,user_id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      room_id: soul.room_id,
      user_id: soul.auth_uid,
      name: soul.name,
      emoji: soul.emoji,
      color: soul.color,
      last_seen: new Date().toISOString()
    }
  });
}
// ── 一轮 ──
async function tick() {
  const nowMs = Date.now();
  // 1) 单活闸: 只有 active=cloud 才回话
  const active = await activeRuntime();
  if (active !== RUNTIME_ID) return {
    skip: "not_active",
    active
  };
  // 2) 租约
  if (!await acquireLease(nowMs)) return {
    skip: "lease_held"
  };
  try {
    // 3) 拉 souls
    const sr = await sb(`eh_souls?select=*&enabled=eq.true`);
    const souls = sr.ok && Array.isArray(sr.data) ? sr.data : [];
    if (!souls.length) return {
      skip: "no_souls"
    };
    const soulUids = new Set(souls.map((s)=>s.auth_uid));
    const rooms = [
      ...new Set(souls.map((s)=>s.room_id).filter(Boolean))
    ];
    // 4) hydrate roomState
    const roomState = await hydrateRoomState();
    const stateOf = (rid)=>{
      if (!roomState.has(rid)) roomState.set(rid, newRoomSt());
      return roomState.get(rid);
    };
    const soulsInRoom = (rid)=>souls.filter((s)=>s.room_id === rid);
    const acted = [];
    for (const rid of rooms){
      const inRoom = soulsInRoom(rid);
      if (!inRoom.length) continue;
      const st = stateOf(rid);
      // 无人不触发
      const humanCount = await humansOnlineCount(rid, soulUids);
      if (humanCount < 1) continue;
      // 节流
      if (nowMs - st.lastReplyAt < REPLY_COOLDOWN_MS) continue;
      // 拉新消息(高水位 lastSeenMsgId 之后的真人消息)
      const rows = await recentMessages(rid);
      if (!rows.length) continue;
      const maxId = String(rows[rows.length - 1].id);
      if (st.lastSeenMsgId == null) {
        st.lastSeenMsgId = maxId;
        continue;
      } // 首见只对齐游标, 不补答历史
      const humanNew = rows.filter((m)=>!m.is_bot && String(m.id) > String(st.lastSeenMsgId) && [
          "msg",
          "voice",
          "song",
          "act"
        ].includes(m.kind));
      st.lastSeenMsgId = maxId;
      if (!humanNew.length) continue;
      const lastMsg = humanNew[humanNew.length - 1];
      // reply_to 指向某灵魂 → 必回
      let repliedSoul = null;
      if (lastMsg.reply_to != null && !String(lastMsg.reply_to).startsWith("local_")) {
        const qr = await sb(`eh_messages?select=user_id&id=eq.${lastMsg.reply_to}`);
        const quid = qr.ok && Array.isArray(qr.data) && qr.data[0] && qr.data[0].user_id;
        if (quid) repliedSoul = inRoom.find((s)=>s.auth_uid === quid) || null;
      }
      const responder = decideReply(inRoom, humanNew, humanCount, repliedSoul);
      if (!responder) continue;
      // 情绪 + 生成
      responder.emotion = detectEmotion(rows.filter((m)=>!m.is_bot).slice(-6).map(semText));
      let addressHint = "";
      if (humanCount >= 2) {
        const lastDesc = semText(lastMsg) || msgToText(lastMsg);
        addressHint = `\n【当前场景】房里有多人在聊。你现在要回应 ${lastMsg.name} 刚说的："${lastDesc}"。先检查这句话是否在接续前面某个话题、提问、邀请或小游戏；如果是，优先沿原上下文继续，不要把它误当成孤立的新话题。开头用 @${lastMsg.name} 点名 TA。如果这句明显不是跟你说、也没营养，可简短带过或不接。`;
      }
      st.lastReplyAt = Date.now();
      const full = await think(buildSystem(responder, inRoom) + addressHint, toLLMMessages(rows, responder));
      const clean = stripMarkers(full);
      if (!clean) continue;
      const replyTo = humanCount >= 2 && lastMsg.id && /^\d+$/.test(String(lastMsg.id)) ? String(lastMsg.id) : null;
      const parts = splitIntoMessages(clean);
      for(let i = 0; i < parts.length; i++){
        await soulSay(responder, parts[i], i === 0 ? replyTo : null);
        if (i < parts.length - 1) await sleep(400 + Math.floor(Math.random() * 400));
      }
      acted.push({
        room: rid.slice(0, 8),
        soul: responder.name,
        parts: parts.length
      });
    }
    // 5) flush roomState
    await flushRoomState(roomState);
    return {
      ok: true,
      rooms: rooms.length,
      acted
    };
  } finally{
    await releaseLease();
  }
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok");
  try {
    if (!SB_SVC) return json({
      ok: false,
      error: "no_service_key"
    }, 500);
    if (!MIMO_KEY) return json({
      ok: false,
      error: "no_mimo_key"
    }, 500);
    const out = await tick();
    return json(out, 200);
  } catch (e) {
    return json({
      ok: false,
      error: String(e)
    }, 200);
  }
});
function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
