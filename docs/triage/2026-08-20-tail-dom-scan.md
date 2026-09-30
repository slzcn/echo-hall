# Echo Bug 诊断单：公共房轮询重复扫描 DOM

## 1．用户旅程
停留在接近 500 条消息的公共房 → 20 秒兜底刷新 → 页面应平滑，不出现周期性主线程尖峰。

## 2．稳定复现
每轮先扫全部 `[data-mid]`，随后最多 500 行各执行一次 `querySelector([data-mid=id])`。

## 3．单一根因假设
判重没有复用首轮 DOM 扫描结果，形成 O(rows×DOM) 选择器扫描。

## 4．验证方法
新增旅程／静态反证：一次构建 mid→element Map，循环只 O(1) 查询；旧实现每行 querySelector 必红。

## 5．回归矩阵
- 新消息追加
- 已有消息修复空框
- song pending 原地更新
- 灵魂队列去重
- 公共房 500 条

## 6．修复结果
每轮刷新只扫描一次 `[data-mid]` 并建立 `Map`，逐行判重改为 O(1)；新增／替换节点同步更新 Map，保留 song pending、空框修复、灵魂队列等原语义。新增 `journey-tail-dom-index.js`，旧逐行 selector 实现必红。

## 7．发布验证
相关旅程与 `node --check js/app.js` 已通过；待整批完整 CI、版本发布与线上复测。
