// ============================================================
//  EH_CONFIG — 集中配置(四套主题配色/主题元数据/官方房绑定/BGM/文案)
//  单一数据源:前端只留结构 + var(--xxx)/EH_CONFIG.xxx 引用。
//  后台改动写入 Supabase eh_config 表,启动时 loadRemoteConfig() 拉取覆盖。
// ============================================================
const EH_CONFIG_DEFAULT = {
  version: 1,
  // 四套主题调色板(每套 17 变量,键必须一致)
  // ★荷尔蒙/酷炫特效的【可调值】(结构与keyframes在CSS里, 这里只放能后台改的量: 强度/透明度/开关/色)。
  //   注入全局 :root(见 injectFxCSS), 后台 eh_config.fx 可覆盖单个键。颜色多用 var(--magenta/--cyan) 跟主题走。
  fx: {
    "--fx-bloom": "1",            // 辉光总强度倍率(0=全关, 1=标准, 1.6=更炸)
    "--fx-livebg": ".55",         // 聊天页活背景光晕不透明度(0=关, 死场)
    "--fx-livebg-speed": "26s",   // 活背景光晕漂移周期(越大越缓)
    "--fx-me-bubble": ".30",      // 自己气泡渐变饱和度(青→品红斜向)
    "--fx-sweep": "1",            // 主按钮 hover 扫光(0=关)
    "--fx-title-glow": "1",       // 大标题辉光强度倍率
    "--fx-private-heat": ".5",    // 私密房"暧昧红"氛围强度(0=关)
  },
  // ★进场动效系统: 按用户类型(超管/管理员/正式/临时)给不同的"进房横幅"。
  //   自己进房时替换朴素文字为一张类型化入场卡(粒子/扫光/光爆), 且光墙他人头像按类型弹入。
  //   尊重系统"减少动态效果"设置(prefers-reduced-motion → 降级为纯文字)。后台 eh_config.entranceFx 可改。
  // EH_OPT_ENTRY_QUIET(2026-07-20): 主人要求降低贵宾/管理员进场干扰。
  //   1) worldAnnounce 默认关(高阶档不再全站流光公告, 跨房打扰太强)
  //   2) othersStageMinTier 提到 super(只有超管进场才全屏光幕; 管理员/贵宾降为只横幅, 不再惊动全场)
  //   3) super.flash/shake 去掉(超管也不再全屏闪光+震屏, 只留光幕+皇冠雨的排面)
  //   身份识别(横幅样式/颜色/图标/光墙光环)保留不变。
  entranceFx: {
    enabled: true,          // 总开关
    othersAvatar: true,     // 他人上光墙时按类型弹入动画
    broadcast: true,        // 把进场事件广播给房里所有人(别人也能看到横幅/高阶档光幕)
    broadcastMinTier: 'reg',// 最低广播档: reg=正式及以上广播(匿名进出不广播防刷屏); 设 'anon' 则全员广播
    othersStageMinTier: 'super', // 别人看到"全屏光幕"的最低档: super=只有超管进场才惊动全场(EH_OPT_ENTRY_QUIET); 原默认 admin
    worldAnnounce: false,   // 高阶档进场 → 全站流光公告(跨房广播); EH_OPT_ENTRY_QUIET 默认关
    // ★贵宾名单: 见顶层 EH_CONFIG.vipUids(后台"💎贵宾名单"tab 存的独立 key)。此处留空占位, 判定优先读顶层。
    vipUids: [],
    vipTreatment: 'admin',  // 贵宾享受的待遇档: 'admin'(管理员级) 或 'super'(超管级=进场加震屏+更炸)。保留💎紫身份, 只调隆重程度。
    tiers: {
      // label 入场词; icon 图标; cls CSS皮肤; sfx 音效名(空=不放);
      // stage 全屏光幕(true=一道巨光带横扫+大字砸下); burst 迸发的emoji(空=不撒); flash 全屏色闪(空=不闪); shake 进场震屏
      super:  { label:'降 临',  icon:'👑', cls:'ent-super',  sfx:'soul',    stage:true,  burst:'👑✨🌟', flash:'', shake:false },  // 超管: 全屏金光幕+皇冠雨(EH_OPT_ENTRY_QUIET: 去掉 flash 全屏闪 + shake 震屏, 太扰)
      vip:    { label:'莅 临',  icon:'💎', cls:'ent-vip-tier', sfx:'soul',  stage:true,  burst:'💎✨🌟', flash:'#C77DFF', shake:false },  // 贵宾: 全屏紫光幕+钻石雨(默认管理员级; vipTreatment='super' 时自动加震屏升到超管级排面)
      admin:  { label:'莅 临',  icon:'🛡️', cls:'ent-admin',  sfx:'arrive', stage:true,  burst:'✨🛡️',   flash:'',        shake:false },  // 管理员: 全屏光幕+火花
      reg:    { label:'进 入',  icon:'✦',  cls:'ent-reg',    sfx:'arrive', stage:false, burst:'✦✨',    flash:'',        shake:false },  // 正式: 横幅流光+小火花
      anon:   { label:'飘 入',  icon:'🕯️', cls:'ent-anon',   sfx:'',        stage:false, burst:'',       flash:'',        shake:false },  // 临时: 低调淡入
    },
  },
  // 贵宾名单(遗留 key, 兼容旧数据; 现已并入 customTiers 的 vip 档, 见下)
  vipUids: [],
  vipTreatment: 'admin',
  // 五档默认角色显示名称(后台可改名, 但不可增删): 进场横幅角标/个人空间徽章统一读这里
  tierNames: { super:'超级管理员', admin:'管理员', reg:'正式用户', anon:'临时用户' },
  // 自定义角色档(后台"人员"tab 可增/改/删): 每档 {id,name,icon,level(admin/super 待遇档),uids[user_id]}。
  //   命中某档 uid → 进场享该档待遇(紫钻光幕皮肤 + 按 level 隆重度)。贵宾(vip)是预置的第一个自定义档。
  //   默认四档(super/admin/reg/anon)是系统身份, 不在此列(不可删)。
  customTiers: [ { id:'vip', name:'贵宾', icon:'💎', level:'admin', uids:[] } ],
  themePalettes: {
    cyber: {"--bg":"#070a12","--bg2":"#0d1524","--panel":"rgba(21,50,48,0.8)","--panel-solid":"#132a29","--line":"rgba(0,229,212,0.24)","--line2":"rgba(0,229,212,0.38)","--ink":"#EAF6FF","--sub":"#86cbc6","--dim":"#498d88","--cyan":"#00E5D4","--magenta":"#FF2D8E","--violet":"#9C85FF","--amber":"#FFC24D","--green":"#34E0B0","--accent":"#00E5D4","--grid":"rgba(0,229,212,0.05)","--glow-cyan":"0 0 22px rgba(0,229,212,0.6)","--glow-mag":"0 0 20px rgba(255,45,142,0.55)"},
    vapor: {"--bg":"#1c081f","--bg2":"#320f38","--panel":"rgba(50,21,44,0.8)","--panel-solid":"#2a1325","--line":"rgba(255,77,216,0.24)","--line2":"rgba(255,77,216,0.38)","--ink":"#FFEAF7","--sub":"#cb86bc","--dim":"#8d497e","--cyan":"#FF4DD8","--magenta":"#FF66B0","--violet":"#4DE0D0","--amber":"#FFB84D","--green":"#8CE8A0","--accent":"#FF4DD8","--grid":"rgba(255,77,216,0.05)","--glow-cyan":"0 0 22px rgba(255,77,216,0.6)","--glow-mag":"0 0 20px rgba(255,102,176,0.55)"},
    aurora: {"--bg":"#03130d","--bg2":"#08261a","--panel":"rgba(21,50,36,0.8)","--panel-solid":"#132a1f","--line":"rgba(34,255,149,0.24)","--line2":"rgba(34,255,149,0.38)","--ink":"#EAFFF3","--sub":"#86cbaa","--dim":"#498d6c","--cyan":"#22FF95","--magenta":"#C74DFF","--violet":"#39D9FF","--amber":"#EBC85A","--green":"#22FF95","--accent":"#22FF95","--grid":"rgba(34,255,149,0.05)","--glow-cyan":"0 0 22px rgba(34,255,149,0.6)","--glow-mag":"0 0 20px rgba(199,77,255,0.55)"},
    mono: {"--bg":"#0a0708","--bg2":"#151011","--panel":"rgba(50,42,21,0.8)","--panel-solid":"#2a2413","--line":"rgba(245,208,106,0.24)","--line2":"rgba(245,208,106,0.38)","--ink":"#FBEEE4","--sub":"#c7b68a","--dim":"#89794d","--cyan":"#F5D06A","--magenta":"#E0507A","--violet":"#C9964D","--amber":"#F5D06A","--green":"#D8B87A","--accent":"#F5D06A","--grid":"rgba(245,208,106,0.05)","--glow-cyan":"0 0 22px rgba(245,208,106,0.6)","--glow-mag":"0 0 20px rgba(224,80,122,0.55)"},
    klein: {"--bg":"#050818","--bg2":"#0a1030","--panel":"rgba(21,28,50,0.8)","--panel-solid":"#13182a","--line":"rgba(100,134,255,0.24)","--line2":"rgba(100,134,255,0.38)","--ink":"#E8ECFF","--sub":"#8695cb","--dim":"#49588d","--cyan":"#6486FF","--magenta":"#FF8A3D","--violet":"#29E0E6","--amber":"#FFB84D","--green":"#4DE0B0","--accent":"#6486FF","--grid":"rgba(100,134,255,0.05)","--glow-cyan":"0 0 22px rgba(100,134,255,0.6)","--glow-mag":"0 0 20px rgba(255,138,61,0.55)"},
    coral: {"--bg":"#20100c","--bg2":"#3a1c14","--panel":"rgba(50,28,21,0.8)","--panel-solid":"#2a1913","--line":"rgba(255,129,89,0.24)","--line2":"rgba(255,129,89,0.38)","--ink":"#FFEFE8","--sub":"#cb9686","--dim":"#8d5949","--cyan":"#FF8159","--magenta":"#FF6098","--violet":"#2ED9C0","--amber":"#FFB84D","--green":"#5FE0B0","--accent":"#FF8159","--grid":"rgba(255,129,89,0.05)","--glow-cyan":"0 0 22px rgba(255,129,89,0.6)","--glow-mag":"0 0 20px rgba(255,96,152,0.55)"},
    lagoon: {"--bg":"#04141c","--bg2":"#082832","--panel":"rgba(21,43,50,0.8)","--panel-solid":"#13252a","--line":"rgba(18,176,224,0.24)","--line2":"rgba(18,176,224,0.38)","--ink":"#E6FBFF","--sub":"#8bb8c6","--dim":"#4e7b88","--cyan":"#12B0E0","--magenta":"#FF8A5E","--violet":"#4DE0C0","--amber":"#FFC97A","--green":"#3FE0A0","--accent":"#12B0E0","--grid":"rgba(18,176,224,0.05)","--glow-cyan":"0 0 22px rgba(18,176,224,0.6)","--glow-mag":"0 0 20px rgba(255,138,94,0.55)"},
    dusk: {"--bg":"#0a0e18","--bg2":"#151b2c","--panel":"rgba(24,30,47,0.8)","--panel-solid":"#161a28","--line":"rgba(143,166,232,0.24)","--line2":"rgba(143,166,232,0.38)","--ink":"#EEF2FC","--sub":"#919dbf","--dim":"#556082","--cyan":"#8FA6E8","--magenta":"#FFA07A","--violet":"#C0CAF5","--amber":"#F0C878","--green":"#7ED8B4","--accent":"#8FA6E8","--grid":"rgba(143,166,232,0.05)","--glow-cyan":"0 0 22px rgba(143,166,232,0.6)","--glow-mag":"0 0 20px rgba(255,160,122,0.55)"},
    rose: {"--bg":"#15100f","--bg2":"#261b1a","--panel":"rgba(46,26,31,0.8)","--panel-solid":"#26171b","--line":"rgba(226,154,174,0.24)","--line2":"rgba(226,154,174,0.38)","--ink":"#F9EFEC","--sub":"#bc95a0","--dim":"#7e5863","--cyan":"#E29AAE","--magenta":"#D06A8E","--violet":"#9AA0D0","--amber":"#E6BE86","--green":"#95BAA6","--accent":"#E29AAE","--grid":"rgba(226,154,174,0.05)","--glow-cyan":"0 0 22px rgba(226,154,174,0.6)","--glow-mag":"0 0 20px rgba(208,106,142,0.55)"},
    sunset: {"--bg":"#180818","--bg2":"#2c0e26","--panel":"rgba(50,21,34,0.8)","--panel-solid":"#2a131d","--line":"rgba(255,61,146,0.24)","--line2":"rgba(255,61,146,0.38)","--ink":"#FFEAF2","--sub":"#cb86a4","--dim":"#8d4967","--cyan":"#FF3D92","--magenta":"#FF7A3D","--violet":"#C476FF","--amber":"#FFB04D","--green":"#5FE0B0","--accent":"#FF3D92","--grid":"rgba(255,61,146,0.05)","--glow-cyan":"0 0 22px rgba(255,61,146,0.6)","--glow-mag":"0 0 20px rgba(255,122,61,0.55)"},
  },
  // 主题元数据(下拉菜单:id/名称/圆点色)
  themes: [
    { id:"cyber", name:"赛博夜城", dot:"#00E5D4" }, { id:"vapor", name:"迈阿密日落", dot:"#FF4DD8" }, { id:"aurora", name:"极光迷幻", dot:"#22FF95" }, { id:"mono", name:"暗夜奢华", dot:"#F5D06A" }, { id:"klein", name:"克莱因之夜", dot:"#6486FF" }, { id:"coral", name:"珊瑚热恋", dot:"#FF8159" }, { id:"lagoon", name:"湖水迷情", dot:"#12B0E0" }, { id:"dusk", name:"远山暮色", dot:"#8FA6E8" }, { id:"rose", name:"莫兰迪玫瑰", dot:"#E29AAE" }, { id:"sunset", name:"日暮狂欢", dot:"#FF3D92" }
  ],
  // 大厅展示配置：后台可控制官方房显隐、顺序、卡片标题/描述；未配置时保持默认全展示。
  lobbyDisplay: {
    official: {},
    publicVisible: true,
    privateVisible: true,
  },
  // 官方房 → 专属默认主题
  roomTheme: { '闲聊广场':'cyber','深夜电台':'vapor','技术黑话':'klein','虚空回音':'aurora' },
  // 官方房卡片兜底强调色(对应主题夜间 accent)
  officialFallbackC: { '闲聊广场':'#00E5D4','深夜电台':'#FF66B0','技术黑话':'#6486FF','虚空回音':'#22FF95' },
  // 公开/私密房按名字哈希稳定分配的主题池(后台可改)
  publicThemePool: ['coral','lagoon','sunset','cyber','klein'],   // 热烈开放系
  privateThemePool: ['dusk','rose','mono','vapor','aurora'],       // 私密沉静系
  // 对任意房手动钉主题(覆盖哈希结果): { '房间名':'主题id' }
  roomThemeOverride: {},
  // 灵魂专属色(按灵魂名匹配, 私密房召唤的副本同名共享)
  // 灵魂专属色: 从新十主题 accent 里选(按性格), 与主题体系统一。空则跟房间主题色走。
  soulColors: {'狼姐':'#FF3D92','老K':'#8FA6E8','阿夜':'#C77DFF','回音':'#6486FF','图灵':'#00E5D4','小暖':'#FF6F52','小绵羊':'#A8E6A1'},
  // 房间类型代表色(公开房/私密房卡片强调色; 官方房用 officialFallbackC)
  roomKindC: { public:'#1DE9B6', private:'#B57EDC', official:'#0ABAB5' },
  // 按房名定制主色(优先级高于 kind 色, 任意房型可用): 只给特定房换调, 其它同类型仍用 roomKindC
  roomNameC: { '午夜聊天':'#F5D06A', '技术黑话':'#4A5D7E' },   // 午夜聊天=暗夜奢华(香槟金, 深夜贵气); 技术黑话=远山暮色(青灰蓝, 冷峻科技感)
  // 白名单: 匿名/虚空/共鸣 3 个 JS 默认色, 允许后台覆盖(可写 key)
  identityDefaultC: '#0ABAB5',   // 匿名/未设色时的默认身份色(全站 fallback)
  voidC: '#4A5D7E',              // 虚空模式代表色
  resonanceDefaultC: '#FF6F61',  // 共鸣特效默认色
  // 官方房 BGM(分层合成器格式: bpm/steps/loopBars/layers.lead|bass|pad|kick|hat)
  //  闲聊广场: C大调五声 8-bit pop / 深夜电台: Fm7 蒸汽波lo-fi无鼓 / 技术黑话: Am极简techno / 虚空回音: E lydian ambient铃音
  // 官方房 BGM(MiniMax music-2.6 生成的真实音频, 存 Supabase Storage/eh-song/bgm/)
  // 官方房按 name 精确绑; public/private 走 _fallback (支持任意用户建的公共/私密房)
  roomBgm: {
    '闲聊广场':{ name:'全城不睡', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/hall.mp3', variants:[{name:'夜市暴动',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/hall_daylit.mp3'},{name:'霓虹烧到天亮',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/hall_arcade.mp3'}] },
    '深夜电台':{ name:'没人知道我还醒着', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/radio.mp3', variants:[{name:'只播给失眠的人',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/radio_late.mp3'},{name:'整夜为你开着',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/radio_signal.mp3'}] },
    '技术黑话':{ name:'改到天亮不认输', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/tech.mp3', variants:[{name:'跟 bug 死磕',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/tech_focus.mp3'},{name:'服务器要烧了',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/tech_neon.mp3'}] },
    '虚空回音':{ name:'把秘密扔进宇宙', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/void.mp3', variants:[{name:'沉到没人找得到',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/void_glacier.mp3'},{name:'光年外有人收到',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/void_astral.mp3'}] },
    _fallback:{
      public: { name:'谁来都行', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/public_night.mp3', variants:[{name:'睡到自然醒',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/public_dawn.mp3'},{name:'躺平一下午',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/public_glow.mp3'}] },
      private:{ name:'关上门以后', url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/private_cozy.mp3', variants:[{name:'贴着耳朵说',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/private_whisper.mp3'},{name:'天亮前别走',url:'https://cddkniwbhvcbfgkgomtl.supabase.co/storage/v1/object/public/eh-song/bgm/private_glow.mp3'}] },
      generated:{ name:'当场召唤', url:'' },
    },
  },
  // 身份随机池(昵称形容词/动物, 虚空匿名名字)
  identityPool: {
    adjectives:['量子','霓虹','午夜','像素','赛博','游离','镜像','脉冲','银河','深海','极光','熵增','折跃','暗物质','超导','游牧'],
    animals:['水獭','狐狸','渡鸦','水母','狼','鲸','猫头鹰','蝙蝠','章鱼','麋鹿','企鹅','黑猫','海豚','老虎','刺猬','蝴蝶'],
    voidNames:['某个回声','虚空来客','匿名信号','无名者','一缕微光','夜航员'],
  },
  // 运行参数(后台 eh_config 可覆盖; 代码里一律实时读 EH_CONFIG.tuning.xxx, 不在启动时固化为 const)
  tuning: {
    publicRecentLimit: 500,   // 公开/官方房进房拉取的最近消息条数(RPC 上限同步放开)
    historyPage: 60,          // 私密房每页加载条数(「加载更早」翻页步长)
    prefetchN: 48,            // 列表页悬停/进房预取的消息条数
    prefetchTtlMs: 60000,     // 预取缓存有效期(ms)
    voidTtlMs: 300000,        // 虚空消息存活时长(ms, 5分钟)
    onlineWindowMs: 35000,    // 在线判定窗口: 多久内有心跳算在线(ms)
    resonanceThreshold: 5,    // 单条消息某情绪回声达到此数触发全房共鸣
    voiceMaxSec: 30,          // 语音留声最大时长(秒)
  },
  // 界面文案(后台可配) —— 第一类运营高频文案
  text: {
    // 空状态/提示
    publicEmpty:'还没有公开房，建一个吧', roomFirstMsg:'还没有人说话，来当第一个',
    connecting:'连接中…', loading:'加载中…',
    // 入场页
    entrySlogan:'临时用户 · 无需注册',
    entryBtn:'匿 名 进 入',
    // 大厅
    hallOfficial:'📡 官方频道', hallPublic:'🌐 公开房间', hallPrivate:'🔒 私密房间',
    // 互动模式(标题+副标题)
    modeVoiceTitle:'语音留声', modeVoiceSub:'按住录音，松手发送',
    modeVoidTitle:'说给虚空', modeVoidSub:'匿名 · 5分钟后消散',
    modeSingTitle:'文字神曲', modeSingSub:'把输入的话，唱出来',
    // 输入框 placeholder
    composerPlaceholder:'说点什么… 打个 / 看命令',
    voidPlaceholder:'说给虚空… 匿名，5分钟后消散 🕳️',
    // 命令帮助
    cmdSing:'/sing 文字 → 变洗脑神曲（随机曲风）🎵',
    cmdWhisper:'/whisper @昵称 悄悄话（仅对方可见）',
    // 主要按钮
    btnCreateRoom:'生 成 房 间', btnEnterRoom:'进 入 房 间',
    btnLogin:'登 录', btnRegister:'注 册 并 进 入',
    // 房间创建
    roomTypePublicDesc:'大厅可见', roomTypePrivateDesc:'邀请码进',
    roomCreatedTitle:'房间已创建 🎉',
    // 闲聊广场官方房描述(入口标语)
    officialDesc:'陌生人的实时聊天空间 · 进来 · 说话 · 留存',
    // ---- 第二类·表单弹窗 ----
    // 登录页
    loginSwitchId:'↻ 换一个',
    loginToggleShow:'已有账号？点此登录 ▾',
    loginUserPh:'用户名 或 邮箱',
    loginPwdPh:'密码',
    loginNoAccount:'没有账号？',
    loginGoReg:'注册一个 →',
    loginForgot:'忘记密码',
    // 大厅
    lobbyPrivateHint:'凭邀请码加入，或创建一个只有你和朋友的房间',
    lobbyCreateBtn:'＋ 创建',
    lobbyJoinBtn:'🔑 加入',
    // 聊天室·顶栏
    titleBgm:'氛围音乐',
    titleRoomSet:'房间设置',
    titleProfile:'个人空间',
    titleSkin:'皮肤',
    titleMore:'更多花样',
    titleEmoji:'表情',
    // 聊天室·输入
    holdToTalk:'按住 说话',
    recordingHint:'松开发送 · 上滑取消',
    // 房间创建
    createRoomTitle:'创建房间',
    createRoomSub:'选择房间类型，起个名字。',
    roomNameLabel:'房间名',
    roomNamePh:'比如：午夜同好会',
    roomIconLabel:'图标',
    inviteShareHint:'把邀请码发给朋友，他们就能进来：',
    copyBtn:'复制',
    // 加入房间
    joinRoomTitle:'用邀请码加入',
    joinRoomSub:'输入朋友给你的邀请码：',
    inviteCodeLabel:'邀请码',
    inviteCodePh:'例如 A3F9K2M7QX',
    // 注册
    regTitle:'注册账号',
    regSub:'注册后可跨设备用账号密码登录，保留身份与聊天记录。',
    regUserLabel:'用户名',
    regUserPh:'3-20 位，支持中英文',
    regPwdPh:'至少 6 位',
    regEmailLabel:'邮箱（选填）',
    regEmailPh:'用于找回密码，建议填写',
    // 找回密码
    forgotTitle:'找回密码',
    forgotSub:'输入注册时填写的邮箱，我们会发一封重置链接。（注册未填邮箱的账号无法通过此方式找回）',
    forgotEmailPh:'注册时填的邮箱',
    // 邮箱设置
    emailSetTitle:'邮箱设置',
    emailSetSub:'用于找回密码。绑定用户名/密码登录不受影响。',
    emailCurLabel:'当前邮箱',
    emailNewLabel:'新邮箱',
    // 编辑形象
    editProfileTitle:'编辑形象',
    editProfileSub:'自定义你的昵称和头像（用户名登录不受影响）。',
    nickLabel:'昵称',
    nickPh:'显示给别人看的名字',
    avatarLabel:'头像',
    themeColorLabel:'主题色',
    // 确认弹窗
    confirmTitle:'确认操作',
    cancelBtn:'取消',
    okBtn:'确定',
    // ---- 第三类·Toast 提示 ----
    // ✅ 成功
    ok_emailVerified:'✓ 邮箱验证成功',
    ok_saved:'已保存',
    ok_kicked:'已踢出',
    ok_profileUpdated:'形象已更新',
    ok_roomDissolved:'房间已解散',
    ok_welcomeBack:'欢迎回来',
    ok_regDone:'注册成功，已登录',
    ok_codeCopied:'邀请码已复制',
    ok_emailUpdated:'邮箱已更新，请验证',
    ok_resetSent:'若该邮箱已注册，重置链接已发送',
    // ❌ 错误
    err_saveFail:'保存失败',
    err_sendFail:'发送失败',
    err_copyFail:'复制失败',
    err_createRoom:'建房失败',
    err_recInit:'录音初始化失败',
    err_recTooLong:'录音太长，发送失败',
    err_recTooShort:'说话时间太短',
    err_roomNameEmpty:'房间名不能为空',
    err_noRecSupport:'此浏览器不支持录音',
    err_noAudioSupport:'此浏览器不支持音频合成',
    err_userNotFound:'没找到这个人（需在本房在线）',
    err_regFail:'注册失败',
    err_noAccount:'账号不存在',
    err_wrongPwd:'账号或密码错误',
    err_initId:'身份初始化失败，刷新重试',
    err_badCode:'邀请码无效或房间不存在',
    err_emailFmt:'邮箱格式不对',
    err_needMic:'需要麦克风权限才能发语音',
    err_voiceUpload:'语音上传失败',
    err_voiceSend:'语音发送失败',
    err_voiceLoad:'语音加载失败，可能已过期',
    err_voiceUrl:'语音地址缺失',
    err_voiceBucket:'语音存储未配置(缺 eh-voice 桶)',
    err_verifyFail:'验证失败',
    ok_emailAlready:'邮箱已验证',
    err_singSend:'神曲发送失败',
    // ⚠️ 警告
    warn_regNeedLogin:'注册成功但登录失败，请回登录页手动登录',
    warn_needLogin:'请先登录',
    warn_needCredentials:'请填写账号和密码',
    warn_needCode:'请输入邀请码',
    warn_needRoomName:'给房间起个名',
    warn_browserBlock:'被浏览器拦截，请再点一次',
    warn_pwdShort:'密码至少 6 位',
    warn_userShort:'用户名至少 3 位',
    // ♻ 其他
    help_sing:'用法：/sing 要唱的文字',
    help_whisper:'用法：/whisper @昵称 内容',
    sing_needText:'先打点字，让它唱出来',
    sing_noContent:'没有可唱的内容',
  },
  // 神曲曲风池: id/展示/音乐参数完整定义(可后台增删改+拖排序)
  // scale 存字符串 key(minP/majP/major/minor), 运行时映射到 SCALE 对象
  songStyles:[
    { id:'acapella', name:'清唱',  sub:'月下独吟',    subEn:'Moonlit Solo', emoji:'🎤',  color:'#8FA6E8', bpm:80,  bpc:0.5, base:0,  scale:'major',
      motif:[0,2,4,2,0,2,4,2], chords:[0,4,5,3],  wave:'sine',     bass:'sine',     groove:'lofi', tts:{rate:1.0, pitch:1.0},  ttsStyle:'lazy',  playRate:1.0,
      coverPrompt:'Acappella, Human Voice, No Instruments, Pure Vocal' },
    { id:'dj',       name:'DJ',    sub:'烈焰红唇',    subEn:'Scarlet Kiss', emoji:'🕺',  color:'#FF3D92', bpm:124, bpc:0.5, base:3,  scale:'minP',
      motif:[0,0,3,2,0,0,3,5], chords:[0,0,-2,3], wave:'sawtooth', bass:'square',   groove:'four', tts:{rate:1.3, pitch:1.0},  ttsStyle:'high',  playRate:1.12,
      coverPrompt:'EDM, Electronic Dance, Energetic, Heavy Bass, Club, 洗脑抖音神曲, 快节奏' },
    { id:'jazz',     name:'爵士',  sub:'威士忌之吻',  subEn:'Whiskey Neat', emoji:'🎷',  color:'#F5D06A', bpm:92,  bpc:0.5, base:-2, scale:'major',
      motif:[0,2,4,3,2,0,2,4], chords:[0,4,5,3],  wave:'sine',     bass:'triangle', groove:'lofi', tts:{rate:0.92,pitch:0.95}, ttsStyle:'lazy',  playRate:0.95,
      coverPrompt:'Jazz, Smooth, Lounge, Saxophone, 慵懒深夜酒吧, 轻松' },
    { id:'funk',     name:'Funk',  sub:'荧光心跳',    subEn:'Pulse Green',  emoji:'🪩',  color:'#22FF95', bpm:114, bpc:0.5, base:3,  scale:'major',
      motif:[0,2,4,2,7,4,2,0], chords:[0,5,-3,3], wave:'sawtooth', bass:'triangle', groove:'four', tts:{rate:1.2, pitch:1.1},  ttsStyle:'sweet', playRate:1.1,
      coverPrompt:'Funk, Groovy, Disco, Upbeat, Electronic, 复古电子, 律动' },
    { id:'gufeng',   name:'古风',  sub:'午夜绸缎',    subEn:'Midnight Silk',emoji:'🏮',  color:'#C77DFF', bpm:78,  bpc:0.5, base:0,  scale:'majP',
      motif:[0,2,1,0,2,3,2,0], chords:[0,-3,-5,-3],wave:'sine',    bass:'sine',     groove:'boom', tts:{rate:0.95,pitch:1.1},  ttsStyle:'gu',    playRate:0.96,
      coverPrompt:'Guofeng, Chinese Traditional, Guzheng, Bamboo Flute, 婉转优美' },
    { id:'rnb',      name:'R&B',   sub:'冰霞柔情',    subEn:'Frost Soul',   emoji:'🎙️',  color:'#12B0E0', bpm:76,  bpc:0.5, base:-2, scale:'major',
      motif:[0,3,5,3,2,0,3,5], chords:[0,5,-3,-5], wave:'sine',    bass:'sine',     groove:'lofi', tts:{rate:0.88,pitch:0.98}, ttsStyle:'lazy',  playRate:0.92,
      coverPrompt:'R&B, Soul, Smooth, Sensual, Slow Jam, 午夜情调, 慢节奏, 柔情' },
    { id:'kid',      name:'卡通',  sub:'暧昧微醺',    subEn:'Blush Tease',  emoji:'🧸',  color:'#E29AAE', bpm:108, bpc:0.5, base:5,  scale:'major',
      motif:[0,2,4,4,2,0,4,2], chords:[0,5,7,5],  wave:'triangle', bass:'triangle', groove:'boom', tts:{rate:1.05,pitch:1.5},  ttsStyle:'meng',  playRate:1.18,
      coverPrompt:'Kids Song, Cartoon, Cheerful, Playful, Cute Vocal, 欢快童声, 大调' },
  ],
};
