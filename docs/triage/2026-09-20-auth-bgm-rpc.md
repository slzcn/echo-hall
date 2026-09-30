# Echo — 继续 A/B/C: auth/bgm + requireViaRpc + 聊天功能

## A 续
- auth/bgm 模块真实现（身份重掷判定、BGM 开关/选曲/防重入）
- 修 journey 抓出的顺序 bug: 必须**先判断是否重掷，再清 registered 标记**

## B 续
- host `requireViaRpc: true`: 新客户端 act 必须 via=rpc（RPC 失败则不落子）
- 旧客户端无 via 字段仍兼容

## C 续
- `journey-auth-bgm-features.js`: auth/bgm + RPC + 语音/神曲/回声路径不变量
