/**
 * 傳送／切服：此伺服器傳送指令為 /res tp <warpName>
 */

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

module.exports = {
  /** 傳送（warp）：執行 /res tp <warpName>，可選等待時間後 resolve */
  async warp(bot, warpName, timeoutMs) {
    if (!warpName || typeof warpName !== 'string') return
    const cmd = `/res tp ${warpName.trim()}`
    bot.chat(cmd)
    const wait = timeoutMs != null ? Number(timeoutMs) : 2000
    if (wait > 0) await sleep(wait)
  },

  /** 切換伺服器：無操作，直接 resolve */
  async promiseTeleportServer(bot, server, timeoutMs) {
    if (process.env.DEBUG_MCFALLOUT) {
      console.log('[mcFallout stub] promiseTeleportServer:', server, timeoutMs)
    }
  },

  /** 開啟防呆／特殊物品處理：無操作，直接 resolve */
  async openPreventSpecItem(bot) {
    if (process.env.DEBUG_MCFALLOUT) {
      console.log('[mcFallout stub] openPreventSpecItem')
    }
  }
}
