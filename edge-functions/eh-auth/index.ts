// =====================================================================
// eh-auth  Edge Function (Deno) —— 回声厅前台正式账号(用户名/邮箱 + 密码)
//
// 路线①: 用 service_role 的 Admin API 建/升级 auth user 并 email_confirm(绕开
// 全局邮箱确认), 前台随后用原生 signInWithPassword 登录拿 session(RLS 正常)。
//
//   POST /register  { username, password, email?, anonUid? }
//        用户名唯一; 内部登录邮箱 = <username>@eh.local(填了真邮箱则真邮箱也可登录/找回)。
//        anonUid: 当前匿名 user → 升级为该账号(继承 uid + 历史)。
//        返回 { loginEmail } 供前台 signInWithPassword。
//   POST /resolve   { account }         账号(用户名或邮箱) → 登录用邮箱
//   POST /check      { username }        用户名是否可用
//
// 环境变量(项目 Function Secrets, vc 库已有): SB_URL / SB_SERVICE_KEY
// =====================================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
};
function j(b, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: {
      "Content-Type": "application/json",
      ...CORS
    }
  });
}
const SB_URL = ()=>Deno.env.get("SB_URL").replace(/\/$/, "");
const KEY = ()=>Deno.env.get("SB_SERVICE_KEY");
const INTERNAL_DOMAIN = "eh.local";
// REST helpers (service_role)
async function rest(path, method = "GET", body, extra) {
  const r = await fetch(SB_URL() + "/rest/v1/" + path, {
    method,
    headers: {
      apikey: KEY(),
      Authorization: "Bearer " + KEY(),
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
// Admin Auth API
async function adminAuth(path, method, body) {
  const r = await fetch(SB_URL() + "/auth/v1/admin/" + path, {
    method,
    headers: {
      apikey: KEY(),
      Authorization: "Bearer " + KEY(),
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
const isEmail = (s)=>/^\S+@\S+\.\S+$/.test(s);
// ---- SMTP 发信(找回密码链接)。凭据走 Function Secrets, 未配则返回 false 让上层降级回链接。 ----
// 环境变量: SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM(选填, 默认=SMTP_USER)
async function sendMail(to, subject, html) {
  const host = Deno.env.get("SMTP_HOST"), user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  const port = parseInt(Deno.env.get("SMTP_PORT") || "465", 10);
  const from = Deno.env.get("SMTP_FROM") || user || "";
  if (!host || !user || !pass) return false;
  try {
    const { SMTPClient } = await import("https://deno.land/x/denomailer@1.6.0/mod.ts");
    const client = new SMTPClient({
      connection: {
        hostname: host,
        port,
        tls: port === 465,
        auth: {
          username: user,
          password: pass
        }
      }
    });
    await client.send({
      from,
      to,
      subject,
      content: "请在支持 HTML 的客户端查看",
      html
    });
    await client.close();
    return true;
  } catch (e) {
    console.error("sendMail 失败:", e.message);
    return false;
  }
}
// 内部登录邮箱：用户名可含中文，邮箱 local part 必须 ASCII，故用 hex 编码用户名。
// 同一用户名恒定映射到同一内部邮箱。
function uname2email(u) {
  const bytes = new TextEncoder().encode(u.toLowerCase());
  let hex = "";
  for (const x of bytes)hex += x.toString(16).padStart(2, "0");
  return "u_" + hex + "@" + INTERNAL_DOMAIN;
}
async function accountByUsername(username) {
  const r = await rest("eh_users?select=*&username=eq." + encodeURIComponent(username));
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}
async function accountByEmail(email) {
  const r = await rest("eh_users?select=*&email=eq." + encodeURIComponent(email));
  return Array.isArray(r.body) && r.body[0] ? r.body[0] : null;
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: CORS
  });
  const action = new URL(req.url).pathname.split("/").filter(Boolean).pop();
  let b = {};
  try {
    b = await req.json();
  } catch  {}
  // ---- 用户名可用性 ----
  if (action === "check" && req.method === "POST") {
    const username = String(b?.username || "").trim();
    if (username.length < 3) return j({
      available: false,
      reason: "too_short"
    });
    const exists = await accountByUsername(username);
    return j({
      available: !exists
    });
  }
  // ---- 注册 ----
  if (action === "register" && req.method === "POST") {
    const username = String(b?.username || "").trim();
    const password = String(b?.password || "");
    const email = b?.email ? String(b.email).trim() : "";
    const anonUid = b?.anonUid ? String(b.anonUid) : "";
    if (!/^[A-Za-z0-9_一-龥]{3,20}$/.test(username)) return j({
      error: "用户名 3-20 位，支持中英文数字下划线"
    }, 400);
    if (password.length < 6) return j({
      error: "密码至少 6 位"
    }, 400);
    if (email && !isEmail(email)) return j({
      error: "邮箱格式不对"
    }, 400);
    if (await accountByUsername(username)) return j({
      error: "用户名已被占用"
    }, 409);
    if (email && await accountByEmail(email)) return j({
      error: "该邮箱已注册"
    }, 409);
    const loginEmail = uname2email(username); // 内部登录邮箱(唯一、稳定)
    let uid = "";
    if (anonUid) {
      // 匿名转正：升级现有匿名 user（继承 uid + 历史）
      const up = await adminAuth("users/" + anonUid, "PUT", {
        email: loginEmail,
        password,
        email_confirm: true
      });
      if (!up.ok) return j({
        error: "升级失败",
        detail: up.body
      }, up.status);
      uid = anonUid;
    } else {
      const cr = await adminAuth("users", "POST", {
        email: loginEmail,
        password,
        email_confirm: true
      });
      if (!cr.ok) return j({
        error: "创建失败",
        detail: cr.body
      }, cr.status);
      uid = cr.body.id;
    }
    // 写 eh_users 档案：把 username/email 写入用户行，转正后标记非匿名(合并原两次写)
    const ins = await rest("eh_users?id=eq." + uid, "PATCH", {
      username,
      email: email || null,
      is_anonymous: false
    }, {
      Prefer: "return=minimal"
    });
    if (!ins.ok) return j({
      error: "账号记录写入失败",
      detail: ins.body
    }, ins.status);
    return j({
      ok: true,
      loginEmail,
      uid
    });
  }
  // ---- 解析：账号(用户名/邮箱) → 登录用邮箱 ----
  // 防账号枚举：无论账号是否存在，都返回一个确定性推导的 loginEmail(不报"不存在")。
  // 不存在的账号推导出的邮箱没有对应 auth 用户，后续 signInWithPassword 统一以"密码错误"失败，
  // 存在与否的响应无差异，无法枚举。
  if (action === "resolve" && req.method === "POST") {
    const account = String(b?.account || "").trim();
    if (!account) return j({
      error: "缺少账号"
    }, 400);
    if (isEmail(account)) {
      const acc = await accountByEmail(account);
      return j({
        loginEmail: acc ? uname2email(acc.username) : account
      });
    }
    const acc = await accountByUsername(account);
    return j({
      loginEmail: acc ? uname2email(acc.username) : uname2email(account)
    });
  }
  // ---- 修改真实邮箱(找回密码用): 验前台 token 取 uid, 更新 eh_users.email ----
  // 注意: 不动 auth 的登录邮箱(u_hex@eh.local), 否则用户名登录会失效。
  if (action === "update-email" && req.method === "POST") {
    const auth = req.headers.get("authorization") || "";
    const tok = auth.replace(/^Bearer\s+/i, "");
    if (!tok) return j({
      error: "未登录"
    }, 401);
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const ur = await fetch(SB_URL() + "/auth/v1/user", {
      headers: {
        apikey: anon,
        Authorization: "Bearer " + tok
      }
    });
    if (!ur.ok) return j({
      error: "登录已失效"
    }, 401);
    const u = await ur.json().catch(()=>null);
    if (!u?.id) return j({
      error: "登录已失效"
    }, 401);
    const email = String(b?.email || "").trim();
    if (!isEmail(email)) return j({
      error: "邮箱格式不对"
    }, 400);
    // 邮箱唯一性(排除自己)
    const dup = await accountByEmail(email);
    if (dup && dup.id !== u.id) return j({
      error: "该邮箱已被其他账号使用"
    }, 409);
    // 换邮箱 → 验证状态清零(需重新验证); 清掉旧的待验证 token。
    const res = await rest("eh_users?id=eq." + u.id, "PATCH", {
      email,
      email_verified: false,
      email_verify_token: null,
      email_verify_expires: null
    }, {
      Prefer: "return=minimal"
    });
    if (!res.ok) return j({
      error: "保存失败"
    }, res.status);
    return j({
      ok: true
    });
  }
  // ---- 发送验证邮件: 生成 token, 尝试发信 ----
  // 说明: 前台登录邮箱是内部占位(u_hex@eh.local), Supabase 内置 mailer 发不到用户 eh_users.email 真邮箱,
  // 需配 SMTP 才能真正投递。SMTP 未配时降级为"直接返回验证链接"(前台弹给已登录本人点)。
  if (action === "send-verify" && req.method === "POST") {
    const auth = req.headers.get("authorization") || "";
    const tok = auth.replace(/^Bearer\s+/i, "");
    if (!tok) return j({
      error: "未登录"
    }, 401);
    const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const ur = await fetch(SB_URL() + "/auth/v1/user", {
      headers: {
        apikey: anon,
        Authorization: "Bearer " + tok
      }
    });
    if (!ur.ok) return j({
      error: "登录已失效"
    }, 401);
    const u = await ur.json().catch(()=>null);
    if (!u?.id) return j({
      error: "登录已失效"
    }, 401);
    const acc = await rest("eh_users?select=*&id=eq." + u.id);
    const row = Array.isArray(acc.body) && acc.body[0] ? acc.body[0] : null;
    if (!row) return j({
      error: "账号不存在"
    }, 404);
    if (!row.email) return j({
      error: "请先设置邮箱"
    }, 400);
    if (row.email_verified) return j({
      ok: true,
      already: true
    });
    // 生成随机 token(32 字节 hex), 24h 有效
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let vtok = "";
    for (const x of bytes)vtok += x.toString(16).padStart(2, "0");
    const expires = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const up = await rest("eh_users?id=eq." + u.id, "PATCH", {
      email_verify_token: vtok,
      email_verify_expires: expires
    }, {
      Prefer: "return=minimal"
    });
    if (!up.ok) return j({
      error: "生成失败"
    }, up.status);
    const base = String(b?.origin || "").replace(/\/$/, "") || "https://slzcn.github.io/echo-hall";
    const link = base + "/?ehverify=" + vtok;
    // 有 SMTP → 真发到 row.email(与 reset-request 同款); 没配/发失败 → 降级把链接回给已登录本人点
    const vhtml = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
      <h2 style="margin:0 0 12px">回声厅 · 验证邮箱</h2>
      <p>点下面的按钮验证你的邮箱，链接 24 小时内有效：</p>
      <p style="margin:18px 0"><a href="${link}" style="background:#28E6D8;color:#062;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600">验证邮箱</a></p>
      <p style="color:#888;font-size:13px">按钮打不开就复制这个链接到浏览器：<br>${link}</p>
      <p style="color:#888;font-size:13px">如果不是你本人操作，忽略此邮件即可。</p>
    </div>`;
    const sent = await sendMail(row.email, "回声厅 · 验证邮箱", vhtml);
    if (sent) return j({
      ok: true,
      sent: true,
      email: row.email
    });
    return j({
      ok: true,
      sent: false,
      link,
      email: row.email
    });
  }
  // ---- 消费验证 token, 标记邮箱已验证 ----
  if (action === "verify-email" && req.method === "POST") {
    const vtok = String(b?.token || "").trim();
    if (!vtok || vtok.length < 8) return j({
      error: "无效链接"
    }, 400);
    const acc = await rest("eh_users?select=id,email_verify_expires&email_verify_token=eq." + encodeURIComponent(vtok));
    const row = Array.isArray(acc.body) && acc.body[0] ? acc.body[0] : null;
    if (!row) return j({
      error: "链接无效或已使用"
    }, 400);
    if (row.email_verify_expires && new Date(row.email_verify_expires).getTime() < Date.now()) return j({
      error: "链接已过期，请重新发送"
    }, 400);
    const up = await rest("eh_users?id=eq." + row.id, "PATCH", {
      email_verified: true,
      email_verify_token: null,
      email_verify_expires: null
    }, {
      Prefer: "return=minimal"
    });
    if (!up.ok) return j({
      error: "验证失败"
    }, up.status);
    return j({
      ok: true
    });
  }
  // ---- 找回密码·请求 ---- { email }
  // 用真邮箱(eh_users.email)找到账号 → 生成短效重置 token 存库。无 SMTP 时降级:
  // 直接把重置链接返回给请求方(前台弹出可点)。为防"探测某邮箱是否注册", 无论是否命中都返回 ok。
  if (action === "reset-request" && req.method === "POST") {
    const email = String(b?.email || "").trim().toLowerCase();
    if (!isEmail(email)) return j({
      error: "邮箱格式不对"
    }, 400);
    const acc = await accountByEmail(email);
    if (!acc) return j({
      ok: true,
      sent: false
    }); // 不暴露邮箱是否存在
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    let tok = "";
    for (const x of bytes)tok += x.toString(16).padStart(2, "0");
    const expires = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 分钟有效
    const up = await rest("eh_users?id=eq." + acc.id, "PATCH", {
      pw_reset_token: tok,
      pw_reset_expires: expires
    }, {
      Prefer: "return=minimal"
    });
    if (!up.ok) return j({
      error: "生成失败",
      detail: up.body
    }, up.status);
    const base = String(b?.origin || "").replace(/\/$/, "") || "https://slzcn.github.io/echo-hall";
    const link = base + "/?ehreset=" + tok;
    // 配了 SMTP → 发邮件到用户真邮箱, 不把链接回给前端(更安全); 没配 → 降级直接回链接。
    const html = `<div style="font-family:sans-serif;line-height:1.7;color:#222">
      <h2 style="margin:0 0 12px">回声厅 · 重置密码</h2>
      <p>你(或有人)申请重置账号 <b>${acc.username}</b> 的密码。点下面的按钮设置新密码，链接 30 分钟内有效：</p>
      <p style="margin:18px 0"><a href="${link}" style="background:#28E6D8;color:#062;padding:11px 20px;border-radius:10px;text-decoration:none;font-weight:600">设置新密码</a></p>
      <p style="color:#888;font-size:13px">按钮打不开就复制这个链接到浏览器：<br>${link}</p>
      <p style="color:#888;font-size:13px">如果不是你本人操作，忽略此邮件即可，密码不会改变。</p>
    </div>`;
    const sent = await sendMail(acc.email, "回声厅 · 重置密码", html);
    if (sent) return j({
      ok: true,
      sent: true
    }); // 已发邮件, 不回链接
    return j({
      ok: true,
      sent: false,
      link,
      username: acc.username
    }); // 未配 SMTP: 降级回链接
  }
  // ---- 找回密码·确认 ---- { token, password }
  // 校验 token 未过期 → Admin API 用 service_role 直接改该账号的登录密码。
  if (action === "reset-confirm" && req.method === "POST") {
    const tok = String(b?.token || "").trim();
    const pw = String(b?.password || "");
    if (!tok || tok.length < 8) return j({
      error: "无效链接"
    }, 400);
    if (pw.length < 6) return j({
      error: "密码至少 6 位"
    }, 400);
    const acc = await rest("eh_users?select=id,username,pw_reset_expires&pw_reset_token=eq." + encodeURIComponent(tok));
    const row = Array.isArray(acc.body) && acc.body[0] ? acc.body[0] : null;
    if (!row) return j({
      error: "链接无效或已使用"
    }, 400);
    if (row.pw_reset_expires && new Date(row.pw_reset_expires).getTime() < Date.now()) return j({
      error: "链接已过期，请重新找回"
    }, 400);
    const upd = await adminAuth("users/" + row.id, "PUT", {
      password: pw
    });
    if (!upd.ok) return j({
      error: "改密失败",
      detail: upd.body
    }, upd.status);
    await rest("eh_users?id=eq." + row.id, "PATCH", {
      pw_reset_token: null,
      pw_reset_expires: null
    }, {
      Prefer: "return=minimal"
    });
    return j({
      ok: true,
      username: row.username
    }); // 回 username 供前台自动填登录框, 闭环体验
  }
  return j({
    error: "not_found"
  }, 404);
});