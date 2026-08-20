# 聊天室消息重复显示：历史分批插入判重快照过期

## 现象
聊天室运行一段时间、重连或公开房后台补历史后，同一条聊天内容可能在消息流中出现两次。

## 根因假设（单一）
`prependMissingPublicHistory()` 在任务开始时只采集一次 `present` 集合，然后通过 idle 分批插入旧历史。等待 idle 的窗口内，realtime INSERT 或尾部补拉可能已经插入同一 `data-mid`；批次执行时不再检查当前 DOM，仍将该消息追加，形成重复节点。

## 修复方案
在每个 idle 批次真正构建 fragment 前，按当前 `#stream [data-mid]` 再做一次判重；批内同时维护 `batchSeen`，确保同 mid 在单批输入中也只插入一次。保留原有锚点与滚动位置恢复逻辑。

## 验证
- 新增旅程模拟：历史任务拍快照后，realtime 先插入同 mid，历史批次执行时必须跳过。
- 同批重复 mid 只能构建一个节点。
- 不重复的旧历史仍按原顺序插入顶部。
- 运行完整 `bash scripts/ci-check.sh`。
