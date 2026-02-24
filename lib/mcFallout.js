const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * 伺服器特定功能模組 (Refactored with Retry)
 */
module.exports = {
  /** 
   * 傳送 (warp)：執行 /res tp <warpName>，具備簡單重試機制
   */
  async warp(bot, warpName, timeoutMs = 5000, retries = 0) {
    if (!warpName || typeof warpName !== 'string') return false;
    
    const cmd = `/res tp ${warpName.trim()}`;
    const successMsg = "【系統貓】傳送到附近的領地。";
    
    for (let i = 0; i <= retries; i++) {
        console.log(`[mcFallout] 執行傳送 (${i + 1}/${retries + 1}): ${cmd}`);
        
        const waitMessage = new Promise((resolve) => {
            const handler = (msg) => {
                if (msg.includes(successMsg)) {
                    bot.removeListener('messagestr', handler);
                    resolve(true);
                }
            };
            bot.on('messagestr', handler);
            setTimeout(() => {
                bot.removeListener('messagestr', handler);
                resolve(false);
            }, timeoutMs);
        });

        bot.chat(cmd);
        
        if (retries === 0) {
            const result = await Promise.race([waitMessage, sleep(1000).then(() => true)]);
            return result;
        }

        const success = await waitMessage;
        if (success) {
            console.log(`[mcFallout] 傳送成功`);
            return true;
        }
        
        if (i < retries) {
            console.log(`[mcFallout] 傳送超時，準備重試...`);
            await sleep(1000);
        }
    }
    return false;
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
