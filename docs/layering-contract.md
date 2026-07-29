# Echo Hall 浮层层级契约

> 目的：约束新增与调整浮层时的堆叠关系，避免把“相同 z-index”一律误判为冲突，也避免继续任意堆高数值。

## 1. 语义容器

- `#fx-bg`：背景、氛围与非交互视觉效果；
- `#fx-ix`：互动、入场、KO、世界横幅等瞬时特效；
- `#fx-modal`：弹窗、抽屉、toast 与录音遮罩；
- `#pwaSplash`、`#pullRefresh`：系统级特殊层，保留在语义容器外。

## 2. 层级区间

| 区间 | 用途 | 当前代表 |
|---:|---|---|
| 0–2 | 静态背景与氛围 | grid、orb、edgeFade、moodAura |
| 38–44 | 房间内持续视觉效果 | soundwave、resonance、particles、projectile、nightBadge |
| 58–64 | 互动瞬时特效 | sweep、glow、ring、flash、rain、word、combo、counter、guard |
| 70–72 | 可交互浮动菜单 | actRing、peerMenu |
| 82–90 | 抽屉、录音与通知 | drawer、recOverlay、worldBanner、toast |
| 95–97 | 全屏场景与弹窗 | entStage、modal、KO、tarot、card、bottle |
| 9997–100000 | 系统级过渡／刷新／PWA 开屏 | warp、pullRefresh、pwaSplash |

## 3. 相同 z-index 的判定

以下同级是有意设计，不是待修冲突：

- `.bg-grid` 与 `.bg-orb`：同一背景平面，DOM 顺序决定叠加；
- `.mood-aura` 与 `#moodTintLayer`：顶部／底部情绪雾，同级且空间不重叠；
- `.ix-glow` 与 `.ix-ring`：命中特效同一视觉平面；
- `#ixFlash`、`.ix-rain`、`.ix-float`：互动粒子同一平面；
- `#ixWord` 与 `.ix-combo`：冲击文字同一平面；
- `#counterBtn` 与 `#guardBtn`：同时出现、位置错开、必须同级；
- `#cardMask` 与 `#bottleMask`：业务上互斥的全屏弹层；
- `.modal-mask` 与 `#entStage`、`#tarotMask` 与 `#koStun`：场景互斥，保留相同层级。

## 4. 新增／修改规则

1. 新浮层必须放入对应语义容器；
2. 优先复用本区间已有层级，不得随意使用四位以上 z-index；
3. 同级元素必须满足至少一项：业务互斥、空间不重叠、同一视觉平面；
4. 若同级且可能同时覆盖同一区域，必须明确 DOM 顺序或调整为相邻层级；
5. 修改层级前必须验证日／夜模式、大厅／房间、互动／弹窗组合；
6. `warp`、`pullRefresh`、`pwaSplash` 属系统级例外，不能被普通业务层覆盖；
7. 详细现状见 [`fixed-layer-map.md`](./fixed-layer-map.md)。

## 5. 阶段 F 结论

对现有相同 z-index 组合逐组复核后，未发现可在不改变视觉语义的前提下机械拆开的“真实冲突”。本阶段的正确收敛是：

- 完成语义容器归组；
- 明确层级区间和同级理由；
- 禁止以后继续任意增加层级；
- 保留当前经过验证的视觉顺序，不为数字整齐制造回归。
