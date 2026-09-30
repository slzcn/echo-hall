/**
 * echo-hall · 房间氛围感知引擎 mood-engine.js
 * ---------------------------------------------------------------------------
 * 根据房间里最近消息的情绪/关键词/emoji 密度, 实时驱动背景色调与粒子光效,
 * 让房间有"活的"氛围感。与 ambient-fx.js 的 moodWeather 互补:
 *   - moodWeather: 轮询 roomSouls 灵魂主导情绪, 偏宏观/低频
 *   - MoodEngine : 由 app.js 在每次消息渲染后 feed(recentMsgs), 偏实时/细粒度
 *
 * 两者都写同一套 CSS 变量(--mood-tint / data-mood / mood-tinted),
 * MoodEngine 额外引入 --mood-intensity 与 mood-busy / mood-quiet body class,
 * 供 mood-engine.css 控制粒子速度、霓虹强度、饱和度。
 *
 * 用法(app.js 接入):
 *   <script src="js/ambient-fx.js"></script>
 *   <script src="js/mood-engine.js"></script>            <!-- 在 ambient-fx 之后 -->
 *   <link rel="stylesheet" href="css/mood-engine.css">   <!-- 在现有 mood 相关 CSS 之后 -->
 *
 *   // 在渲染最近消息后调用(进房 + 每条新消息后):
 *   if (window.EhMoodEngine) {
 *     const recent = (window.recentMessages || []).slice(-20);
 *     EhMoodEngine.feed(recent);   // 内部自动 apply
 *   }
 *
 *   // 离房时清理:
 *   if (window.EhMoodEngine) EhMoodEngine.reset();
 *
 * 依赖: 无。原生 JS, 不引用任何外部库。
 * 作者: echo-hall ambient 团队
 * ---------------------------------------------------------------------------
 */
