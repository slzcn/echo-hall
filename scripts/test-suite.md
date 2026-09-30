# Echo 功能测试用例清单

按功能域组织。用例文件在 `scripts/`，统一入口 `bash scripts/run-suite.sh`。
完善约定：新功能落地时在对应域补用例；线上 bug 修完在对应回归条目追加。
错误监控接入约定见 `scripts/TEST-INTEGRATION.md`（对方提供 `scripts/error-monitor.js` 后自动挂钩）。

## 1. 身份 / 登录
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 匿名身份生成与保留 | `test-anon-identity.js` | 临时名不被登录冲掉 |
| 冷启动会话恢复 | `journey-cold-start-auth.js` | session 就绪前不误进房 |
| 登录身份绘制 | `journey-login-identity.js` | 正式账号显示/自愈 |
| 匿名首进完整旅程 | `journey-anon-first-time.js` | 首次进入不卡死 |

## 2. 房间
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 进出房生命周期 | `journey-room-lifecycle.js` | 进房/离房/last_room 清理 |
| 房间快照回填 | `journey-room-snapshot.js` | 刷新秒显 |
| 成员 upsert | `journey-member-upsert.js` | 重复加入不 409 |
| 私密房邀请码加入 | `test-private-invite-code.js` | 码校验/代插成员/裸 insert 拦截 |
| 进房锚点还原 | `journey-enter-room-latest-anchor.js` | 刷新回停留位置 |
| 房内在线光墙 | `journey-presence-unload.js` | 离开即退光墙 |

## 3. 聊天
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 消息收发核心 | `journey-chat-core.js` | 发送/回显/去重 |
| 发送单飞 | `journey-submit-singleflight.js` | 连点只发一条 |
| 发送失败恢复 | `journey-message-send-failure.js` | 失败可重试 |
| 历史重复竞态 | `journey-chat-duplicate-history-race.js` | 刷新不叠消息 |
| IME 组合输入 | `test-composer-ime.js` / `journey-composer-ime.js` | 中文输入 Enter 语义 |
| 历史滚动 | `journey-history-scroll.js` | 上翻加载 |
| 公开房历史上限 | `journey-public-history-cap.js` | 500 条封顶 |

## 4. 牌桌多人
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 多人进同一桌 | `journey-multiplayer-join.js` | 统一入座/lobby 客人/活桌浮出/错游戏提示 |
| 德州联机协议 | `journey-poker-online.js` | 快照无泄露/私牌隔离/host 权威 |
| 斗地主联机协议 | `journey-ddz-online.js` | 同上 |
| 掼蛋联机协议 | `journey-guandan-online.js` | 同上 |
| 双人德州 UI | `probe-poker-two-player.js` | 客人出牌/结算一致/uid 认座 |
| 联机断线自愈 | `journey-gt-online-heal.js` | 重连续局 |
| GT act RPC | `journey-gt-act-rpc.js` | 动作回传校验 |
| 座位补齐 | `test-fill-seat.js` / `journey-fill-seat-all.js` | 空位/AI 顶位 |
| 旁观让座 | `probe-poker-spectate-consistency.js` | 腾座显示一致 |
| 多人进桌回归（补充） | `test-gt-join-matrix.js` | 入座矩阵/满座分流/away |
| 斗地主/掼蛋对标德州 | `journey-ddz-gd-upgrade.js` | 让座/单机守卫/空位入座/文案 |
| 斗地主/掼蛋观感一致 | `journey-ddz-gd-polish.js` | 锁定可发现/提示出处/教练介入/按钮规格 |
| 牌桌落点/刷新还原 | `journey-table-polish.js` | 下注筹码避公共牌/刷新留在牌局 |

## 5. 游戏规则
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 斗地主规则/引擎/提示/倍数 | `test-ddz-rules.js` `test-ddz-engine.js` `test-ddz-hint.js` `test-ddz-double.js` `test-ddz-quad.js` | 出牌合法性/地主/炸弹 |
| 斗地主发牌公平 | `test-ddz-landlord-fairness.js` | 地主轮转 |
| 掼蛋规则/进贡/配牌/报牌 | `test-guandan-rules.js` `test-guandan-tribute.js` `test-guandan-follow-split.js` `test-guandan-spoken.js` | 级别/红配/接风 |
| 德州评估/引擎/全下/摊牌 | `test-poker-eval.js` `test-poker-engine.js` `test-poker-allin.js` `test-pk-settle-nums.js` | 牌型/边池/结算数字 |
| 模糊测试 | `test-ddz-fuzz.js` `test-guandan-fuzz.js` `test-poker-fuzz.js` | 随机局面不崩 |

## 6. 积分 / 每日上限
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 跨局筹码累计 | `test-bankroll.js` | uid 账本/灵魂记账/匿名排除 |
| 匿名筹码旅程 | `journey-anon-bankroll.js` | 带入不重置 |
| 筹码真实性 | `journey-chip-authenticity.js` | 门禁/seatBuyIn |
| 每日输光上限（补充） | `test-daily-bust-limit.js` | 分游戏 5 次/只记输光 |

## 7. 音频
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 音频开关互斥 | `probe-audio-switch-matrix.js` / `journey-audio-exclusive.js` | 三开关不串 |
| 本房 BGM | `journey-song-public.js` / `journey-song-heal.js` | 随机循环/自愈 |
| 作曲进度 | `test-bgm-progress-title.js` / `journey-bgm-compose.js` | 进度/禁重入 |
| BGM 鉴权 | `test-bgm-auth.js` | 令牌/401 刷新 |
| 音频缓存 | `journey-audio-cache-limit.js` | 上限回收 |

## 8. UI / 触控 / 主题
| 用例 | 文件 | 覆盖 |
|---|---|---|
| 触控目标 ≥44px | `journey-btn-tap.js` | 按钮尺寸 |
| 文案结构一致 | `journey-ui-consistency.js` | 出口/等待/预选 queued |
| 对话框 a11y | `journey-dialog-a11y.js` | 焦点陷阱 |
| 核心控件 a11y | `journey-core-controls-a11y.js` | 键盘可达 |
| 键盘收起/折叠 | `journey-kb-*.js` | 输入法布局 |
| PWA 方向/入口 | `journey-pwa-orientation.js` / `journey-pwa-lobby-btn.js` | 横竖屏/安装 |

## 9. 平台 / 安全 / 监控
| 用例 | 文件 | 覆盖 |
|---|---|---|
| SW 版本化缓存 | `test-sw-versioned-js-cache.js` | URL 指纹 |
| Edge 鉴权 | `test-edge-auth.js` | 令牌/越权/输入边界 |
| 错误监控桥接 | `test-error-monitor-bridge.js` | reportRun/collect/isCovered |
| 版本四元组 | `ci-check.sh` §3 | ver/BUILD/APP/SW 一致 |
| 旅程覆盖门 | `journey-gate.py` | 生产改动须有 journey |

## 跑测节奏
- **每次提交前**：`bash scripts/run-suite.sh quick`
- **每日/定期**：`bash scripts/run-suite.sh full`
- **改动游戏规则后**：`bash scripts/run-suite.sh games`
- **改动联机/多人后**：`bash scripts/run-suite.sh multiplayer`
- **线上巡检/补缺口**：`bash scripts/run-suite.sh monitor`（拉 `eh_errors` 标未覆盖）
