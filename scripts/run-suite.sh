#!/usr/bin/env bash
# Echo 功能测试套件统一入口
# 用法:
#   bash scripts/run-suite.sh           # full 全量
#   bash scripts/run-suite.sh quick     # 提交前快测(纯逻辑/契约, 不启浏览器)
#   bash scripts/run-suite.sh games     # 三款游戏规则
#   bash scripts/run-suite.sh multiplayer # 多人/联机
#   bash scripts/run-suite.sh identity  # 身份/房间/聊天
#   bash scripts/run-suite.sh platform  # 平台/安全/版本
# 退出码: 0 全绿; 1 有用例失败
set -uo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

MODE="${1:-full}"
PASS=0; FAIL=0; SKIP=0
FAILED_LIST=()

run() {
  local label="$1"; shift
  local f="$1"
  if [ ! -f "$f" ]; then
    printf '  \033[33m⏭\033[0m %s (缺文件 %s)\n' "$label" "$f"
    SKIP=$((SKIP+1))
    return 0
  fi
  if node "$f" >/tmp/eh-suite-out.txt 2>&1; then
    printf '  \033[32m✓\033[0m %s\n' "$label"
    PASS=$((PASS+1))
  else
    printf '  \033[31m✗\033[0m %s\n' "$label"
    tail -8 /tmp/eh-suite-out.txt | sed 's/^/      /'
    FAIL=$((FAIL+1))
    FAILED_LIST+=("$f")
  fi
}

section() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

# ── 身份 / 房间 / 聊天 ──
suite_identity() {
  section "身份 / 房间 / 聊天"
  run "匿名身份"           scripts/test-anon-identity.js
  run "成员 upsert"        scripts/journey-member-upsert.js
  run "进出房生命周期"     scripts/journey-room-lifecycle.js
  run "房间快照"           scripts/journey-room-snapshot.js
  run "进房锚点"           scripts/journey-enter-room-latest-anchor.js
  run "在线光墙"           scripts/journey-presence-unload.js
  run "消息收发"           scripts/journey-chat-core.js
  run "发送单飞"           scripts/journey-submit-singleflight.js
  run "发送失败恢复"       scripts/journey-message-send-failure.js
  run "历史重复竞态"       scripts/journey-chat-duplicate-history-race.js
  run "IME 组合"           scripts/test-composer-ime.js
  run "历史滚动"           scripts/journey-history-scroll.js
  run "公开房历史上限"     scripts/journey-public-history-cap.js
  run "私密房邀请码"       scripts/test-private-invite-code.js
  run "冷启动会话"         scripts/journey-cold-start-auth.js
}

# ── 多人 / 联机 ──
suite_multiplayer() {
  section "多人 / 联机"
  run "多人进同一桌"       scripts/journey-multiplayer-join.js
  run "入座矩阵/满座分流"  scripts/test-gt-join-matrix.js
  run "德州联机协议"       scripts/journey-poker-online.js
  run "斗地主联机协议"     scripts/journey-ddz-online.js
  run "掼蛋联机协议"       scripts/journey-guandan-online.js
  run "联机断线自愈"       scripts/journey-gt-online-heal.js
  run "GT act RPC"        scripts/journey-gt-act-rpc.js
  run "GT net 模块"        scripts/journey-gt-net-module.js
  run "座位补齐"           scripts/test-fill-seat.js
  run "全席位补齐旅程"     scripts/journey-fill-seat-all.js
  run "双人德州 UI"        scripts/probe-poker-two-player.js
  run "旁观显示一致"       scripts/probe-poker-spectate-consistency.js
  run "斗地主/掼蛋升级对齐" scripts/journey-ddz-gd-upgrade.js
  run "斗地主/掼蛋观感一致" scripts/journey-ddz-gd-polish.js
  run "牌桌落点/刷新还原" scripts/journey-table-polish.js
}

