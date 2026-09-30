# Echo Hall 真歌方案 — 母版翻唱架构设计（7/11）

## 核心原理
用户输入词 → 随机选该曲风一首"母版歌" → **立即播母版的前奏段(0延迟真乐器)** → 同时后台调 MiniMax `music-cover` 用**母版feature_id + 用户词**翻唱 → 翻唱结果严格沿用母版BPM/结构/曲风 → 前奏放完无缝切入翻唱的唱段。

## 三大改造块

### ① 母版库（静态资源 + 元数据 JSON）
每曲风 5 首母版，每首预处理拿到：
```json
{
  "sid": "dj",
  "idx": 1,
  "mp3_url": "https://.../masters/dj_1.mp3",   // 母版真歌(存 Supabase Storage 或 GitHub Pages)
  "feature_id": "ccdcace05706...",              // 24h过期! 需定期刷新或运行时现处理
  "structure": {"intro":[0,17.04],"verse":[17.04,41.4],"chorus":[41.4,54.7]},
  "duration": 54.7
}
```
**⚠️ feature_id 24h 过期问题**：不能预存死。方案：
- (A) 运行时用户点击时，后台先 preprocess 母版(1s)拿新 feature_id，再 cover。多 1s 可接受(前奏在放)
- (B) 定时任务每天刷新 feature_id 缓存
- **选 A**：简单，1s 在前奏播放期内消化掉

### ② Edge Function 改造（新增 cover 端点）
现有 `eh-sing-tts`(TTS念字)。新增/改造成 `eh-sing-cover`:
```
POST /functions/v1/eh-sing-cover
body: { masterUrl, lyric, prompt }
流程:
  1. preprocess(masterUrl) → feature_id + structure  (~1s)
  2. music-cover-free(feature_id, 用户lyric改写成[Chorus]带括号伴唱, prompt) → 翻唱mp3 (~39s)
  3. 返回 { coverMp3_b64, structure }
```
- key 藏 Edge Function 环境变量(同 eh-sing-tts 的 MIFY key 模式) → **需把 MiniMax key 存 Supabase secret**
- stream:true 可选(首块17s) — 先用非stream(简单), 后续优化

### ③ 前端播放逻辑（playSong 新增真歌分支）
```
用户点生成:
  1. 选曲风sid → 从母版库随机选一首 master
  2. 立即 fetch master.mp3_url → 播 intro段(0→structure.intro[1]) [0延迟真乐器]
  3. 同时 POST eh-sing-cover(masterUrl, 用户词, prompt) [后台]
  4. 前奏快放完(intro末-2s)时:
     - cover已回: 定位cover的chorus段, crossfade 1.5s切入
     - cover未回(17s前奏 < 39s生成): loop intro 或 播master的verse段兜底, 等cover回来再切
  5. 播完onEnd
```
**空窗填充(17s前奏 vs 39s生成, 差22s)**:
- 前奏放完还差~22s → 继续播**母版自己的 verse+chorus段**(真歌!不是哼唱)兜底
- cover回来 → 在下个乐句边界 crossfade 切入 cover 的对应段
- 因为母版和cover同结构, 切换点天然对齐

## 待定决策(问主人)
1. **前奏空窗填法**: loop前奏 / 播母版verse段兜底(推荐后者,真歌更顺)
2. **切换**: hard硬切 / xfade交叉淡化1.5s(推荐xfade)
3. **key存储**: 存 Supabase Edge Function secret(产品化必须) — 需主人同意
4. 母版存哪: Supabase Storage / GitHub Pages(echo-hall repo)

## 生成进度
- 25首母版生成中(/tmp/mv/{sid}_{idx}.mp3), 5曲风×5变体
- prompt用官方英文genre标签, 歌词带括号伴唱
