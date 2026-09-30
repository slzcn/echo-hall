#!/usr/bin/env python3
"""登录页头像↔名字 视觉一致性断言（CDP 真渲染）。

抓这类 bug 的正确姿势：不看代码逻辑，看渲染结果。
- 真浏览器打开线上登录页；
- 注入各种脏 eh_identity_v2（含真实线上会出现的错配形态）；
- 重新走 loadOrRollIdentity()+paintIdentity()；
- 从真 DOM 取 #idAv 文本(emoji) 与 #idName 文本(名字)，断言语义配套；
- 每个用例截图存证到 /tmp/echo-fold-logs/。

判据：
- 临时身份(无 registered/username/email)：#idAv 的 emoji 必须 == 名字末尾动物对应 EMO。
- 正式账号(registered/username/email)：不强制按名字改，仅记录（尊重自定义）。
"""
import base64, json, os, time, urllib.request, urllib.error, unicodedata
from pathlib import Path

CDP = os.environ.get("ECHO_CDP", "http://127.0.0.1:9222")
URL = os.environ.get("ECHO_URL", "https://slzcn.github.io/echo-hall/?_ts=") + str(int(time.time()))
OUT = Path(os.environ.get("ECHO_FOLD_OUT", "/tmp/echo-fold-logs"))

ANI = ['水獭','狐狸','渡鸦','水母','狼','鲸','猫头鹰','蝙蝠','章鱼','麋鹿','企鹅','黑猫','海豚','老虎','刺猬','蝴蝶']
EMO = ['🦦','🦊','🐦⬛','🪼','🐺','🐋','🦉','🦇','🐙','🦌','🐧','🐈⬛','🐬','🐯','🦔','🦋']

def norm(s):
    # emoji 带 variation selector(️)/ZWJ 等，比对前先规范化，避免相同 emoji 被当成不同
    if s is None: return None
    return unicodedata.normalize('NFC', s).replace('\uFE0F','').replace('\u200d','').strip()

def expected_emoji(name):
    for i,a in enumerate(ANI):
        if name.endswith(a): return EMO[i]
    return None

import urllib.parse

def pick_page():
    pages = json.load(urllib.request.urlopen(CDP + "/json/list", timeout=10))
    pages = [p for p in pages if p.get("type")=="page"]
    # 优先 about:blank，其次任意页（会被我们导航到目标 URL）
    for p in pages:
        if p.get("url","").startswith("about:blank"): return p
    return pages[0]

def ws_connect(page):
    import websocket
    return websocket.create_connection(page["webSocketDebuggerUrl"], timeout=15, suppress_origin=True)