# ── 游戏规则 ──
suite_games() {
  section "游戏规则"
  run "斗地主规则"         scripts/test-ddz-rules.js
  run "斗地主引擎"         scripts/test-ddz-engine.js
  run "斗地主提示"         scripts/test-ddz-hint.js
  run "斗地主加倍"         scripts/test-ddz-double.js
  run "斗地主炸弹"         scripts/test-ddz-quad.js
  run "斗地主发牌公平"     scripts/test-ddz-landlord-fairness.js
  run "斗地主模糊"         scripts/test-ddz-fuzz.js
  run "掼蛋规则"           scripts/test-guandan-rules.js
  run "掼蛋进贡"           scripts/test-guandan-tribute.js
  run "掼蛋配牌拆分"       scripts/test-guandan-follow-split.js
  run "掼蛋报牌"           scripts/test-guandan-spoken.js
  run "掼蛋模糊"           scripts/test-guandan-fuzz.js
  run "德州牌型评估"       scripts/test-poker-eval.js
  run "德州引擎"           scripts/test-poker-engine.js
  run "德州全下边池"       scripts/test-poker-allin.js
  run "德州结算数字"       scripts/test-pk-settle-nums.js
  run "德州模糊"           scripts/test-poker-fuzz.js
  run "德州 AI"            scripts/test-poker-ai.js
  run "掼蛋 AI 强度"       scripts/test-guandan-ai-strength.js
  run "记牌器"             scripts/test-card-counter.js
  # ── 德州静态/逻辑探针(纯 Node, 不需要浏览器) ──
  run "德州盲位席修复"     scripts/probe-poker-blind-seats.js
  run "德州空缺席引擎"     scripts/probe-poker-sitout.js
  run "德州 iOS 布局"      scripts/journey-pk-ios-layout.js
  # ── 以下德州探针需要 playwright/Chrome, 沙盒无浏览器时无法运行, 暂不挂入门禁 ──
  #   scripts/probe-poker-deal-ring.js        — 发牌动画 + 思考环(需浏览器)
  #   scripts/probe-poker-fold.js             — 弃牌按钮状态(需浏览器)
  #   scripts/probe-poker-fold-boardback.js   — 弃牌后公共牌背面(需浏览器)
  #   scripts/probe-poker-fold-color.js       — 弃牌颜色(需浏览器)
  #   scripts/probe-poker-look.js             — 看牌逻辑(需浏览器)
  #   scripts/probe-poker-seat-incremental.js — 座位增量渲染(需浏览器)
  #   scripts/probe-poker-walkin.js           — 路人入座(需浏览器)
  #   scripts/probe-poker-winbanner.js        — 赢家横幅(需浏览器)
  #   scripts/probe-poker-ui-polish.js        — UI 细节(需浏览器)
  #   scripts/probe-poker-ai-tempo.js         — AI 节奏(需浏览器)
  #   scripts/probe-poker-invite-seat.js      — 邀请入座(需浏览器)
  #   scripts/probe-poker-leave-invite.js     — 离开邀请(需浏览器)
  #   scripts/verify-poker-preaction.js       — 预行动(需浏览器)
  # ── 以下德州旅程需要 playwright, 已在 suite_multiplayer / suite_slow 中挂载或标记 skip ──
  #   scripts/probe-poker-spectate-consistency.js — 旁观一致(需浏览器, 在 multiplayer 套件)
  #   scripts/journey-poker-play.js              — 德州打牌旅程(需浏览器, 在 slow 套件)
  #   scripts/journey-poker-online.js           — 德州联机协议(需浏览器, 在 multiplayer 套件)
}

# ── 积分 / 每日上限 ──
suite_score() {
  section "积分 / 每日上限"
  run "跨局筹码累计"       scripts/test-bankroll.js
  run "匿名筹码旅程"       scripts/journey-anon-bankroll.js
  run "筹码真实性"         scripts/journey-chip-authenticity.js
  run "每日输光上限"       scripts/test-daily-bust-limit.js
}

# ── 音频 ──
suite_audio() {
  section "音频"
  run "音频开关矩阵"       scripts/probe-audio-switch-matrix.js
  run "音频互斥"           scripts/journey-audio-exclusive.js
  run "音频混音"           scripts/journey-audio-mixer.js
  run "作曲进度曲名"       scripts/test-bgm-progress-title.js
  run "BGM 鉴权"           scripts/test-bgm-auth.js
  run "BGM 作曲旅程"       scripts/journey-bgm-compose.js
  run "歌曲公开/自愈"      scripts/journey-song-public.js
  run "音频缓存上限"       scripts/journey-audio-cache-limit.js
  run "游戏音频"           scripts/journey-game-audio.js
}

