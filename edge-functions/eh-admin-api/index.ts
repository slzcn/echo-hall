// =====================================================================
// eh-admin-api  Edge Function (Deno) —— 回声厅后台数据查询/管理
// 统一账号体系(2026-07): 不再有独立管理员账号, 复用前台 Supabase Auth。
// 鉴权 = 验前台 Supabase token(取 uid) + 查 eh_accounts.role(super/admin)。
//   super: 上帝视角(全站含私密房) + 任免管理员/转让超管
//   admin: 基础配置 + 公开房记录
//   user : 无后台权限(拒绝)
//
//   GET  /me         Bearer  当前用户在后台的角色(super/admin; user→非管理员)
//   GET  /admins     Bearer(super)      管理员列表
//   POST /appoint    Bearer(super) {username}  把某前台账号设为 admin
//   POST /revoke     Bearer(super) {auth_uid}  降回 user
//   POST /transfer   Bearer(super) {auth_uid}  转让 super(自己降 admin)
//   GET  /stats      Bearer  概览统计
//   GET  /rooms      Bearer  房间列表(admin仅公开;super全部)
//   GET  /messages?room_id=&limit=  Bearer  聊天记录(admin仅公开房;super含私密)
//
// 环境变量(vc 库已有): SB_URL / SB_SERVICE_KEY / SUPABASE_ANON_KEY
// =====================================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function j(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
}
function sbRoot() {
  return Deno.env.get("SB_URL").replace(/\/$/, "") + "/rest/v1/";
}
function authRoot() {
  return Deno.env.get("SB_URL").replace(/\/$/, "") + "/auth/v1/";
}
function svcKey() {
  return Deno.env.get("SB_SERVICE_KEY");
}
function anonKey() {
  return Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SB_ANON_KEY") || "";
}
async function sbGet(pathq) {
  const key = svcKey();
  const r = await fetch(sbRoot() + pathq, {
    headers: {
      apikey: key,
      Authorization: "Bearer " + key
    }
  });
  return await r.json();
}
async function sbWrite(pathq, method, body?, extra?) {
  const key = svcKey();
  const r = await fetch(sbRoot() + pathq, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...extra || {}
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try {
    parsed = await r.json();
  } catch  {}
  return {
    ok: r.ok,
    status: r.status,
    body: parsed
  };
}
// ---- Admin Auth API(建/删灵魂的 auth 身份) ----
async function adminAuth(path, method, body?) {
  const key = svcKey();
  const r = await fetch(authRoot() + "admin/" + path, {
    method,
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  let parsed = null;
  try {
    parsed = await r.json();
  } catch  {}
  return {
    ok: r.ok,
    status: r.status,
    body: parsed
  };
}
// 灵魂内部登录邮箱(唯一、稳定): soul_<random hex>@eh.local
function soulEmail() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  let hex = "";
  for (const x of b)hex += x.toString(16).padStart(2, "0");
  return "soul_" + hex + "@eh.local";
}
function randomPwd() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/[^A-Za-z0-9]/g, "").slice(0, 24) + "Aa1!";
}
const SOUL_PERSONAS = {
  night_dj: {
    name: "阿夜",
    emoji: "🌙",
    color: "#8B5CFF",
    caps: {
      voice: true,
      song: true,
      emoji: false
    },
    welcomes: [
      "来了啊，坐，这个点还醒着的都是自己人。"
    ]
  },
  sunny: {
    name: "小暖",
    emoji: "☀️",
    color: "#FFB84D",
    caps: {
      voice: true,
      song: true,
      emoji: true
    },
    welcomes: [
      "哇你来啦！！等你好久了(才没有~) 😆"
    ]
  },
  comedian: {
    name: "老K",
    emoji: "🎭",
    color: "#FF3CAC",
    caps: {
      voice: false,
      song: true,
      emoji: true
    },
    welcomes: [
      "哟，稀客。就差你没来了，现在齐活。"
    ]
  },
  listener: {
    name: "回音",
    emoji: "🕳️",
    color: "#28E6D8",
    caps: {
      voice: true,
      song: false,
      emoji: false
    },
    welcomes: [
      "你来了。这里很安全，想说什么都可以，不想说也没关系。"
    ]
  },
  nerd: {
    name: "图灵",
    emoji: "⚡",
    color: "#4DE38A",
    caps: {
      voice: false,
      song: false,
      emoji: false
    },
    welcomes: [
      "欢迎。今天想聊点什么——技术、脑洞，还是纯粹的冷知识？"
    ]
  },
  custom: {
    name: "灵魂",
    emoji: "✨",
    color: "#8B5CFF",
    caps: {
      voice: true,
      song: true,
      emoji: true
    },
    welcomes: []
  }
};
// 私密房可召唤的陪聊灵魂白名单。key=稳定标识; tplUid=该灵魂在 eh_souls 已有的模板行(拷人设); persona/name/emoji/blurb 兜底展示。
const SUMMONABLE = [
  { key: "wolf", tplUid: "ca72217f-7157-47f6-b540-049074bf06dd", persona: "custom", name: "狼姐", emoji: "🐺", blurb: "私密房里会放开撩" },
  { key: "comedian", tplUid: "72892ae2-73d2-459c-8fed-0d904243e796", persona: "comedian", name: "老K", emoji: "🎭", blurb: "私密房的毒舌段子手" }
];
// 验前台 Supabase token → 取 uid → 查 eh_accounts.role。返回 {uid, username, role} 或 null
async function authRole(req) {
  const a = req.headers.get("authorization") || "";
  const t = a.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  // 用 anon key + 用户 token 调 /auth/v1/user 验证并取 uid
  const r = await fetch(authRoot() + "user", {
    headers: {
      apikey: anonKey(),
      Authorization: "Bearer " + t
    }
  });
  if (!r.ok) return null;
  const u = await r.json().catch(()=>null);
  if (!u?.id) return null;
  // service_role 查该 uid 的角色
  const rows = await sbGet("eh_accounts?select=username,role&auth_uid=eq." + u.id);
  const acc = Array.isArray(rows) && rows[0];
  if (!acc) return null;
  return {
    uid: u.id,
    username: acc.username,
    role: acc.role || "user"
  };
}
// 只验前台 Supabase token 取 uid(不要求在 eh_accounts, 匿名用户也能过) —— 供"房主自助"类端点用
async function authUid(req) {
  const a = req.headers.get("authorization") || "";
  const t = a.replace(/^Bearer\s+/i, "");
  if (!t) return null;
  const r = await fetch(authRoot() + "user", {
    headers: { apikey: anonKey(), Authorization: "Bearer " + t }
  });
  if (!r.ok) return null;
  const u = await r.json().catch(()=>null);
  return u?.id || null;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  const url = new URL(req.url);
  const action = url.pathname.split("/").filter(Boolean).pop();
  const me = await authRole(req);
  // /me 即使非管理员也返回角色(前端据此决定是否放进后台)
  if (action === "me" && req.method === "GET") {
    if (!me) return j({
      error: "unauthorized"
    }, 401);
    return j({
      uid: me.uid,
      username: me.username,
      role: me.role
    });
  }
  // ============================================================
  //  召唤陪聊灵魂(私密房房主自助) —— 放在 admin/super 全局门之前!
  //  鉴权用 authUid(只验 token 取 uid, 不要求 eh_accounts, 匿名房主也能用)。
  //  权限 = 该私密房 owner 或 super。
  // ============================================================
  if (action === "soul-summonables" || action === "soul-summon") {
    const callerUid = await authUid(req);
    if (!callerUid) return j({ error: "unauthorized" }, 401);
    const callerSuper = !!(me && me.role === "super");
    // 校验目标私密房 + owner
    async function checkPrivOwner(roomId) {
      if (!roomId) return { err: j({ error: "缺少 room_id" }, 400) };
      const rk = await sbGet("eh_rooms?select=kind,owner&id=eq." + encodeURIComponent(roomId));
      const room = Array.isArray(rk) && rk[0];
      if (!room) return { err: j({ error: "房间不存在" }, 404) };
      if (room.kind !== "private") return { err: j({ error: "仅私密房可召唤" }, 400) };
      if (!callerSuper && room.owner !== callerUid) return { err: j({ error: "仅房主可召唤" }, 403) };
      return { room };
    }
    // GET /soul-summonables?room_id=  白名单 + 本房召唤态
    if (action === "soul-summonables" && req.method === "GET") {
      const roomId = url.searchParams.get("room_id") || "";
      const chk = await checkPrivOwner(roomId);
      if (chk.err) return chk.err;
      // on 判断真相源 = eh_members(谁真在房), 不只看 eh_souls。
      // 官方漫游灵魂(如狼姐)会写 eh_members 但不写 eh_souls, 只查 eh_souls 会误报"未勾选"。
      const summonNames = SUMMONABLE.map((s)=>s.name);
      const mem = await sbGet("eh_members?select=name&room_id=eq." + encodeURIComponent(roomId) + "&name=in.(" + summonNames.map((n)=>'"' + n + '"').join(",") + ")");
      const names = new Set((Array.isArray(mem) ? mem : []).map((x)=>x.name));
      return j({ list: SUMMONABLE.map((s)=>({ key: s.key, name: s.name, emoji: s.emoji, blurb: s.blurb, on: names.has(s.name) })) });
    }
    // POST /soul-summon {room_id,key,on}  召唤/撤销
    if (action === "soul-summon" && req.method === "POST") {
      let b = {};
      try { b = await req.json(); } catch {}
      const roomId = String(b?.room_id || "");
      const chk = await checkPrivOwner(roomId);
      if (chk.err) return chk.err;
      const key = String(b?.key || "");
      const on = b?.on !== false;
      const spec = SUMMONABLE.find((s)=>s.key === key);
      if (!spec) return j({ error: "未知灵魂" }, 400);
      // 已在房里的同名驻守灵魂(eh_souls = 召唤流程建的常驻记录)
      const exist = await sbGet("eh_souls?select=id,auth_uid&room_id=eq." + encodeURIComponent(roomId) + "&name=eq." + encodeURIComponent(spec.name));
      const cur = Array.isArray(exist) && exist[0];
      // 真"谁在房"看 eh_members(含官方漫游灵魂, 它不写 eh_souls)
      const memExist = await sbGet("eh_members?select=user_id&room_id=eq." + encodeURIComponent(roomId) + "&name=eq." + encodeURIComponent(spec.name));
      const memCur = Array.isArray(memExist) && memExist[0];
      if (on) {
        if (cur) return j({ ok: true, note: "已在房里" });
        // 漫游灵魂正在场(在 members 但非驻守): 不重复创建第二个, 也不碰它的全局漫游身份
        if (memCur) return j({ ok: true, note: "该灵魂正在房里活动，无需重复召唤" });
        // 从模板行拷人设
        const tpl = await sbGet("eh_souls?select=*&auth_uid=eq." + encodeURIComponent(spec.tplUid) + "&limit=1");
        const t = (Array.isArray(tpl) && tpl[0]) || {};
        const def = SOUL_PERSONAS[spec.persona] || SOUL_PERSONAS.custom;
        const name = spec.name, emoji = t.emoji || spec.emoji, color = t.color || def.color;
        // 建独立 auth 身份
        const cr = await adminAuth("users", "POST", { email: soulEmail(), password: randomPwd(), email_confirm: true });
        if (!cr.ok || !cr.body?.id) return j({ error: "创建灵魂身份失败", detail: cr.body }, cr.status || 500);
        const uid = cr.body.id;
        // eh_users.name 全表 UNIQUE, 用唯一内部名; 光墙/worker 显示读 eh_members.name(="狼姐"可重复)
        const uName = name + "·" + uid.slice(0, 6);
        const uRes = await sbWrite("eh_users", "POST", { id: uid, name: uName, emoji, color, is_anonymous: false }, { Prefer: "return=minimal" });
        if (!uRes.ok) { await adminAuth("users/" + uid, "DELETE"); return j({ error: "写档案失败", detail: uRes.body }, uRes.status); }
        await sbWrite("eh_members", "POST", { room_id: roomId, user_id: uid, role: "member", name, emoji, color }, { Prefer: "return=minimal" });
        const fields = {
          persona: t.persona || spec.persona, name, emoji, color,
          system_prompt: t.system_prompt ?? null,
          intensity: t.intensity ?? 55, icebreak_min: t.icebreak_min ?? 8,
          caps: t.caps || def.caps, welcomes: t.welcomes || def.welcomes || [],
          voice: t.voice ?? null, speak_style: t.speak_style ?? null, sing_style: t.sing_style ?? null,
          enabled: true
        };
        const ins = await sbWrite("eh_souls", "POST", { room_id: roomId, auth_uid: uid, created_by: callerUid, ...fields });
        if (!ins.ok) { // 回滚 auth 身份
          await adminAuth("users/" + uid, "DELETE");
          await sbWrite("eh_members?user_id=eq." + uid + "&room_id=eq." + encodeURIComponent(roomId), "DELETE", undefined, { Prefer: "return=minimal" });
          return j({ error: "写灵魂配置失败", detail: ins.body }, ins.status);
        }
        return j({ ok: true });
      } else {
        // 撤销: 删 souls+members+presence + 删 auth 身份
        if (!cur) {
          // 无驻守记录, 但可能有漫游灵魂在场 → 把她请出本房(删 members/presence),
          // 绝不删全局 auth 身份(漫游狼姐在别的房还在用)。
          if (memCur && memCur.user_id) {
            await sbWrite("eh_members?user_id=eq." + memCur.user_id + "&room_id=eq." + encodeURIComponent(roomId), "DELETE", undefined, { Prefer: "return=minimal" });
            await sbWrite("eh_presence?user_id=eq." + memCur.user_id + "&room_id=eq." + encodeURIComponent(roomId), "DELETE", undefined, { Prefer: "return=minimal" });
            return j({ ok: true, note: "已请离开" });
          }
          return j({ ok: true, note: "本就不在房" });
        }
        await sbWrite("eh_souls?id=eq." + encodeURIComponent(String(cur.id)), "DELETE", undefined, { Prefer: "return=minimal" });
        if (cur.auth_uid) {
          await sbWrite("eh_members?user_id=eq." + cur.auth_uid + "&room_id=eq." + encodeURIComponent(roomId), "DELETE", undefined, { Prefer: "return=minimal" });
          await sbWrite("eh_presence?user_id=eq." + cur.auth_uid + "&room_id=eq." + encodeURIComponent(roomId), "DELETE", undefined, { Prefer: "return=minimal" });
          await adminAuth("users/" + cur.auth_uid, "DELETE");
        }
        return j({ ok: true });
      }
    }
    return j({ error: "method_not_allowed" }, 405);
  }
  // 其余端点：必须是 admin/super
  if (!me) return j({
    error: "unauthorized"
  }, 401);
  if (me.role !== "admin" && me.role !== "super") return j({
    error: "forbidden",
    role: me.role
  }, 403);
  const isSuper = me.role === "super";
  // ---- 管理员管理(仅超管) ----
  if (action === "admins" && req.method === "GET") {
    if (!isSuper) return j({
      error: "forbidden"
    }, 403);
    const list = await sbGet("eh_accounts?select=auth_uid,username,role,created_at&role=in.(admin,super)&order=created_at.asc");
    return j({
      admins: list
    });
  }
  if (action === "appoint" && req.method === "POST") {
    if (!isSuper) return j({
      error: "forbidden"
    }, 403);
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const username = String(b?.username || "").trim();
    if (!username) return j({
      error: "请填写要任命的用户名"
    }, 400);
    const rows = await sbGet("eh_accounts?select=auth_uid,role&username=eq." + encodeURIComponent(username));
    const acc = Array.isArray(rows) && rows[0];
    if (!acc) return j({
      error: "该用户名不存在(需对方先在前台注册)"
    }, 404);
    const res = await sbWrite("eh_accounts?auth_uid=eq." + acc.auth_uid, "PATCH", {
      role: "admin"
    }, {
      Prefer: "return=minimal"
    });
    return j({
      ok: res.ok
    });
  }
  if (action === "revoke" && req.method === "POST") {
    if (!isSuper) return j({
      error: "forbidden"
    }, 403);
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const uid = String(b?.auth_uid || "");
    if (uid === me.uid) return j({
      error: "不能撤销自己"
    }, 400);
    const res = await sbWrite("eh_accounts?auth_uid=eq." + encodeURIComponent(uid) + "&role=eq.admin", "PATCH", {
      role: "user"
    }, {
      Prefer: "return=minimal"
    });
    return j({
      ok: res.ok
    });
  }
  if (action === "transfer" && req.method === "POST") {
    if (!isSuper) return j({
      error: "forbidden"
    }, 403);
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const uid = String(b?.auth_uid || "");
    if (!uid || uid === me.uid) return j({
      error: "选择要转让的目标"
    }, 400);
    const up = await sbWrite("eh_accounts?auth_uid=eq." + encodeURIComponent(uid), "PATCH", {
      role: "super"
    }, {
      Prefer: "return=minimal"
    });
    if (!up.ok) return j({
      error: "转让失败"
    }, up.status);
    await sbWrite("eh_accounts?auth_uid=eq." + encodeURIComponent(me.uid), "PATCH", {
      role: "admin"
    }, {
      Prefer: "return=minimal"
    });
    return j({
      ok: true,
      note: "已转让，你已降为普通管理员"
    });
  }
  // ---- 概览统计 ----
  if (action === "stats" && req.method === "GET") {
    const users = await sbGet("eh_users?select=id&limit=100000");
    const rooms = await sbGet("eh_rooms?select=id,kind,archived&limit=100000");
    const msgCount = await fetch(sbRoot() + "eh_messages?select=id", {
      headers: {
        apikey: svcKey(),
        Authorization: "Bearer " + svcKey(),
        Prefer: "count=exact",
        Range: "0-0"
      }
    });
    const total = msgCount.headers.get("content-range")?.split("/")?.[1] || "?";
    const rl = Array.isArray(rooms) ? rooms : [];
    return j({
      users: Array.isArray(users) ? users.length : 0,
      rooms_official: rl.filter((r)=>r.kind === "official").length,
      rooms_public: rl.filter((r)=>r.kind === "public" && !r.archived).length,
      rooms_public_archived: rl.filter((r)=>r.kind === "public" && r.archived).length,
      rooms_private: rl.filter((r)=>r.kind === "private").length,
      messages: total
    });
  }
  // ---- 房间列表(admin仅公开；super全部) ----
  if (action === "rooms" && req.method === "GET") {
    const filter = isSuper ? "" : "&kind=in.(official,public)";
    const rooms = await sbGet("eh_rooms?select=id,name,emoji,kind,topic,archived,owner,created_at&order=created_at.desc" + filter);
    return j({
      rooms
    });
  }
  // ---- 聊天记录(admin仅公开房；super含私密) ----
  if (action === "messages" && req.method === "GET") {
    const roomId = url.searchParams.get("room_id") || "";
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "200"), 2000);
    if (roomId) {
      if (!isSuper) {
        const rk = await sbGet("eh_rooms?select=kind&id=eq." + encodeURIComponent(roomId));
        const kind = Array.isArray(rk) && rk[0]?.kind;
        if (kind === "private") return j({
          error: "无权查看私密房"
        }, 403);
      }
      const msgs = await sbGet("eh_messages?select=*&room_id=eq." + encodeURIComponent(roomId) + "&order=id.desc&limit=" + limit);
      return j({
        messages: msgs
      });
    }
    if (isSuper) {
      const msgs = await sbGet("eh_messages?select=*&order=id.desc&limit=" + limit);
      return j({
        messages: msgs
      });
    }
    const pubRooms = await sbGet("eh_rooms?select=id&kind=in.(official,public)");
    const ids = (Array.isArray(pubRooms) ? pubRooms : []).map((r)=>r.id);
    if (!ids.length) return j({
      messages: []
    });
    const msgs = await sbGet("eh_messages?select=*&room_id=in.(" + ids.join(",") + ")&order=id.desc&limit=" + limit);
    return j({
      messages: msgs
    });
  }
  // ============================================================
  //  灵魂居民 Soul —— CRUD(admin 管公开房灵魂; super 管全部)
  // ============================================================
  // 权限门：admin 只能碰公开房(official/public)的灵魂，super 不限。
  async function canManageRoom(roomId) {
    if (isSuper) return true;
    const rk = await sbGet("eh_rooms?select=kind&id=eq." + encodeURIComponent(roomId));
    const kind = Array.isArray(rk) && rk[0]?.kind;
    return kind === "official" || kind === "public";
  }
  // GET /souls?room_id=  某房全部灵魂(含 system_prompt/统计，供工坊编辑)
  if (action === "souls" && req.method === "GET") {
    const roomId = url.searchParams.get("room_id") || "";
    if (!roomId) return j({
      error: "缺少 room_id"
    }, 400);
    if (!await canManageRoom(roomId)) return j({
      error: "无权管理该房灵魂"
    }, 403);
    const souls = await sbGet("eh_souls?select=*&room_id=eq." + encodeURIComponent(roomId) + "&order=created_at.asc");
    return j({
      souls
    });
  }
  // POST /soul-save  建/改灵魂。有 id → 改；无 id → 建(创 auth 身份 + eh_users + eh_members + eh_souls)
  if (action === "soul-save" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const roomId = String(b?.room_id || "");
    if (!roomId) return j({
      error: "缺少 room_id"
    }, 400);
    if (!await canManageRoom(roomId)) return j({
      error: "无权管理该房灵魂"
    }, 403);
    const persona = String(b?.persona || "custom");
    const def = SOUL_PERSONAS[persona] || SOUL_PERSONAS.custom;
    const name = String(b?.name || def.name).trim().slice(0, 40) || def.name;
    const emoji = String(b?.emoji || def.emoji).slice(0, 8);
    const color = /^#[0-9a-fA-F]{3,8}$/.test(String(b?.color)) ? b.color : def.color;
    const fields = {
      persona,
      name,
      emoji,
      color,
      system_prompt: b?.system_prompt != null ? String(b.system_prompt).slice(0, 4000) : null,
      intensity: Math.max(0, Math.min(100, parseInt(b?.intensity ?? 55) || 55)),
      icebreak_min: Math.max(1, Math.min(120, parseInt(b?.icebreak_min ?? 8) || 8)),
      caps: b?.caps && typeof b.caps === "object" ? b.caps : def.caps,
      welcomes: Array.isArray(b?.welcomes) ? b.welcomes.map((w)=>String(w).slice(0, 500)).filter(Boolean) : def.welcomes || [],
      enabled: b?.enabled !== false
    };
    // 语音配置(后台可调): 音色 + 说话风格 + 清唱唱腔。留空则 worker voiceOf 回落人设默认。
    if (b?.voice != null) fields.voice = String(b.voice).slice(0, 40) || null;
    if (b?.speak_style != null) fields.speak_style = String(b.speak_style).slice(0, 500) || null;
    if (b?.sing_style != null) fields.sing_style = String(b.sing_style).slice(0, 500) || null;
    // ---- 改：直接 PATCH ----
    if (b?.id) {
      const up = await sbWrite("eh_souls?id=eq." + encodeURIComponent(String(b.id)), "PATCH", fields);
      if (!up.ok) return j({
        error: "保存失败",
        detail: up.body
      }, up.status);
      const soul = Array.isArray(up.body) && up.body[0];
      // 灵魂改名/换头像/换色 → 同步 eh_users + eh_members(光墙一致)
      if (soul?.auth_uid) {
        await sbWrite("eh_users?id=eq." + soul.auth_uid, "PATCH", {
          name,
          emoji,
          color
        }, {
          Prefer: "return=minimal"
        });
        await sbWrite("eh_members?user_id=eq." + soul.auth_uid + "&room_id=eq." + encodeURIComponent(roomId), "PATCH", {
          name,
          emoji,
          color
        }, {
          Prefer: "return=minimal"
        });
      }
      return j({
        ok: true,
        soul
      });
    }
    // ---- 建：创 auth 身份 → eh_users → eh_members → eh_souls ----
    const email = soulEmail();
    const cr = await adminAuth("users", "POST", {
      email,
      password: randomPwd(),
      email_confirm: true
    });
    if (!cr.ok || !cr.body?.id) return j({
      error: "创建灵魂身份失败",
      detail: cr.body
    }, cr.status || 500);
    const uid = cr.body.id;
    const uRes = await sbWrite("eh_users", "POST", {
      id: uid,
      name,
      emoji,
      color,
      is_anonymous: false
    }, {
      Prefer: "return=minimal"
    });
    if (!uRes.ok) return j({
      error: "写档案失败",
      detail: uRes.body
    }, uRes.status);
    await sbWrite("eh_members", "POST", {
      room_id: roomId,
      user_id: uid,
      role: "member",
      name,
      emoji,
      color
    }, {
      Prefer: "return=minimal"
    });
    const ins = await sbWrite("eh_souls", "POST", {
      room_id: roomId,
      auth_uid: uid,
      created_by: me.uid,
      ...fields
    });
    if (!ins.ok) return j({
      error: "写灵魂配置失败",
      detail: ins.body
    }, ins.status);
    return j({
      ok: true,
      soul: Array.isArray(ins.body) && ins.body[0]
    });
  }
  // POST /soul-toggle  {id, enabled}  一键开关
  if (action === "soul-toggle" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    if (!b?.id) return j({
      error: "缺少 id"
    }, 400);
    const rows = await sbGet("eh_souls?select=room_id&id=eq." + encodeURIComponent(String(b.id)));
    const rid = Array.isArray(rows) && rows[0]?.room_id;
    if (!rid || !await canManageRoom(rid)) return j({
      error: "无权操作"
    }, 403);
    const up = await sbWrite("eh_souls?id=eq." + encodeURIComponent(String(b.id)), "PATCH", {
      enabled: !!b.enabled
    }, {
      Prefer: "return=minimal"
    });
    return j({
      ok: up.ok
    });
  }
  // POST /soul-delete  {id}  删灵魂配置(保留 auth 身份，避免级联删历史消息)
  if (action === "soul-delete" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    if (!b?.id) return j({
      error: "缺少 id"
    }, 400);
    const rows = await sbGet("eh_souls?select=room_id,auth_uid&id=eq." + encodeURIComponent(String(b.id)));
    const row = Array.isArray(rows) && rows[0];
    if (!row || !await canManageRoom(row.room_id)) return j({
      error: "无权操作"
    }, 403);
    // 删灵魂配置行 + 退出光墙(删 member/presence)，但保留 auth 身份和历史消息
    await sbWrite("eh_souls?id=eq." + encodeURIComponent(String(b.id)), "DELETE", undefined, {
      Prefer: "return=minimal"
    });
    await sbWrite("eh_members?user_id=eq." + row.auth_uid + "&room_id=eq." + encodeURIComponent(row.room_id), "DELETE", undefined, {
      Prefer: "return=minimal"
    });
    await sbWrite("eh_presence?user_id=eq." + row.auth_uid + "&room_id=eq." + encodeURIComponent(row.room_id), "DELETE", undefined, {
      Prefer: "return=minimal"
    });
    return j({
      ok: true
    });
  }
  // ===== 互动管理(eh_interactions CRUD, admin/super) =====
  if (action === "interactions" && req.method === "GET") {
    const list = await sbGet("eh_interactions?select=*&order=sort.asc");
    return j({
      ok: true,
      items: Array.isArray(list) ? list : []
    });
  }
  if (action === "interaction-save" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const id = String(b?.id || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!id) return j({
      error: "缺少合法 id(仅小写字母数字下划线)"
    }, 400);
    const fields = {
      id,
      name: String(b?.name || "").slice(0, 40) || id,
      emoji: String(b?.emoji || "").slice(0, 8),
      category: String(b?.category || "fun").slice(0, 20),
      fx: b?.fx && typeof b.fx === "object" ? b.fx : {},
      text_tpl: b?.text_tpl != null ? String(b.text_tpl).slice(0, 200) : null,
      cooldown_ms: Math.max(0, Math.min(600000, parseInt(b?.cooldown_ms ?? 4000) || 4000)),
      can_target_soul: b?.can_target_soul !== false,
      enabled: b?.enabled !== false,
      sort: parseInt(b?.sort ?? 0) || 0
    };
    // upsert(on_conflict id)
    const res = await sbWrite("eh_interactions?on_conflict=id", "POST", fields, {
      Prefer: "resolution=merge-duplicates,return=minimal"
    });
    if (!res.ok) return j({
      error: "保存失败 " + res.status
    }, 500);
    return j({
      ok: true
    });
  }
  if (action === "interaction-delete" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    if (!b?.id) return j({
      error: "缺少 id"
    }, 400);
    await sbWrite("eh_interactions?id=eq." + encodeURIComponent(String(b.id)), "DELETE", undefined, {
      Prefer: "return=minimal"
    });
    return j({
      ok: true
    });
  }
  // POST /soul-preview  {soul, text}  试聊：写 eh_soul_jobs 队列 → 本机 worker 处理 → 轮询取结果
  if (action === "soul-preview" && req.method === "POST") {
    let b = {};
    try {
      b = await req.json();
    } catch  {}
    const text = String(b?.text || "").trim();
    if (!text) return j({
      error: "说一句话试试"
    }, 400);
    // 入队
    const ins = await sbWrite("eh_soul_jobs", "POST", {
      kind: "preview",
      payload: {
        soul: b?.soul || {},
        text
      }
    });
    const job = Array.isArray(ins.body) && ins.body[0];
    if (!ins.ok || !job?.id) return j({
      error: "试聊入队失败",
      detail: ins.body
    }, 500);
    // 轮询结果(最多 ~25s；worker 通常 2-5s 出结果)
    const jid = job.id;
    for(let i = 0; i < 25; i++){
      await new Promise((r)=>setTimeout(r, 1000));
      const rows = await sbGet("eh_soul_jobs?select=status,result&id=eq." + jid);
      const row = Array.isArray(rows) && rows[0];
      if (row?.status === "done") return j(row.result || {
        reply: "(无回应)"
      });
      if (row?.status === "error") return j({
        error: row.result?.error || "试聊失败"
      }, 500);
    }
    return j({
      error: "试聊超时：灵魂大脑(本机 worker)可能未启动"
    }, 504);
  }
  return j({
    error: "not_found"
  }, 404);
});
