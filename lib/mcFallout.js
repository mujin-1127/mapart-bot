const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 伺服器特定功能模組 (Refactored with Retry)
 */
module.exports = {
  /** 
   * 傳送 (warp)：執行 /res tp <warpName>，具備簡單重試機制
   */
  async warp(bot, warpName, timeoutMs = 3000, retries = 2) {
    if (!warpName || typeof warpName !== 'string') return;
    
    const cmd = `/res tp ${warpName.trim()}`;
    
    for (let i = 0; i <= retries; i++) {
        console.log(`[mcFallout] 執行傳送 (${i + 1}/${retries + 1}): ${cmd}`);
        bot.chat(cmd);
        
        // 等待傳送生效
        const wait = Number(timeoutMs);
        await sleep(wait);
        
        // 這裡可以加入檢查是否成功的邏輯，目前先以等待為主
        if (i < retries) {
            // 如果需要，可以在這裡加入檢查座標是否變化的邏輯來判斷是否重試
        }
    }
  },

  /** 
   * 切換伺服器：目前為 Stub
   */
  async promiseTeleportServer(bot, server, timeoutMs) {
    if (process.env.DEBUG_MCFALLOUT) {
      console.log('[mcFallout stub] promiseTeleportServer:', server, timeoutMs);
    }
    await sleep(timeoutMs || 1000);
  },

  /** 
   * 開啟防呆／特殊物品處理：目前為 Stub
   */
  async openPreventSpecItem(bot) {
    if (process.env.DEBUG_MCFALLOUT) {
      console.log('[mcFallout stub] openPreventSpecItem');
    }
  }
};