(function () {
  'use strict';

  // 减少动效偏好: 直接空实现, 不改 DOM(尊重无障碍)
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion:reduce)').matches;

  // ---- 情绪关键词词表(中英文混合, 小写匹配) ----
  // 每条: { words:[...], weight:0~1, type:'excited'|'happy'|'melancholy'|'tense' }
  // weight 代表该词对所属情绪的"贡献度", 多词命中累加。
  var LEXICON = [
    // excited: 热烈 / 高能 / 赞爆
    { type: 'excited', weight: 0.9, words: ['哈哈哈哈', '哈哈哈', '666', '牛掰', '牛逼', '起飞', '绝了', '太棒了', 'lmao', 'woo', 'yesss', 'hyped', '燃起来了'] },
    { type: 'excited', weight: 0.5, words: ['哈哈', '嘻嘻', '耶', '牛', 'nb', '秀', '厉害', '绝', '冲', '燃', 'nice', 'awesome', 'great', 'wow', 'lol', '6'] },
    // happy: 开心 / 温暖
    { type: 'happy', weight: 0.7, words: ['开心', '高兴', '好开心', '嘿嘿', '甜', '幸福', 'sweet', 'happy', 'glad', 'love it'] },
    { type: 'happy', weight: 0.4, words: ['喜欢', '好耶', '可爱', '萌', 'cute', 'lovely'] },
    // melancholy: 难过 / 低落 / 冷清感
    { type: 'melancholy', weight: 0.8, words: ['难过', '伤心', '好累', '郁闷', '孤独', '想念', '怀念', 'sad', 'lonely', 'tired', 'exhausted', 'miss you', 'depressed'] },
    { type: 'melancholy', weight: 0.5, words: ['唉', '烦', '累', '无聊', '想哭', '想家', '心累', 'emo'] },
    // tense: 惊讶 / 紧张 / 震惊
    { type: 'tense', weight: 0.9, words: ['卧槽', '我去', '我靠', '震惊', '天哪', '我的天', 'wtf', 'omg', 'holy shit', 'no way'] },
    { type: 'tense', weight: 0.5, words: ['哇', '晕', '啊这', '不是吧', '？！', 'damn', 'shit', 'crazy'] }
  ];

  // ---- emoji → 情绪归类(用码点区间粗判 + 常见表情精确匹配) ----
  // 返回该 emoji 命中的情绪类型, 或 null(中性 emoji)。
  var EMOJI_MAP = {
    // excited / 大笑
    '\u{1F602}': 'excited', '\u{1F923}': 'excited', '\u{1F606}': 'excited',
    '\u{1F525}': 'excited', '\u{1F973}': 'excited', '\u{1F44D}': 'excited', '\u{1F64F}': 'excited',
    // happy / 温和喜悦
    '\u{1F60A}': 'happy', '\u{1F604}': 'happy', '\u{1F642}': 'happy',
    '\u{2764}': 'happy', '\u{1F495}': 'happy', '\u{1F60D}': 'happy', '\u{1F970}': 'happy',
    // melancholy
    '\u{1F622}': 'melancholy', '\u{1F62D}': 'melancholy', '\u{1F614}': 'melancholy',
    '\u{1F615}': 'melancholy', '\u{1F494}': 'melancholy', '\u{1F97A}': 'melancholy',
    // tense / 震惊
    '\u{1F631}': 'tense', '\u{1F62E}': 'tense', '\u{1F632}': 'tense',
    '\u{1F628}': 'tense', '\u{1F630}': 'tense'
  };

  // 情绪 → 氛围色(tint)。calm 留空, 让房间回归主题色(与 ambient-fx 约定一致)。
  var TINTS = {
    excited:    '#FF6B35',  // 暖橙霓虹
    happy:      '#FFC24D',  // 暖黄
    calm:       '',         // 清空, 回归房间主题
    melancholy: '#2A4A6B',  // 冷蓝雨夜
    tense:      '#9B30FF'   // 紫闪
  };

  // ---- emoji 检测正则(覆盖常见表情符号区间) ----
  var EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{1F1E6}-\u{1F1FF}]/u;

  // ---- 工具: 提取一条消息文本(兼容 content / text / body 字段) ----
  function textOf(msg) {
    if (!msg) return '';
    if (typeof msg === 'string') return msg;
    return String(msg.content || msg.text || msg.body || msg.message || '');
  }

  // ---- 工具: 解析时间戳(兼容 Date / ISO 字符串 / 毫秒数) ----
  function tsOf(msg) {
    if (!msg) return 0;
    var t = msg.created_at || msg.createdAt || msg.ts || msg.time;
    if (!t) return 0;
    if (t instanceof Date) return t.getTime();
    if (typeof t === 'number') return t;
    var d = new Date(t);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }

  // ---- 工具: 统计字符串中 emoji 个数 + 归类命中 ----
  function scanEmoji(str) {
    var count = 0;
    var hits = { excited: 0, happy: 0, melancholy: 0, tense: 0 };
    if (!str) return { count: count, hits: hits };
    // 逐码点遍历(u 标志 + codePointAt)
    var chars = Array.from(str);
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i];
      if (EMOJI_RE.test(ch)) {
        count++;
        var cat = EMOJI_MAP[ch] || EMOJI_MAP[codePointHex(ch)];
        if (cat) hits[cat] = (hits[cat] || 0) + 1;
      }
    }
    return { count: count, hits: hits };
  }
  function codePointHex(ch) {
    try { return '\\u{' + ch.codePointAt(0).toString(16) + '}'; }
    catch (_) { return ''; }
  }

  // ---- 工具: 关键词扫描, 返回各情绪命中权重累加 ----
  function scanKeywords(str) {
    var scores = { excited: 0, happy: 0, melancholy: 0, tense: 0 };
    if (!str) return scores;
    var lower = str.toLowerCase();
    for (var i = 0; i < LEXICON.length; i++) {
      var entry = LEXICON[i];
      for (var w = 0; w < entry.words.length; w++) {
        var word = entry.words[w];
        if (lower.indexOf(word) !== -1) {
          scores[entry.type] += entry.weight;
        }
      }
    }
    // 标点加成: 连续感叹号 / 问号 → tense
    if (/[！!]{2,}/.test(str) || /[？?]{2,}/.test(str)) scores.tense += 0.4;
    return scores;
  }

  // =========================================================================
  // MoodEngine
  // =========================================================================
  function MoodEngine() {
    this._lastMood = null;          // 上次应用的 mood(避免重复写 DOM)
    this._active = false;           // 是否已 apply 过(用于 reset 判断)
    this._root = document.documentElement;
    this._body = document.body;
  }

  MoodEngine.prototype = {
    /**
     * 分析最近消息, 输出 mood 对象并自动 apply。
     * @param {Array} messages 最近 N 条消息(建议 20), 每条含 content 与 created_at
     * @returns {{type:String, intensity:Number, freq:Number, emojiDensity:Number}} mood
     */
    feed: function (messages) {
      messages = messages || [];
      var now = Date.now();
      var windowMs = 2 * 60 * 1000;       // 最近 2 分钟
      var recent = 0;                      // 2 分钟内条数
      var kw = { excited: 0, happy: 0, melancholy: 0, tense: 0 };
      var emo = { excited: 0, happy: 0, melancholy: 0, tense: 0 };
      var totalEmoji = 0;
      var totalChars = 0;
      var i, msg, text, ts, e;

      for (i = 0; i < messages.length; i++) {
        msg = messages[i];
        text = textOf(msg);
        totalChars += text.length;
        ts = tsOf(msg);
        if (ts && now - ts <= windowMs) recent++;
        // 关键词
        var k = scanKeywords(text);
        kw.excited += k.excited; kw.happy += k.happy;
        kw.melancholy += k.melancholy; kw.tense += k.tense;
        // emoji
        e = scanEmoji(text);
        totalEmoji += e.count;
        emo.excited += e.hits.excited; emo.happy += e.hits.happy;
        emo.melancholy += e.hits.melancholy; emo.tense += e.hits.tense;
      }

      // ---- 消息频率分(0~1): 2 分钟内 8 条即满 ----
      var freq = Math.min(recent / 8, 1);

      // ---- emoji 密度分(0~1): 每 6 个 emoji 满 ----
      var emojiDensity = totalChars > 0 ? Math.min(totalEmoji / 6, 1) : 0;

      // ---- 关键词情绪总分 ----
      var kwScores = {
        excited:    kw.excited,
        happy:      kw.happy,
        melancholy: kw.melancholy,
        tense:      kw.tense
      };
      // emoji 命中也并入情绪分(每个 emoji 贡献 0.3)
      kwScores.excited    += emo.excited * 0.3;
      kwScores.happy      += emo.happy * 0.3;
      kwScores.melancholy += emo.melancholy * 0.3;
      kwScores.tense      += emo.tense * 0.3;

      // ---- 决定主导情绪类型 ----
      var type = this._decideType(kwScores, freq, recent);

      // ---- 计算强度(0~1) ----
      var maxKw = Math.max(kwScores.excited, kwScores.happy, kwScores.melancholy, kwScores.tense);
      var intensity = this._calcIntensity(freq, maxKw, emojiDensity, type);

      var mood = {
        type: type,
        intensity: intensity,
        freq: freq,
        emojiDensity: emojiDensity
      };

      this.apply(mood);
      return mood;
    },

    /**
     * 根据情绪分 + 频率决定主导情绪。
     * 关键词信号足够强时以词为准; 否则用频率兜底(高频→excited, 冷清→melancholy)。
     */
    _decideType: function (scores, freq, recent) {
      var entries = [
        ['tense', scores.tense],
        ['excited', scores.excited],
        ['happy', scores.happy],
        ['melancholy', scores.melancholy]
      ];
      // 取最高情绪分
      var best = 'calm', bestScore = 0.15;   // 阈值: 低于 0.15 视为无明确情绪
      for (var i = 0; i < entries.length; i++) {
        if (entries[i][1] > bestScore) {
          bestScore = entries[i][1];
          best = entries[i][0];
        }
      }
      if (best !== 'calm') return best;

      // 无明确情绪词: 用频率兜底
      if (recent >= 5 || freq >= 0.6) return 'excited';   // 聊得热烈
      if (recent <= 1 && freq <= 0.12) return 'melancholy'; // 冷清
      return 'calm';
    },

    /**
     * 综合频率 / 关键词 / emoji 计算强度。
     * calm 给一个低基准, melancholy 偏中低, excited/tense 可以冲到 1。
     */
    _calcIntensity: function (freq, maxKw, emojiDensity, type) {
      var kwN = Math.min(maxKw / 1.5, 1);
      var base = 0.15 + 0.4 * freq + 0.35 * kwN + 0.2 * emojiDensity;
      if (type === 'calm') base = Math.min(base, 0.45);
      if (type === 'melancholy') base = Math.min(base, 0.6);
      if (type === 'tense') base = Math.min(base + 0.1, 1);
      return Math.max(0.1, Math.min(base, 1));
    },

    /**
     * 把 mood 写入 DOM: --mood-tint / --mood-intensity / data-mood / mood-tinted / mood-busy / mood-quiet
     * 与 ambient-fx.js 的 applyMoodTint 写同一套变量, MoodEngine 调用后即接管氛围。
     */
    apply: function (mood) {
      if (reduce) return;            // 无障碍模式不动 DOM
      if (!this._body) return;
      mood = mood || { type: 'calm', intensity: 0.2 };

      // 跳过无变化写入(避免频繁 reflow)
      if (this._lastMood &&
          this._lastMood.type === mood.type &&
          Math.abs(this._lastMood.intensity - mood.intensity) < 0.03) {
        return;
      }
      this._lastMood = { type: mood.type, intensity: mood.intensity };
      this._active = true;

      var tint = TINTS[mood.type] || '';
      // --mood-tint: 与 ambient-fx 约定一致, calm/空 tint 时清空变量回归主题色
      if (tint) {
        this._root.style.setProperty('--mood-tint', tint);
        this._body.classList.add('mood-tinted');
      } else {
        this._root.style.removeProperty('--mood-tint');
        this._body.classList.remove('mood-tinted');
      }
      // 新增: 氛围强度(供粒子/光效/边框使用)
      this._root.style.setProperty('--mood-intensity', mood.intensity.toFixed(3));
      this._body.setAttribute('data-mood', mood.type);

      // 高频 / 冷清 标记(基于频率, 与情绪正交)
      // freq >= 0.5 → busy; freq <= 0.12 → quiet
      this._body.classList.toggle('mood-busy', (mood.freq || 0) >= 0.5);
      this._body.classList.toggle('mood-quiet', (mood.freq || 0) <= 0.12);

      // 联动声波涟漪强度(若 ambient-fx 已就绪)
      if (window.EhFx && typeof window.EhFx.soundwave === 'function' && mood.freq > 0) {
        try { window.EhFx.soundwave(mood.intensity * mood.freq); } catch (_) {}
      }
    },

    /**
     * 离房 / 重置: 清除 MoodEngine 写入的全部痕迹。
     * 注意: 只清理 MoodEngine 引入的 --mood-intensity / mood-busy / mood-quiet,
     * 以及它设置的 --mood-tint / mood-tinted / data-mood。
     * ambient-fx 的 moodWeather 仍可独立运行(离房时由 stopMoodWeather 自行清理)。
     */
    reset: function () {
      if (!this._body) return;
      this._root.style.removeProperty('--mood-intensity');
      this._root.style.removeProperty('--mood-tint');
      this._body.classList.remove('mood-tinted', 'mood-busy', 'mood-quiet');
      this._body.removeAttribute('data-mood');
      this._lastMood = null;
      this._active = false;
    }
  };

  // ---- 暴露到全局, 与 EhFx / startMoodWeather 并列 ----
  window.EhMoodEngine = new MoodEngine();

  // 减少动效模式: 提供空实现占位, 保持调用方代码不变
  if (reduce) {
    window.EhMoodEngine.feed = function () { return { type: 'calm', intensity: 0.2, freq: 0, emojiDensity: 0 }; };
    window.EhMoodEngine.apply = function () {};
    window.EhMoodEngine.reset = function () {};
  }
})();
