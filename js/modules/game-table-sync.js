// GameTableSync — 游戏桌联机状态同步模块
// 职责:座位管理/host选举/快照广播/在线状态/动作上行
// 设计文档:docs/arch-audit/gametablesync-design.md

(function(root){
  'use strict';

  class GameTableSync {
    // ── 构造 ──
    constructor(opts){
      if (!opts || !opts.tableId || !opts.game || !opts.myUid || !opts.supabase){
        throw new Error('GameTableSync: 缺少必需参数 tableId/game/myUid/supabase');
      }
      this.#tableId = opts.tableId;
      this.#game = opts.game;
      this.#myUid = opts.myUid;
      this.#supabase = opts.supabase;
      this.#callbacks = {
        onSeatChange: opts.onSeatChange || null,
        onHostTransfer: opts.onHostTransfer || null,
        onSnapshot: opts.onSnapshot || null,
        onAction: opts.onAction || null,
        onDissolve: opts.onDissolve || null,
        onError: opts.onError || null,
      };
    }

    // ── 配置(私有) ──
    #tableId;
    #game;
    #myUid;
    #supabase;
    #callbacks;

    // ── 状态(私有) ──
    #isHost = false;
    #mySeat = -1;
    #seats = [];              // DB row.seats 原始数组
    #seatArrays = null;       // {names,avatars,isAI,ids,souls,mySeat,myDbSeat,remoteSeats}
    #roomSouls = [];          // 房间灵魂列表

    // ── Realtime(私有) ──
    #channel = null;
    #heartbeatTimer = null;

    // ── 运行标志(私有) ──
    #running = false;

    // ── 公开方法:生命周期 ──
    async start(){
      if (this.#running) return;
      this.#running = true;
      
      // 订阅 realtime
      try {
        this.#channel = this.#supabase
          .channel(`game-table-${this.#tableId}`)
          .on('postgres_changes',
            { event: '*', schema: 'public', table: 'eh_game_tables', filter: `id=eq.${this.#tableId}` },
            payload => this.#handleTableUpdate(payload.new)
          )
          .subscribe();
      } catch(e){
        this.#triggerError('start.subscribe', e);
        throw e;
      }

      // 启动心跳(每30s)
      this.#heartbeatTimer = setInterval(() => this.#sendHeartbeat(), 30000);
    }

    stop(){
      if (!this.#running) return;
      this.#running = false;
      
      // 清理 realtime
      if (this.#channel){
        try{ this.#supabase.removeChannel(this.#channel); }catch(_){}
        this.#channel = null;
      }
      
      // 清理心跳
      if (this.#heartbeatTimer){
        clearInterval(this.#heartbeatTimer);
        this.#heartbeatTimer = null;
      }
    }

    // ── 公开方法:座位操作 ──
    async takeSeat(seat){
      if (!this.#running) throw new Error('GameTableSync: 未启动');
      // TODO: 调用 supabase.rpc('eh_gt_sit', { table_id, seat })
      throw new Error('takeSeat: 未实现');
    }

    async leaveSeat(){
      if (!this.#running) throw new Error('GameTableSync: 未启动');
      // TODO: 调用 supabase.rpc('eh_gt_leave', { table_id })
      throw new Error('leaveSeat: 未实现');
    }

    // ── 公开方法:Host 操作 ──
    async broadcastSnapshot(snapshot){
      if (!this.#isHost) throw new Error('GameTableSync: 非 host 不能广播快照');
      // TODO: 调用 supabase.rpc('eh_gt_snapshot', { table_id, snapshot_json })
      throw new Error('broadcastSnapshot: 未实现');
    }

    async writeHands(hands){
      if (!this.#isHost) throw new Error('GameTableSync: 非 host 不能写底牌');
      // TODO: 批量写 eh_gt_hands
      throw new Error('writeHands: 未实现');
    }

    // ── 公开方法:Guest 操作 ──
    async sendAction(action){
      if (this.#isHost) throw new Error('GameTableSync: host 不需要 sendAction');
      // TODO: 调用 supabase.rpc('eh_gt_act', { table_id, action_json })
      throw new Error('sendAction: 未实现');
    }

    // ── 公开方法:查询 ──
    isHost(){ return this.#isHost; }
    getMySeat(){ return this.#mySeat; }
    getSeats(){ return this.#seats.slice(); }  // 返回副本,防外部修改
    getSeatArrays(){ return this.#seatArrays ? {...this.#seatArrays} : null; }

    // ── 内部方法:处理桌子更新 ──
    #handleTableUpdate(row){
      if (!this.#running) return;
      
      // 检查散桌
      if (row.status === 'closed'){
        this.#triggerCallback('onDissolve');
        this.stop();
        return;
      }

      // 更新座位
      const oldSeats = this.#seats;
      this.#seats = (row.seats || []).slice();

      // 转换座位数组(复用 app.js 的 gtSeatArrays 逻辑)
      const oldSeatArrays = this.#seatArrays;
      this.#seatArrays = this.#gtSeatArrays(row);

      // 检测 host 变化
      const wasHost = this.#isHost;
      this.#isHost = row.host === this.#myUid;
      if (this.#isHost !== wasHost){
        this.#triggerCallback('onHostTransfer', this.#isHost);
      }

      // 检测座位变化
      const oldMySeat = this.#mySeat;
      this.#mySeat = this.#seatArrays.mySeat;
      if (JSON.stringify(oldSeatArrays) !== JSON.stringify(this.#seatArrays)){
        this.#triggerCallback('onSeatChange', this.#seatArrays);
      }
    }

    // ── 内部方法:座位数组转换(从 app.js 移植) ──
    #gtSeatArrays(row){
      const seats = (row.seats || []).filter(s => s && typeof s.seat === 'number').slice().sort((a,b) => a.seat - b.seat);
      const soulMap = {};
      (this.#roomSouls || []).forEach(s => { if(s && s.auth_uid) soulMap[s.auth_uid] = s; });
      
      const names = [], avatars = [], isAI = [], ids = [], souls = [];
      seats.forEach((s, i) => {
        const human = s.kind === 'human';
        const hasSoul = s.kind === 'soul' && soulMap[s.uid];
        // ★v112修复:兜底命名检查uid,防真人误命名为"机器人"
        const isRealHuman = s.uid && (human || !hasSoul);
        names[i] = s.name || (isRealHuman ? '玩家' : (hasSoul ? '灵魂' : '机器人' + (typeof s.seat === 'number' ? s.seat : i+1)));
        avatars[i] = s.emoji || (isRealHuman ? '🙂' : (hasSoul ? '👤' : '🤖'));
        isAI[i] = !human;
        ids[i] = s.uid || null;
        const soul = (s.kind === 'soul' && soulMap[s.uid]) || null;
        souls[i] = soul ? { archetype: soul.archetype || soul.soul_archetype || soul.persona || null, name: soul.name, emoji: soul.emoji } : null;
      });
      
      const mySeat = seats.findIndex(s => s.kind === 'human' && s.uid === this.#myUid);
      const myDbSeat = mySeat >= 0 ? seats[mySeat].seat : -1;
      const remoteSeats = seats.filter(s => s.kind === 'human' && s.uid !== this.#myUid).map(s => s.seat);
      
      return { seats, n: seats.length, names, avatars, isAI, ids, souls, mySeat, myDbSeat, remoteSeats };
    }

    // ── 内部方法:心跳 ──
    async #sendHeartbeat(){
      if (!this.#running || this.#mySeat < 0) return;
      try {
        // TODO: 调用 supabase.rpc('eh_gt_heartbeat', { table_id })
      } catch(e){
        this.#triggerError('heartbeat', e);
      }
    }

    // ── 内部方法:触发回调 ──
    #triggerCallback(name, ...args){
      const cb = this.#callbacks[name];
      if (typeof cb === 'function'){
        try { cb(...args); }
        catch(e){ console.error(`[GameTableSync] callback ${name} 抛错:`, e); }
      }
    }

    #triggerError(ctx, err){
      console.error(`[GameTableSync] ${ctx}:`, err);
      this.#triggerCallback('onError', { context: ctx, error: err });
    }
  }

  // 导出(ESM + CJS + 全局)
  if (typeof module !== 'undefined' && module.exports){
    module.exports = GameTableSync;
  } else if (typeof define === 'function' && define.amd){
    define([], () => GameTableSync);
  } else {
    root.GameTableSync = GameTableSync;
  }

})(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this);
