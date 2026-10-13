# Echo Hall 错误处理指南

## 三层监控体系(v137-v138)

```
┌────────────────────────────────────────────────┐
│ L1: 全局兜底(自动)                              │
│   window.onerror → ehReportError('js_error')   │
│   unhandledrejection → ehReportError('promise')│  → 上报 eh_errors 表
├────────────────────────────────────────────────┤
│ L2: 本地追踪(所有 catch)                       │
│   _ehCatch(scope, error) → ring buffer(200条)  │  → 本地,ehDumpLog() 可取
├────────────────────────────────────────────────┤
│ L3: 分级埋点(v138 新增)                        │
│   _ehTrack(scope, error, critical)              │
│     → 永远进 ring buffer                        │
│     → critical=true 额外上报 DB                 │
│   (受 v137 去重+预算保护,60s 去重,会话上限 200)│
└────────────────────────────────────────────────┘
```

---

## 使用指南

### 1. 防御性 catch — 保持静默

**场景**: DOM 可能不存在、音效播放失败、浏览器 API 缺失、localStorage 满、清理资源失败

```js
// ✓ 正确:空 catch,或仅本地追踪
try{ document.querySelector('.foo').classList.add('bar'); }catch(_){}
try{ localStorage.setItem('key', val); }catch(e){ _ehCatch('storage', e); }
try{ await sb.removeChannel(chan); }catch(_){}  // 清理失败不影响主流程
```

**原则**: 如果失败**不影响用户体验**且**预期会发生**(弱网/旧浏览器/快速切换),就不上报。

---

### 2. 关键路径 — 分级上报

**场景**: 进房失败、发消息失败、游戏桌初始化失败、支付失败

```js
// ✓ 正确:用 _ehTrack(scope, error, true)
try{
  const {data, error} = await sb.from('eh_rooms').select('*').eq('id', rid).single();
  if(error) throw error;
}catch(e){
  _ehTrack('enterRoom', e, true);  // 本地 + 上报 DB
  toast('进房失败,请重试');
  return;
}
```

**原则**: 如果失败**阻断核心功能**且**不该频繁发生**,设 `critical=true` 上报 DB。

---

### 3. 已有显式处理 — 不改

**场景**: 代码里已经有 toast/sysMsg/UI 反馈

```js
// ✓ 正确:已有 UI 反馈,无需额外上报
try{
  const res = await sb.from('eh_messages').insert({...});
  if(!res.data) throw new Error('insert failed');
}catch(e){
  markSendFailed(mid);  // 已有 UI 标记+toast
  // 无需加 _ehTrack,用户已感知
}
```

**原则**: 如果失败**用户可见**(红色提示/toast/消息标记),就不需要额外上报 DB,因为用户会反馈。

---

### 4. 全局 onerror 兜底 — 无需 catch

**场景**: 未预期的 bug、逻辑错误、第三方库崩溃

```js
// ✓ 正确:不 catch,让 onerror 捕获
async function processData(data){
  const result = await complexLogic(data);  // 如果崩溃,onerror 会自动上报
  return result;
}
```

**原则**: **意外错误不该被 catch** — 它们会冒泡到 `window.onerror`,自动上报且带完整 stack。只 catch **预期的错误**(网络抖动/DOM 缺失)。

---

## 去重+预算保护(v137)

ehReportError 自动去重+限流:
- **去重**: 同 `kind:message` 前100字符,60s 内只报首次
- **预算**: 每会话上限 200 条,超出静默(本地 ring buffer 仍可用)

**影响**: 可以放心在更多地方用 `_ehTrack(critical=true)`,不会刷爆 eh_errors 表。

---

## 排查工具

### 本地调试
```js
// 浏览器控制台
ehDumpLog()  // 查看最近 200 条 catch(包括空 catch 标记的)
```

### 线上问题
查 `eh_errors` 表:
```sql
SELECT * FROM eh_errors 
WHERE kind='tracked' AND created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

---

## 何时修改现有空 catch?

**不需要**批量改 1000+ 个空 catch。只在以下情况修改:

1. **线上用户报 bug,但查不到日志** → 在该路径加 `_ehTrack(critical=true)`
2. **新增关键功能**(支付/实名)→ 从一开始就用 `_ehTrack(critical=true)`
3. **重构时顺手** → 如果正在改某函数,顺便评估其 catch 是否该升级

**原则**: 按需修,数据驱动,不做无收益的批量改动。

---

## 附:统计数据(v138)

- 空 catch 总数: ~1043 (多层嵌套统计)
- 其中防御性(DOM/audio/storage/清理): ~46%
- 关键路径网络调用: ~11% (58 处,但多数已有显式处理)
- 现状:**全局 onerror 已兜住未捕获错误,关键路径多数有显式处理,空 catch 问题被过度放大**

v137-v138 提供了基础设施,未来按需渐进式加 critical 标记即可。
