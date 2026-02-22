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
      this.handleResourcePackRequest(packet, true) // true 表示是新協議
    })

    // 移除資源包封包 (1.20.3+)
    this.bot._client.on('remove_resource_pack', (packet) => {
      const uuid = packet.uuid || packet.UUID
      console.log(`[ResourcePack] 🗑️ 伺服器要求移除資源包: ${uuid || '全部'}`)
    })

    // 舊版本使用 resource_pack_send
    this.bot._client.on('resource_pack_send', (packet) => {
      console.log('[ResourcePack] ⚡ 捕獲到 resource_pack_send 封包（舊版）！')
      this.handleResourcePackRequest(packet, false) // false 表示是舊協議
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
  handleResourcePackRequest(packet, isNewProtocol) {
    if (this.options.logPackets) {
      console.log('[ResourcePack] 收到資源包請求:')
      console.log(`  URL: ${packet.url || 'N/A'}`)
      console.log(`  Hash: ${packet.hash || 'N/A'}`)
      console.log(`  Forced: ${packet.forced || false}`)
      if (isNewProtocol) {
        console.log(`  UUID: ${packet.uuid || packet.UUID || 'N/A'}`)
      }
    }

    // 記錄到歷史
    this.packetHistory.push({
      timestamp: Date.now(),
      url: packet.url,
      hash: packet.hash,
      forced: packet.forced,
      promptMessage: packet.promptMessage,
      uuid: packet.uuid || packet.UUID,
      isNewProtocol
    })

    // 保持最多10條歷史記錄
    if (this.packetHistory.length > 10) {
      this.packetHistory.shift()
    }

    if (this.options.autoAccept) {
      // 使用 setImmediate 確保在下一個事件循環中處理
      // 這樣可以避免某些插件（如 Nexo）的時序問題
      setImmediate(() => {
        this.acceptResourcePack(packet, isNewProtocol)
      })
    }
  }

  /**
   * 接受資源包
   */
  acceptResourcePack(packet, isNewProtocol) {
    try {
      console.log(`[ResourcePack] 📥 處理資源包請求 (${isNewProtocol ? '1.20.3+' : '舊版協議'})`)

      const uuid = packet.uuid || packet.UUID
      // 註：在 minecraft-protocol 中，不論協議新舊，回應封包名稱一律為 'resource_pack_receive'
      // 只是新版 (1.20.3+) 的 payload 中需要帶有 uuid 屬性。
      const packetName = 'resource_pack_receive'

      const sendStatus = (resultCode) => {
        if (!this.bot._client || this.bot._client.state === 'closed') return;
        
        const payload = { result: resultCode };
        if (isNewProtocol && uuid) {
          payload.uuid = uuid;
        } else if (!isNewProtocol && packet.hash) {
          // 舊版某些伺服器可能會需要 hash，但在 NMP 中 resource_pack_receive 通常只期待 result
          // payload.hash = packet.hash; 
        }
        
        this.bot._client.write(packetName, payload);
      };

      // 模擬真實客戶端的延遲與順序 (照 1.20.3+ 協議.md 建議)
      // 1. Accepted (3) - 立即發送
      sendStatus(3);
      console.log('[ResourcePack] ✓ 已發送 accepted (3)');

      if (isNewProtocol) {
        // 2. Downloaded (4) - 50ms 後
        setTimeout(() => {
          sendStatus(4);
          console.log('[ResourcePack] ✓ 已發送 downloaded (4)');

          // 3. Successfully loaded (0) - 再 50ms 後
          setTimeout(() => {
            sendStatus(0);
            console.log('[ResourcePack] ✅ 已發送 successfully_loaded (0)');
            this.bot.resourcePackLoaded = true;
            this.bot.emit('resourcePackLoaded');
          }, 50); // 改成 50ms，以符合文件
        }, 50);
      } else {
        // 舊版協議：通常直接發送 Successfully Loaded (0) 即可
        setTimeout(() => {
          sendStatus(0);
          console.log('[ResourcePack] ✅ 已發送 successfully_loaded (0)');
          this.bot.resourcePackLoaded = true;
          this.bot.emit('resourcePackLoaded');
        }, 500); // 舊版延遲稍長一點
      }

    } catch (error) {
      console.error('[ResourcePack] 接受資源包時發生錯誤:', error.message)
      console.error('[ResourcePack] 封包內容:', JSON.stringify(packet, null, 2))
    }
  }

  /**
   * 拒絕資源包
   */
  declineResourcePack(isNewProtocol = true, uuid = null) {
    try {
      const packetName = 'resource_pack_receive'
      const payload = { result: 1 } // 1 = Declined
      if (isNewProtocol && uuid) payload.uuid = uuid

      this.bot._client.write(packetName, payload)
      console.log('[ResourcePack] ❌ 已拒絕資源包')
    } catch (error) {
      console.error('[ResourcePack] 拒絕資源包時發生錯誤:', error.message)
    }
  }

  /**
   * 報告下載失敗
   */
  reportDownloadFailed(isNewProtocol = true, uuid = null) {
    try {
      const packetName = 'resource_pack_receive'
      const payload = { result: 2 } // 2 = Failed download
      if (isNewProtocol && uuid) payload.uuid = uuid

      this.bot._client.write(packetName, payload)
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