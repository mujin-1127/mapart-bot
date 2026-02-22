/**
 * 資源包自動處理模組
 * 自動接受伺服器發送的資源包請求
 */

class ResourcePackHandler {
  constructor(bot, options = {}) {
    this.bot = bot
    this.options = {
      autoAccept: true, // 自動接受資源包
      logPackets: true, // 記錄資源包請求
      ...options
    }

    this.packetHistory = []
    this.isEnabled = false
  }

  /**
   * 啟用資源包自動接受功能
   */
  enable() {
    if (this.isEnabled) {
      console.log('[ResourcePack] 已經啟用')
      return
    }

    console.log('[ResourcePack] 正在註冊資源包事件監聽器...')

    // 1.20.3+ 使用 add_resource_pack
    this.bot._client.on('add_resource_pack', (packet) => {
      console.log('[ResourcePack] ⚡ 捕獲到 add_resource_pack 封包（1.20.3+）！')
      this.handleResourcePackRequest(packet)
    })

    // 舊版本使用 resource_pack_send
    this.bot._client.on('resource_pack_send', (packet) => {
      console.log('[ResourcePack] ⚡ 捕獲到 resource_pack_send 封包（舊版）！')
      this.handleResourcePackRequest(packet)
    })

    this.isEnabled = true
    console.log('[ResourcePack] 資源包自動接受已啟用')
    console.log('[ResourcePack] 已註冊事件: add_resource_pack (1.20.3+), resource_pack_send (舊版)')
  }

  /**
   * 停用資源包自動接受功能
   */
  disable() {
    if (!this.isEnabled) {
      console.log('[ResourcePack] 已經停用')
      return
    }

    this.bot._client.removeAllListeners('resource_pack_send')
    this.isEnabled = false
    console.log('[ResourcePack] 資源包自動接受已停用')
  }

  /**
   * 處理資源包請求
   */
  handleResourcePackRequest(packet) {
    if (this.options.logPackets) {
      console.log('[ResourcePack] 收到資源包請求:')
      console.log(`  URL: ${packet.url || 'N/A'}`)
      console.log(`  Hash: ${packet.hash || 'N/A'}`)
      console.log(`  Forced: ${packet.forced || false}`)
      console.log(`  Prompt Message: ${packet.promptMessage || 'N/A'}`)
    }

    // 記錄到歷史
    this.packetHistory.push({
      timestamp: Date.now(),
      url: packet.url,
      hash: packet.hash,
      forced: packet.forced,
      promptMessage: packet.promptMessage
    })

    // 保持最多10條歷史記錄
    if (this.packetHistory.length > 10) {
      this.packetHistory.shift()
    }

    if (this.options.autoAccept) {
      // 使用 setImmediate 確保在下一個事件循環中處理
      // 這樣可以避免某些插件（如 Nexo）的時序問題
      setImmediate(() => {
        this.acceptResourcePack(packet)
      })
    }
  }

