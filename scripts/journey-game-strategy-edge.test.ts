import {createHandler, FALLBACK, validateInput, type Config} from "../supabase/functions/eh-game-strategy/index.ts";
// 诊断：旧函数把public_counts对象当rank表，真实非空计数变全零。
// 旅程：认证→严格输入→教练建议/本地回退；错误和超时绝不泄露上游内容。
const assert=(ok:unknown,msg="assertion failed")=>{if(!ok)throw Error(msg);};
export function fixture(kind="ddz"){
  const played=Array(18).fill(0);played[3]=2;
  return {game:kind,input:{kind,version:2,seat:0,landlord:kind==="ddz"?1:null,last_seat:1,hand:[{rank:14,suit:"♠",joker:false}],hands_left:kind==="ddz"?[1,5,6]:kind==="guandan"?[1,5,6,7]:[1,2],public_counts:{played,known:1,unseen:(kind==="ddz"?54:kind==="guandan"?108:52)-3,total:kind==="ddz"?54:kind==="guandan"?108:52},table:null,level:null,board:[],opponents:1,pot:null,current_bet:null,to_call:null,street:null,phase:"play"}};
}
const valid={...FALLBACK,target_seat:1,confidence:.8};
function setup(model:unknown=valid,opts:Partial<Config>={},mode="success"){
  const calls:{body:any}[]=[];
  const fetcher:typeof fetch=async(url,init)=>{
    if(String(url).endsWith("/auth/v1/user")){
      if(mode==="auth_timeout")return await new Promise(()=>{});
      if(mode==="auth_fail")return new Response("secret-auth",{status:401});
      if(mode==="auth_throw")throw Error("secret-auth-network");
      return Response.json({id:"user-1"});
    }
    calls.push({body:JSON.parse(String(init?.body))});
    if(mode==="timeout")return await new Promise(()=>{});
    if(mode==="network")throw Error("secret-key-upstream");
    if(mode==="failure")return new Response("secret-provider-body",{status:500});
    return Response.json({choices:[{message:{content:typeof model==="string"?model:JSON.stringify(model)}}]});
  };
  return {calls,handler:createHandler({url:"https://unit.test",anon:"test-anon",key:"sk-unit",base:"https://api.xiaomimimo.com/v1",model:"test",fetcher,authMs:20,modelMs:20,bodyMs:20,...opts})};
}
function request(body:unknown=fixture(),headers:Record<string,string>={}){return new Request("https://unit.test/strategy",{method:"POST",headers:{authorization:"Bearer test-token","content-type":"application/json",...headers},body:JSON.stringify(body)});}
Deno.test("非空公开计数与席位保留，三游戏均成功且模型只有高层schema",async()=>{
  for(const kind of ["ddz","guandan","poker"]){const {handler,calls}=setup();const r=await handler(request(fixture(kind))),d=await r.json();assert(r.status===200&&d.source==="coach");const input=JSON.parse(calls[0].body.messages[1].content);assert(input.public_counts.played[3]===2);assert(input.public_counts.known===1&&input.last_seat===1);assert(calls[0].body.messages[0].content.includes('"additionalProperties":false'));}
  const raw=fixture().input.public_counts as any;const old=Array.from({length:18},(_,i)=>raw[i]??0);assert(old[3]!==validateInput(fixture()).public_counts.played[3],"旧实现反证必须失败");
});
Deno.test("失败、超时、网络错误、空输出、低置信度、动作金额及非法schema均安全回退",async()=>{
  for(const [mode,model,error] of [["failure",valid,"model_unavailable"],["timeout",valid,"model_timeout"],["network",valid,"model_unavailable"],["success","","invalid_model_output"],["success","```json\n{}\n```","invalid_model_output"],["success",{...valid,action:"raise",amount:500},"invalid_model_output"],["success",{...valid,target_seat:3},"invalid_model_output"],["success",{...valid,confidence:"0.8"},"invalid_model_output"],["success",{...valid,confidence:0.54},"low_confidence"],["success",{...valid,ttl_ms:0},"invalid_model_output"],["success",{},"invalid_model_output"]] as const){const {handler}=setup(model,{},mode),r=await handler(request()),d=await r.json();assert(d.source==="local"&&d.error===error,JSON.stringify(d));assert(d.policy.confidence===0);assert(!JSON.stringify(d).includes("secret"));}
});
Deno.test("认证缺失无效错误超时均拒绝且不调用模型",async()=>{
  for(const [mode,status,error] of [["auth_fail",401,"invalid_token"],["auth_timeout",503,"auth_timeout"],["auth_throw",503,"auth_unavailable"]] as const){const {handler,calls}=setup(valid,{},mode),r=await handler(request()),d=await r.json();assert(r.status===status&&d.error===error&&calls.length===0);}
  const {handler}=setup();assert((await handler(request(fixture(),{authorization:""}))).status===401);
});
Deno.test("严格输入拒绝隐藏字段、数值字符串、计数不符、非法席位和格式",async()=>{
  const mutations=[(b:any)=>b.input._deck=[],(b:any)=>b.input.hand[0].extra="secret",(b:any)=>b.input.hand[0].rank="14",(b:any)=>b.input.seat=3,(b:any)=>b.input.public_counts.known=0,(b:any)=>b.input.public_counts.played[3]=8,(b:any)=>b.input.last_seat=8,(b:any)=>b.game="poker",(b:any)=>b.input.action="raise",(b:any)=>delete b.input.landlord];
  for(const change of mutations){const {handler,calls}=setup(),b=fixture();change(b);assert((await handler(request(b))).status===400);assert(calls.length===0);}
  const {handler}=setup();const malformed=new Request("https://unit.test",{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json"},body:"{"});assert((await handler(malformed)).status===400);
});
Deno.test("无content-length分块体超18k与多字节均被拒绝",async()=>{
  const {handler}=setup();let cancelled=false;
  const body=new ReadableStream<Uint8Array>({pull(c){c.enqueue(new TextEncoder().encode("中".repeat(4000)));},cancel(){cancelled=true;}});
  const r=await handler(new Request("https://unit.test",{method:"POST",headers:{authorization:"Bearer token","content-type":"application/json"},body}));assert(r.status===413&&cancelled);
});
Deno.test("同用户6/min、失败不绕过、过期清理及容量有界",async()=>{
  let now=0;const {handler}=setup(valid,{now:()=>now});for(let i=0;i<6;i++)assert((await handler(request())).status===200);assert((await handler(request())).status===429);now=60000;assert((await handler(request())).status===200);
  let id="u1";const limited=setup(valid,{maxUsers:1,now:()=>now,fetcher:async()=>Response.json({id})}).handler;
  await limited(request());id="u2";assert((await limited(request())).status===429);now+=60000;assert((await limited(request())).status===200);
});
Deno.test("认证后共享限流在不同handler实例间生效且故障关闭",async()=>{
  let hits=0;
  const fetcher:typeof fetch=async(url)=>String(url).includes('/auth/v1/user')?Response.json({id:'user-1'}):String(url).includes('/rest/v1/rpc/')?Response.json(++hits<=6):Response.json({choices:[{message:{content:JSON.stringify(valid)}}]});
  for(let i=0;i<7;i++){const {handler}=setup(valid,{service:'test-service',fetcher});const r=await handler(request());assert(r.status===(i<6?200:429));}
  const {handler}=setup(valid,{service:'test-service',fetcher:async(url)=>String(url).includes('/auth/v1/user')?Response.json({id:'user-1'}):new Response('secret-rpc',{status:500})});const r=await handler(request());assert(r.status===503);assert((await r.json()).error==='rate_unavailable');
});
Deno.test("慢速body超时关闭流且不发模型请求",async()=>{
  let cancelled=false;const {handler,calls}=setup();
  const body=new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
  const r=await handler(new Request('https://unit.test',{method:'POST',headers:{authorization:'Bearer token','content-type':'application/json'},body}));assert(r.status===503);assert((await r.json()).error==='body_timeout');assert(cancelled&&calls.length===0);
});
Deno.test("认证和模型慢响应流随超时取消",async()=>{
  for(const stage of ['auth','model']){let cancelled=false;const slow=()=>new Response(new ReadableStream<Uint8Array>({start(c){c.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}}));
    const fetcher:typeof fetch=async(url)=>String(url).includes('/auth/v1/user')?(stage==='auth'?slow():Response.json({id:'user-1'})):slow();
    const {handler}=setup(valid,{fetcher});const r=await handler(request()),d=await r.json();assert(d.error===(stage==='auth'?'auth_timeout':'model_timeout'));assert(cancelled);
  }
});
Deno.test("tp key拒绝及允许方法、类型约束",async()=>{
  const {handler,calls}=setup(valid,{key:"tp-not-allowed"});const d=await(await handler(request())).json();assert(d.error==="strategy_unavailable"&&calls.length===0);assert((await handler(new Request("https://unit.test"))).status===405);assert((await handler(new Request("https://unit.test",{method:"OPTIONS"}))).status===200);assert((await handler(request(fixture(),{"content-type":"text/plain"}))).status===415);
});
