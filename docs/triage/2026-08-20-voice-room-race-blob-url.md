# 语音上传跨房与 Blob URL 生命周期

## §1 现象
录音上传期间切房，旧实现上传路径在 await 前读取 A 房，但消息 insert 在 await 后读取全局 `curRoom.id`，可能把 A 房语音写进 B 房；本地 `URL.createObjectURL` 在成功、失败、切房时均未释放。

## §2 稳定复现
延迟 storage upload，期间 A→B；旧实现 insert 的 room_id 变为 B。循环失败录音可观察未释放对象 URL 累积。

## §3 单一根因假设
异步发送没有捕获房间身份与代次，也没有显式 Blob URL 所有权清理函数。

## §4 不变量
上传和消息写入固定使用开始时房间；每个 await 后校验 epoch+room id；成功、失败、切房均恰好释放本地对象 URL。

## §5 修复
捕获 `voiceRoomId/voiceEpoch`；insert 固定使用捕获 ID；上传和插入后校验；统一 `revokeLocal()` 覆盖所有出口。

## §6 验证
新增语音异步旅程和旧实现反证。

## §7 结果
待门禁回填。
