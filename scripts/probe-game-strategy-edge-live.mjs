// 真实端点认证旅程；创建专用临时用户，finally删除；不输出凭据。
// 用法：SUPABASE_ACCESS_TOKEN=<从安全文件读取> node scripts/probe-game-strategy-edge-live.mjs
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
const ref='cddkniwbhvcbfgkgomtl', base=`https://${ref}.supabase.co`, endpoint=base+'/functions/v1/eh-game-strategy';
const token=process.env.SUPABASE_ACCESS_TOKEN || (await readFile('/tmp/sbp-token.txt','utf8')).trim();
const management=await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,{headers:{Authorization:'Bearer '+token,'User-Agent':'curl/8.0'},signal:AbortSignal.timeout(15000)});
if(!management.ok)throw Error('management_keys_'+management.status);
const keys=await management.json(), anon=keys.find(k=>k.name==='anon')?.api_key,service=keys.find(k=>k.name==='service_role')?.api_key;
if(!anon||!service)throw Error('keys_missing');
const adminHeaders={apikey:service,Authorization:'Bearer '+service,'Content-Type':'application/json'};
const email=`strategy-probe-${randomUUID()}@example.com`, password=randomUUID()+randomUUID();let uid;
const played=Array(18).fill(0);played[3]=2;
const payload={game:'ddz',input:{kind:'ddz',version:2,seat:0,landlord:1,last_seat:1,hand:[{rank:14,suit:'♠',joker:false}],hands_left:[1,5,6],public_counts:{played,known:1,unseen:51,total:54},table:null,level:null,board:[],opponents:2,pot:null,current_bet:null,to_call:null,street:null,phase:'play'}};
async function call(label,auth,body=payload,expected=200){const start=Date.now();const r=await fetch(endpoint,{method:'POST',headers:{apikey:anon,'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+auth}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(12000)});const d=await r.json();console.log(JSON.stringify({label,status:r.status,elapsed_ms:Date.now()-start,source:d.source,error:d.error,confidence:d.policy?.confidence}));if(r.status!==expected)throw Error(label+'_unexpected_status');return d;}
try{
 await call('无认证',null,payload,401);await call('伪造令牌','not-a-real-token',payload,401);
 const created=await fetch(base+'/auth/v1/admin/users',{method:'POST',headers:adminHeaders,body:JSON.stringify({email,password,email_confirm:true,app_metadata:{purpose:'eh-game-strategy-deployment-probe'}}),signal:AbortSignal.timeout(15000)});
 if(!created.ok)throw Error('create_probe_user_'+created.status);uid=(await created.json()).id;
 const login=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:anon,'Content-Type':'application/json'},body:JSON.stringify({email,password}),signal:AbortSignal.timeout(15000)});
 if(!login.ok)throw Error('probe_login_'+login.status);const session=await login.json();
 const valid=await call('真实用户非空局面',session.access_token);if(!['coach','local'].includes(valid.source))throw Error('missing_policy');let coachCount=valid.source==='coach'?1:0;
 const invalid=structuredClone(payload);invalid.input._deck=[];await call('真实用户非法隐藏字段',session.access_token,invalid,400);
 for(let i=0;i<4;i++){const d=await call('认证额度内请求'+(i+3),session.access_token);if(d.source==='coach')coachCount++;}
 await call('认证第七次限流',session.access_token,payload,429);
 if(!coachCount)throw Error('no_real_coach_success');
 console.log('真实模型成功次数 '+coachCount);
 console.log('端点 '+endpoint);
}finally{
 if(uid){const r=await fetch(base+'/auth/v1/admin/users/'+encodeURIComponent(uid),{method:'DELETE',headers:adminHeaders,signal:AbortSignal.timeout(15000)});console.log('临时认证用户清理状态 '+r.status);if(!r.ok)throw Error('probe_cleanup_failed');}
}
