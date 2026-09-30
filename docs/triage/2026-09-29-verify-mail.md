# 邮箱验证走 SMTP 真发信

**日期**: 2026-09-29

**现象**: 「发送验证邮件」只在当前页面弹链接（文案写「邮件投递暂未开通…同一浏览器打开」），收件箱收不到；而找回密码能收到信。

**根因**: 项目 secrets 里 SMTP_HOST/PORT/USER/PASS/FROM 早已配好（7/15）。`reset-request` 已调 `sendMail` 真发；`send-verify` 仍停在 TODO，**从不调 `sendMail`**，恒 `sent:false` + 回传链接。

**方案**: `send-verify` 与 `reset-request` 同款：生成 token 后 `sendMail(row.email, …)`，成功 `sent:true` 不回链；SMTP 未配/发信失败再降级 `sent:false`+链接。前端降级文案改为「验证邮件发送失败」。已 `supabase functions deploy eh-auth --no-verify-jwt`。

**验证**: 部署成功；本地 CI；真实发信以注册邮箱收件为准。