  /**
   * 接受資源包
   */
  acceptResourcePack(packet) {
    try {
      // 1.20.3+ 使用 resource_pack_status，需要包含 uuid
      // 狀態代碼:
      // 0 - successfully_loaded (成功載入)
      // 1 - declined (拒絕)
      // 2 - failed_download (下載失敗)
      // 3 - accepted (已接受)
      // 4 - downloaded (已下載)
      // 5 - invalid_url (無效URL)
      // 6 - failed_reload (重載失敗)
      // 7 - discarded (已丟棄)

      console.log('[ResourcePack] 📥 處理資源包請求 (1.20.3+)')

      const uuid = packet.uuid || packet.UUID

    // 步驟 1: 發送 accepted (已接受)
    if (!this.bot._client || this.bot._client.state === 'closed') return;
    
    // 檢查版本以決定封包格式
    const isNewVersion = this.bot.version === '1.20.3' || this.bot.version === '1.20.4' || this.bot.majorVersion >= '1.20';
    
    const sendPacket = (resultCode) => {
      if (!this.bot._client || this.bot._client.state === 'closed') return;
      
      const payload = { result: resultCode };
      if (uuid) payload.uuid = uuid; // 1.20.3+ 需要 uuid
      
      // 根據版本使用不同的封包名稱或欄位
      // 舊版 (1.8-1.20.2): serverbound 'resource_pack_receive' { result, (optional) hash }
      // 新版 (1.20.3+): serverbound 'resource_pack_receive' { uuid, result }
      
      this.bot._client.write('resource_pack_receive', payload);
    };

    // 模擬真實客戶端的延遲與順序
    // 1. Accepted (3)
    sendPacket(3);
    console.log('[ResourcePack] ✓ 已接受資源包');

    // 2. Downloaded (4) - 模擬下載時間
    setTimeout(() => {
      sendPacket(0); // 這裡修正為 0 (Successfully loaded) - 許多伺服器只期待這個最終狀態
      // 某些伺服器可能需要先傳 2 (Successfully downloaded) 再傳 0 (Successfully loaded)
      // 但根據 mineflayer 文件與抓包，通常直接回傳 0 即可，或者依序回傳
      // 修正: 根據 Wiki.vg:
      // 0: Successfully loaded
      // 1: Declined
      // 2: Failed download
      // 3: Accepted
      
      // 許多反作弊或資源包插件期待完整的狀態流：Accepted -> Successfully Loaded
      // 這裡直接發送 Loaded (0) 應該是最保險的，因為 Accepted (3) 已經發送過了
      console.log('[ResourcePack] ✅ 資源包載入完成');
      this.bot.resourcePackLoaded = true;
      this.bot.emit('resourcePackLoaded');
    }, 1000); // 延遲 1 秒模擬下載與載入

    } catch (error) {
      console.error('[ResourcePack] 接受資源包時發生錯誤:', error.message)
      console.error('[ResourcePack] 封包內容:', JSON.stringify(packet, null, 2))
    }
  }

  /**
   * 拒絕資源包
   */
  declineResourcePack() {
    try {
      this.bot._client.write('resource_pack_receive', {
        result: 1 // 1 = Declined (拒絕)
      })
      console.log('[ResourcePack] ❌ 已拒絕資源包')
    } catch (error) {
      console.error('[ResourcePack] 拒絕資源包時發生錯誤:', error.message)
    }
  }

  /**
   * 報告下載失敗
   */
  reportDownloadFailed() {
    try {
      this.bot._client.write('resource_pack_receive', {
        result: 2 // 2 = Failed download (下載失敗)
      })
      console.log('[ResourcePack] ⚠️ 已報告資源包下載失敗')
    } catch (error) {
      console.error('[ResourcePack] 報告下載失敗時發生錯誤:', error.message)
    }
  }

  /**
   * 獲取資源包請求歷史
   */
  getHistory() {
    return this.packetHistory
  }

  /**
   * 獲取最後一次資源包請求
   */
  getLastRequest() {
    return this.packetHistory[this.packetHistory.length - 1] || null
  }

  /**
   * 清除歷史記錄
   */
  clearHistory() {
    this.packetHistory = []
    console.log('[ResourcePack] 歷史記錄已清除')
  }

  /**
   * 獲取狀態
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      autoAccept: this.options.autoAccept,
      historyCount: this.packetHistory.length,
      lastRequest: this.getLastRequest()
    }
  }

  /**
   * 設定自動接受
   */
  setAutoAccept(enabled) {
    this.options.autoAccept = enabled
    console.log(`[ResourcePack] 自動接受已${enabled ? '啟用' : '停用'}`)
  }

  /**
   * 設定日誌記錄
   */
  setLogPackets(enabled) {
    this.options.logPackets = enabled
    console.log(`[ResourcePack] 日誌記錄已${enabled ? '啟用' : '停用'}`)
  }
}

module.exports = ResourcePackHandler