def ev(ws, expr, seq, await_promise=True):
    seq[0]+=1
    ws.send(json.dumps({"id":seq[0],"method":"Runtime.evaluate","params":{
        "expression":expr,"returnByValue":True,"awaitPromise":await_promise}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==seq[0]:
            if "exceptionDetails" in m.get("result",{}):
                raise RuntimeError("JS 异常: "+json.dumps(m["result"]["exceptionDetails"])[:300])
            return m.get("result",{}).get("result",{}).get("value")

def screenshot(ws, seq, path):
    seq[0]+=1
    ws.send(json.dumps({"id":seq[0],"method":"Page.captureScreenshot","params":{"format":"png"}}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==seq[0]:
            data=m.get("result",{}).get("data")
            if data: Path(path).write_bytes(base64.b64decode(data))
            return

# 脏数据用例：模拟线上真实会出现的错配形态
CASES = [
    {"name":"case-clean-temp","id":{"id":None,"name":"量子狐狸","emoji":"🦊","color":"#00E5D4"},"registered":False},
    {"name":"case-mismatch-fox-icon","id":{"id":None,"name":"午夜狼","emoji":"🦊","color":"#C77DFF"},"registered":False},   # 名字狼但 emoji 狐狸→错配
    {"name":"case-default-fox-fallback","id":{"id":None,"name":"深海鲸","emoji":"🦊","color":"#6486FF"},"registered":False}, # boot 默认🦊 fallback 错配
    {"name":"case-legacy-raven","id":{"id":None,"name":"银河渡鸦","emoji":"🐺","color":"#22FF95"},"registered":False},       # 旧版残留
    {"name":"case-registered-custom","id":{"id":"u1","name":"主人","emoji":"👑","color":"#F5D06A","registered":True,"username":"master"},"registered":True}, # 正式账号自定义, 不该被改
]

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seq=[0]
    page=pick_page()
    ws=ws_connect(page)
    seq[0]+=1
    ws.send(json.dumps({"id":seq[0],"method":"Page.enable"}))
    while True:
        m=json.loads(ws.recv())
        if m.get("id")==seq[0]: break
    ev(ws, "location.href="+json.dumps(URL)+"; true", seq, await_promise=False)
    time.sleep(6)
    # 等页面 ready + 身份函数就绪
    for _ in range(40):
        r=ev(ws,"(document.readyState==='complete' && typeof loadOrRollIdentity==='function' && typeof paintIdentity==='function')",seq)
        if r: break
        time.sleep(0.5)
    results=[]; failed=0
    for c in CASES:
        # 注入脏缓存 → 重新加载身份并绘制
        inject = ("(()=>{ localStorage.setItem('eh_identity_v2', %s); "
                  "me=null; loadOrRollIdentity(); paintIdentity(); "
                  "const av=document.getElementById('idAv'), nm=document.getElementById('idName'); "
                  "return JSON.stringify({avEmoji:(av?av.textContent:null), name:(nm?nm.textContent:null), "
                  "meEmoji:(me?me.emoji:null), meReg:(me?!!me.registered:null)}); })()"
                 ) % json.dumps(json.dumps(c["id"], ensure_ascii=False), ensure_ascii=False)
        raw=ev(ws, inject, seq)
        got=json.loads(raw)
        shot=str(OUT/("idcheck-%s.png"%c["name"]))
        screenshot(ws, seq, shot)
        exp=expected_emoji(got["name"] or "")
        if c["registered"]:
            ok=True; note="正式账号不强制(自定义头像=%s)"%got["avEmoji"]
        else:
            ok=(norm(got["avEmoji"])==norm(exp)) and (norm(got["avEmoji"])==norm(got["meEmoji"]))
            note=("配套" if ok else "错配! 名字末尾应为 %s，实际渲染 %s"%(exp,got["avEmoji"]))
        if not ok: failed+=1
        results.append({"case":c["name"],"name":got["name"],"rendered_emoji":got["avEmoji"],
                        "expected_emoji":exp,"me_emoji":got["meEmoji"],"registered":got["meReg"],
                        "ok":ok,"note":note,"shot":shot})
        print(("✅" if ok else "❌"), c["name"], "|", got["name"], "→", got["avEmoji"],
              "(应为", exp, ")" if not c["registered"] else "(正式账号)", "|", note)
    # 反证：临时禁用纠偏，截图里的“量子水獭配🦊”必须被同一判据抓红。
    old_raw=ev(ws, "(()=>{const keep=reconcileEmoji; reconcileEmoji=()=>false; "
                       "localStorage.setItem('eh_identity_v2',JSON.stringify({id:null,name:'量子水獭',emoji:'🦊',color:'#00E5D4'})); "
                       "me=null; loadOrRollIdentity(); paintIdentity(); "
                       "const r={name:document.getElementById('idName').textContent,avEmoji:document.getElementById('idAv').textContent,meEmoji:me.emoji}; "
                       "reconcileEmoji=keep; return JSON.stringify(r)})()", seq)
    old=json.loads(old_raw); old_exp=expected_emoji(old['name'])
    old_caught=norm(old['avEmoji']) != norm(old_exp)
    print(("✅" if old_caught else "❌"), "旧实现反证 |", old['name'], "→", old['avEmoji'], "(应为", old_exp, ")",
          "| 同一视觉判据已抓红" if old_caught else "| 反证失败")
    ws.close()
    out=OUT/("idcheck-%s.json"%time.strftime("%Y%m%d-%H%M%S"))
    out.write_text(json.dumps({"url":URL,"failed":failed,"total":len(CASES),"old_impl_counterexample_caught":old_caught,"results":results},ensure_ascii=False,indent=2))
    print("\n报告:", out, "| 当前实现失败", failed, "/", len(CASES), "| 旧实现抓红", old_caught)
    return 0 if failed==0 and old_caught else 1

if __name__=="__main__":
    import sys
    try: sys.exit(main())
    except Exception as e:
        print(json.dumps({"error":str(e)},ensure_ascii=False)); sys.exit(2)
