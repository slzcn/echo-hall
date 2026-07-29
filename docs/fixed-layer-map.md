# 回声厅 fixed 装饰层堆叠图谱

生成时间: 2026-07-29 · 用于色块/浮层堆叠 bug 排查

| z-index | 选择器 | opacity | pointer-events | background |
|--|--|--|--|--|
| - | `@media(max-width:600px)` | - | - | - |
| 0 | `.bg-grid` | - | none | - |
| 0 | `.bg-orb` | .4 | none | - |
| 1 | `#edgeFade` | - | none | linear-gradient(to bottom,
      transparent 0,
   |
| 1 | `body.priv-heat::before` | - | none | radial-gradient(ellipse 70% 55% at 50% 78%, color- |
| 2 | `.mood-aura` | 0 | none | radial-gradient(ellipse 80% 100% at 50% 0%,var(--m |
| 2 | `#moodTintLayer` | 0 | none | radial-gradient(ellipse 90% 100% at 50% 100%,var(- |
| 38 | `#soundwave` | 0 | none | - |
| 39 | `#resonance` | 0 | none | - |
| 39 | `body.deep-night::after` | .6 | none | radial-gradient(ellipse 120% 60% at 50% 100%,color |
| 40 | `#particles` | - | none | - |
| 41 | `.proj` | - | none | - |
| 41 | `.night-badge` | 0 | none | - |
| 44 | `.type-spark` | - | none | var(--accent,var(--cyan)) |
| 58 | `#ixSweep` | 0 | none | - |
| 59 | `.ix-glow` | 0 | none | - |
| 59 | `.ix-ring` | 0 | none | - |
| 60 | `#ixFlash` | 0 | none | - |
| 60 | `.ix-rain` | - | none | - |
| 60 | `.ix-float` | - | none | - |
| 61 | `.ix-fly` | - | none | - |
| 62 | `#ixWord` | - | none | - |
| 62 | `.ix-combo` | - | none | - |
| 63 | `#counterBtn` | 0 | auto | linear-gradient(135deg,#E63946,#FF6B00) |
| 63 | `#guardBtn` | 0 | auto | linear-gradient(135deg,#2E86DE,#12B0E0) |
| 64 | `.guard-flash` | 0 | none | - |
| 70 | `.act-ring` | - | - | var(--panel-solid) |
| 72 | `.peer-menu` | 0 | - | var(--panel-solid) |
| 82 | `.drawer-mask` | - | - | var(--mask) |
| 83 | `.drawer` | - | - | var(--panel-solid) |
| 88 | `.rec-overlay` | - | none | radial-gradient(ellipse 60% 50% at 50% 60%,color-m |
| 88 | `#worldBanner` | 0 | none | linear-gradient(90deg,rgba(20,10,30,.92),rgba(40,2 |
| 90 | `#toast` | - | none | var(--panel-solid) |
| 95 | `#entStage` | - | none | - |
| 95 | `.modal-mask` | - | - | var(--mask) |
| 96 | `#koStun` | - | none | radial-gradient(circle at 50% 45%,rgba(20,6,30,.5) |
| 96 | `#tarotMask` | - | - | var(--mask) |
| 97 | `#cardMask` | - | - | rgba(6,4,14,.84) |
| 97 | `#bottleMask` | - | - | var(--mask) |
| 9997 | `#warp` | 0 | none | radial-gradient(circle at 50% 50%,transparent 0%,t |
| 9998 | `.cursor-trail` | - | none | radial-gradient(circle,var(--accent,var(--cyan)),t |
| 9999 | `#pullRefresh` | 0 | none | - |
| 100000 | `<style>
    
    #pwaSplash` | 1 | - | var(--bg,#070a12) |