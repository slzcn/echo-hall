// ============================================================
//  回声厅 Echo Hall — 集中配置 (EH_CONFIG)
//  所有「可配置内容」的单一数据源:四套主题配色 / 主题元数据 /
//  官方房主题绑定 / 官方房 BGM 氛围 / 界面文案。
//  前端只保留结构与 var(--xxx) 引用,配色/文案数据全部集中在此。
//  后台(admin) 可视化编辑后写入 Supabase eh_config 表,前端启动时拉取覆盖本默认值。
//  作者 小龙虾
// ============================================================
(function(root){
  // ---- 四套主题调色板(每套 17 个 CSS 变量,键必须四套一致) ----
  // 变量语义:
  //   bg/bg2        页面主/次背景     panel/panel-solid 面板(半透/实心)
  //   line/line2    描边(弱/强)        ink/sub/dim       文字(主/次/弱)
  //   cyan/magenta/violet/amber/green  五个强调色(霓虹/点缀)
  //   grid          背景网格线         glow-cyan/glow-mag 发光阴影
  const THEME_PALETTES = {
    cyber: {
      '--bg':'#07080d', '--bg2':'#0d0f1a',
      '--panel':'rgba(18,21,36,.72)', '--panel-solid':'#121524',
      '--line':'rgba(120,140,220,.16)', '--line2':'rgba(120,140,220,.28)',
      '--ink':'#EAF0FF', '--sub':'#98A3C7', '--dim':'#717EA9',
      '--cyan':'#28E6D8', '--magenta':'#FF3CAC', '--violet':'#8B5CFF',
      '--amber':'#FFB84D', '--green':'#4DE38A',
      '--grid':'rgba(80,120,255,.05)',
      '--glow-cyan':'0 0 24px rgba(40,230,216,.5)',
      '--glow-mag':'0 0 24px rgba(255,60,172,.5)',
    },
    vapor: {
      '--bg':'#160a1f', '--bg2':'#22103a',
      '--panel':'rgba(40,18,60,.72)', '--panel-solid':'#241035',
      '--line':'rgba(255,120,200,.18)', '--line2':'rgba(255,120,200,.32)',
      '--ink':'#FFE8F6', '--sub':'#D9A8D0', '--dim':'#9B77A8',
      '--cyan':'#38E1D0', '--magenta':'#FF5FA2', '--violet':'#B36BFF',
      '--amber':'#FFC46B', '--green':'#66E6B0',
      '--grid':'rgba(255,120,220,.06)',
      '--glow-cyan':'0 0 24px rgba(56,225,208,.5)',
      '--glow-mag':'0 0 26px rgba(255,95,162,.55)',
    },
    mono: {
      '--bg':'#000000', '--bg2':'#0a0a0c',
      '--panel':'rgba(16,16,20,.82)', '--panel-solid':'#0e0e12',
      '--line':'rgba(210,180,120,.16)', '--line2':'rgba(210,180,120,.3)',
      '--ink':'#F4F1E9', '--sub':'#B8B0A0', '--dim':'#827B6D',
      '--cyan':'#E9C877', '--magenta':'#E9C877', '--violet':'#D8B85C',
      '--amber':'#E9C877', '--green':'#C9BE96',
      '--grid':'rgba(210,180,120,.035)',
      '--glow-cyan':'0 0 20px rgba(233,200,119,.4)',
      '--glow-mag':'0 0 20px rgba(233,200,119,.4)',
    },
    aurora: {
      '--bg':'#04121a', '--bg2':'#062230',
      '--panel':'rgba(10,40,52,.7)', '--panel-solid':'#08202c',
      '--line':'rgba(90,220,200,.18)', '--line2':'rgba(90,220,200,.32)',
      '--ink':'#E6FBF6', '--sub':'#9BD4CC', '--dim':'#5F928C',
      '--cyan':'#2EF0C8', '--magenta':'#FF6EC7', '--violet':'#A98BFF',
      '--amber':'#FFCE6B', '--green':'#3EE89A',
      '--grid':'rgba(80,220,255,.05)',
      '--glow-cyan':'0 0 26px rgba(46,240,200,.55)',
      '--glow-mag':'0 0 24px rgba(255,110,199,.5)',
    },
  };

  // ---- 主题元数据(下拉菜单展示:id/名称/圆点色) ----
  const THEMES = [
    { id:'cyber',  name:'赛博霓虹', dot:'#28E6D8' },
    { id:'vapor',  name:'蒸汽波',   dot:'#FF5FA2' },
    { id:'mono',   name:'暗夜极简', dot:'#E9C877' },
    { id:'aurora', name:'极光渐变', dot:'#2EF0C8' },
  ];

  // ---- 官方房 → 专属默认主题(进房自动套,用户未手动锁定时) ----
  const ROOM_THEME = {
    '闲聊广场':'cyber', '深夜电台':'vapor', '技术黑话':'mono', '虚空回音':'aurora',
  };

  // ---- 官方房卡片兜底强调色(DB 未配色时用) ----
  const OFFICIAL_FALLBACK_C = {
    '闲聊广场':'#28E6D8', '深夜电台':'#8B5CFF', '技术黑话':'#FFB84D', '虚空回音':'#FF3CAC',
  };

  // ---- 官方房 BGM 氛围(Web Audio 程序化生成) ----
  // root:根音Hz  chord:和弦半音程数组  wave:波形  pulse:律动ms(0=纯pad)  cut:低通截止Hz  name:氛围名
  const ROOM_BGM = {
    '闲聊广场':{ root:220,    chord:[0,4,7,11], wave:'triangle', pulse:2400, cut:1400, name:'明亮合成 pad' },
    '深夜电台':{ root:146.83, chord:[0,3,7,10], wave:'sine',     pulse:0,    cut:900,  name:'蒸汽波暖垫' },
    '技术黑话':{ root:98,     chord:[0,7,12],   wave:'sawtooth', pulse:3200, cut:560,  name:'极简低频 drone' },
    '虚空回音':{ root:329.63, chord:[0,5,7,12], wave:'sine',     pulse:1600, cut:2600, name:'空灵铃音' },
  };

  // ---- 界面文案(集中管理,便于统一改动) ----
  const TEXT = {
    publicEmpty: '还没有公开房间,来创建第一个吧',
    roomFirstMsg: '还没有人说话,来当第一个',
    connecting: '连接中…',
    loading: '加载中…',
  };

  const DEFAULT = {
    version: 1,
    themePalettes: THEME_PALETTES,
    themes: THEMES,
    roomTheme: ROOM_THEME,
    officialFallbackC: OFFICIAL_FALLBACK_C,
    roomBgm: ROOM_BGM,
    text: TEXT,
  };

  root.EH_CONFIG_DEFAULT = DEFAULT;
})(typeof window!=='undefined'?window:globalThis);
