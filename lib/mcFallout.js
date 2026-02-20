/**
 * mcFallout 存根：無實際傳送/切服邏輯，僅供專案啟動與流程不報錯。
 * 若需真實 warp / 切服，請另行實作或替換此模組。
 */

module.exports = {
  /** 傳送（warp）：無操作，直接 resolve */
  async warp(bot, warpName, timeoutMs) {
    if (process.env.DEBUG_MCFALLOUT) {
      console.log('[mcFallout stub] warp:', warpName, timeoutMs != null ? `(${timeoutMs}ms)` : '')
    }
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