# ── UI / 触控 / 主题 ──
suite_ui() {
  section "UI / 触控 / 主题"
  run "触控目标尺寸"       scripts/journey-btn-tap.js
  run "文案结构一致"       scripts/journey-ui-consistency.js
  run "对话框 a11y"        scripts/journey-dialog-a11y.js
  run "核心控件 a11y"      scripts/journey-core-controls-a11y.js
  run "键盘折叠"           scripts/journey-kb-collapse.js
  run "键盘混合输入"       scripts/journey-kb-mixed-input.js
  run "PWA 方向"           scripts/journey-pwa-orientation.js
  run "PWA 大厅按钮"       scripts/journey-pwa-lobby-btn.js
  run "布局契约"           scripts/test-pk-layout-contract.js
  run "游戏体验"           scripts/journey-game-experience.js
}

# ── 平台 / 安全 ──
suite_platform() {
  section "平台 / 安全"
  run "SW 版本缓存"        scripts/test-sw-versioned-js-cache.js
  run "Edge 鉴权"          scripts/test-edge-auth.js
  run "管理端成员"         scripts/journey-admin-tier-members.js
  run "快照序号"           scripts/test-snap-seq.js
  run "灵魂分身补位"       scripts/test-soul-clone-fill.js
  run "错误监控桥接"       scripts/test-error-monitor-bridge.js
}

# ── 线上错误对照(需网络; 不计入 fail 门禁) ──
suite_monitor() {
  section "线上错误监控对照"
  if [ -f scripts/error-monitor.js ]; then
    if node scripts/error-monitor.js collect; then
      printf '  \033[32m✓\033[0m 错误监控采集完成\n'
    else
      printf '  \033[33m⚠\033[0m 错误监控采集失败(不挡门禁)\n'
    fi
  else
    printf '  \033[33m⏭\033[0m 无 error-monitor.js, 跳过\n'
  fi
}

# ── 跨域长旅程(慢, 只 full) ──
suite_slow() {
  section "跨域长旅程"
  run "德州打牌旅程"       scripts/journey-poker-play.js
  run "斗地主打牌旅程"     scripts/journey-ddz-play.js
  run "掼蛋打牌旅程"       scripts/journey-guandan-play.js
  run "收工全旅程"         scripts/journey-finish-all.js
  run "游戏策略"           scripts/journey-game-strategy.js
  run "挂机托管"           scripts/journey-idle-trustee.js
}

case "$MODE" in
  quick)      suite_identity; suite_multiplayer; suite_score; suite_platform ;;
  identity)   suite_identity ;;
  multiplayer)suite_multiplayer ;;
  games)      suite_games ;;
  score)      suite_score ;;
  audio)      suite_audio ;;
  ui)         suite_ui ;;
  platform)   suite_platform ;;
  monitor)    suite_monitor ;;
  full|*)     suite_identity; suite_multiplayer; suite_games; suite_score; suite_audio; suite_ui; suite_platform; suite_slow ;;
esac

section "结果"
printf '  通过 %d · 失败 %d · 跳过 %d\n' "$PASS" "$FAIL" "$SKIP"

# 错误监控接入点(可选): scripts/error-monitor.js 存在则上报本次运行, 缺失不挡测试。
#   接口约定见 scripts/TEST-INTEGRATION.md
if [ -f scripts/error-monitor.js ]; then
  if node -e "
    try{
      const m=require('./scripts/error-monitor.js');
      if(m && typeof m.reportRun==='function'){
        const failed=process.argv[1]?process.argv[1].split(','):[];
        Promise.resolve(m.reportRun({
          mode:process.argv[2]||'full', pass:+process.argv[3], fail:+process.argv[4], skip:+process.argv[5],
          failed, durationMs:+process.argv[6]||0
        })).catch(()=>{});
      }
    }catch(e){}
  " "$(IFS=,; echo "${FAILED_LIST[*]-}")" "$MODE" "$PASS" "$FAIL" "$SKIP" "$((SECONDS*1000))"; then
    printf '  \033[36mℹ\033[0m 已上报错误监控 reportRun\n'
  fi
else
  printf '  \033[90mℹ\033[0m 无 error-monitor.js, 跳过监控上报(约定见 scripts/TEST-INTEGRATION.md)\n'
fi

if [ "$FAIL" -gt 0 ]; then
  printf '  失败用例:\n'
  for f in "${FAILED_LIST[@]}"; do printf '    - %s\n' "$f"; done
  exit 1
fi
printf '\033[32m全部通过 ✅\033[0m\n'
exit 0
