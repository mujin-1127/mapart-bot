const fs = require('fs')
const path = require('path')
const readline = require('readline')
const mineflayer = require('mineflayer')
const ResourcePackHandler = require('./utils/ResourcePackHandler')
const mapart = require('./mapart')
const logger = require('../lib/logger').module('Main')
const { readConfig } = require('../lib/utils')
const WebServer = require('../lib/webServer')

const commandManager = require('./commands/CommandManager')

require('events').EventEmitter.defaultMaxListeners = 0

// --- Path and Config Setup ---
// When packaged with pkg, __dirname points to the snapshot filesystem.
// We need to use process.execPath to find the directory of the actual executable.
const executableDir = path.dirname(process.execPath)
const projectRootDir = path.resolve(__dirname, '..')

console.log('--- [DEBUG] Path Information ---')
console.log(`Executable Directory (executableDir): ${executableDir}`)
console.log(`Current Working Directory (process.cwd()): ${process.cwd()}`)
console.log(`Project Root Directory (projectRootDir): ${projectRootDir}`)
console.log('---------------------------------')

// --- Runtime Configuration Loading ---
// This logic determines the config file path at runtime, preventing pkg from bundling it.
// Priority: 1. CLI argument, 2. Environment variable, 3. Default file next to executable or project/work dir.

/**
 * 解析預設設定檔路徑（支援開發與 pkg 執行檔）
 */
// 解析預設設定檔路徑（依執行環境挑選候選）
function resolveDefaultConfigPath() {
  const candidates = []

  // pkg 版：設定檔放在可寫的執行檔同層 或 當前工作目錄
  if (process.pkg) {
    candidates.push(path.join(executableDir, 'config.json'))
    candidates.push(path.join(process.cwd(), 'config.json'))
  } else {
    // 開發模式：優先專案根，再工作目錄，最後退回執行檔目錄
    candidates.push(path.join(projectRootDir, 'config.json'))
    candidates.push(path.join(process.cwd(), 'config.json'))
    candidates.push(path.join(executableDir, 'config.json'))
  }

  const existing = candidates.find(p => fs.existsSync(p))
  return existing || candidates[0]
}

/**
 * 取得設定檔路徑：CLI > 環境變數 > 預設候選
 */
// 取得設定檔路徑（優先權：CLI > 環境變數 > 預設）
function getConfigPath() {
  // 1. Check for --config=<path> argument
  const arg = process.argv.find(a => a.startsWith('--config='))
  if (arg) {
    return path.resolve(arg.split('=')[1])
  }

  // 2. Check for BOT_CONFIG_PATH environment variable
  if (process.env.BOT_CONFIG_PATH) {
    return path.resolve(process.env.BOT_CONFIG_PATH)
  }

  // 3. Default path based on runtime environment
  return resolveDefaultConfigPath()
}

const configPath = getConfigPath()
let config
try {
  console.log(`[INFO] Attempting to load configuration from: ${configPath}`)
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file 'config.json' not found at: ${configPath}`)
  }
  const configFileContent = fs.readFileSync(configPath, 'utf8')
  config = JSON.parse(configFileContent)
} catch (error) {
  console.error(`[FATAL] Failed to read or parse config file: ${error.message}`)
  console.log('\n請按 Enter 鍵結束程式...')
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout })
  rl.question('', () => {
    rl.close()
    process.exit(1)
  })
}

// 設定檔所在目錄（亦作為 token 快取目錄）
const runtimeDataDir = path.dirname(configPath)

// --- Global Error Handling & Variables ---
process.on('uncaughtException', (err) => {
  console.log('UncoughtError: ' + (err && err.stack ? err.stack : err))
})
let deathCount = 0
let dailyRewardTimer = null
let moneyTransferTimer = null
let lastClaimDate = null
const HEART_SYMBOL = '❤'

// --- Helper Functions ---
// 取得清理後的白名單列表
function getCleanWhitelist() {
  return (config.whitelist || []).map(cleanPlayerName)
}

// 移除玩家名中的括號備註
function cleanPlayerName(username) {
  return username.replace(/\s*\(.+?\)\s*/, '').trim()
}

// 組合 bot 啟動選項（含裝置代碼登入提示與快取目錄）
function buildBotOptions() {
  const opts = {
    host: config.ip,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version,
    hideErrors: true, // 隱藏協議解析錯誤（如 world_particles PartialReadError）的 console 輸出
    profilesFolder: path.join(runtimeDataDir, '.minecraft'),
    onMsaCode: (data) => {
      console.log(`[MSA] 請於 ${data.verification_uri} 輸入代碼：${data.user_code}，有效期 ${Math.round(data.expires_in / 60)} 分鐘`)
    }
  }
  return opts
}

// --- 空間索引管理 (優化 getItemFrame 效率) ---
const EntityIndexer = require('../lib/entityIndexer');
let entityIndexer;

// --- Mapart 地圖畫外掛 ---
// 供 mapart.init 使用的 logger
const mapartLogger = logger.log.bind(logger)

// 確保 mapart 設定目錄存在（config/<bot_id>、config/global）
function ensureMapartConfigDirs(botId) {
  const base = path.join(process.cwd(), 'config')
  const dirs = [path.join(base, botId), path.join(base, 'global')]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

// 分發地圖畫指令：content 為已切開的陣列，例如 ['mapart','set','file.nbt','0','100','0']
async function dispatchMapartCommand(bot, content, source, minecraftUser) {
  if (!content || content.length < 2) return false
  const prefix = (content[0] || '').toLowerCase()
  const subArgs = content.slice(1) // 獲取子指令與參數
  
  if (!commandManager.isPrefix(prefix)) return false
  
  const context = { source, minecraftUser: minecraftUser || '' }
  
  try {
    const handled = await commandManager.dispatch(bot, subArgs, context)
    if (handled) return true
    
    // 如果 CommandManager 沒處理，嘗試舊的 mapart.cmd (相容過渡期)
    const sub = (subArgs[0] || '').toLowerCase()
    const cmd = mapart.cmd.find(c => c.vaild && c.identifier.includes(sub))
    if (!cmd) return false
    
    const task = { content, source, minecraftUser: minecraftUser || '' }
    await cmd.execute(task)
    return true
  } catch (err) {
    console.error('[Mapart] 執行錯誤:', err)
    if (source === 'minecraft-dm' && minecraftUser) bot.chat(`/m ${minecraftUser} &c執行錯誤: ${err.message}`)
    return true
  }
}

// --- Main Bot Logic ---
// 啟動 bot 並掛載事件與重連邏輯
async function startBot() {
  const opts = buildBotOptions()
  const bot = mineflayer.createBot(opts)
  let mapartReady = false

  // 初始化並立即啟用資源包處理器（1.20.2+ configuration 階段需要）
  const resourcePackHandler = new ResourcePackHandler(bot, {
    autoAccept: true,
    logPackets: true
  })
  resourcePackHandler.enable()
  console.log('[ResourcePack] 資源包自動接受已啟用')

  // ----- Web GUI Server -----
  const webServer = new WebServer(bot, config.webPort || 3000)
  
  // 註冊 Web 指令處理器
  webServer.onCommandHandler = async (cmd) => {
    const trimmed = (cmd || '').trim()
    if (!trimmed.length) return false
    
    // 開頭是 "." 當作一般聊天
    if (trimmed.startsWith('.')) {
      const msg = trimmed.slice(1).trim()
      if (msg.length) {
        try { bot.chat(msg) } catch (e) { console.error('[WEB_CHAT_ERROR]', e) }
      }
      return true
    }
    
    const parts = trimmed.split(/\s+/)
    if (mapart.identifier.includes(parts[0]?.toLowerCase())) {
      if (!mapartReady) {
        logger.warn('[WebServer] Mapart 尚未就緒')
        return true
      }
      return await dispatchMapartCommand(bot, parts, 'web', '')
    }
    
    return false // 交回 WebServer 用 bot.chat 發送
  }
  
  webServer.start()

  // ----- Chat bridge (stdin -> game) -----
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
  rl.on('line', (line) => {
    const trimmed = (line || '').trim()
    if (!trimmed.length) return
    // 要發送到遊戲聊天窗的內容，開頭須加 "."
    if (trimmed.startsWith('.')) {
      const msg = trimmed.slice(1).trim()
      if (msg.length) {
        try { bot.chat(msg) } catch (e) { console.error('[RL_CHAT_ERROR]', e) }
      }
      return
    }
    const parts = trimmed.split(/\s+/)
    if (mapart.identifier.includes(parts[0]?.toLowerCase())) {
      if (!mapartReady) {
        console.log('[Mapart] 尚未就緒，請等待 bot 進入遊戲後再試。')
        return
      }
      dispatchMapartCommand(bot, parts, 'console', '').then(handled => {
        if (!handled) {
          console.log('[Mapart] 請輸入子指令，例如: mp info、mp set 檔名 x y z、mp build')
        }
      })
      return
    }
    // 未加 "." 的內容不會送進遊戲，僅提示
    console.log('[提示] 要發送到遊戲聊天室請在開頭加 .  例如: .你好')
  })

  // ----- On spawn -----
  let lobbySent = false
  const sendLobbyCommand = () => {
    if (lobbySent) return
    lobbySent = true
    
    logger.info('[AutoCommand] 偵測到機器人進入世界，準備發送指令...')
    
    // 進入伺服器後自動執行指令
    setTimeout(() => {
      try {
        bot.chat('/server lobby')
        logger.info('[AutoCommand] 已自動發送指令: /server lobby')
      } catch (e) {
        logger.error(`[AutoCommand] 自動發送指令發生異常: ${e.message}`)
        lobbySent = false
      }
    }, 2000) // 2 秒延遲
  }

  bot.once('spawn', async () => {
    logger.info('[Main] 機器人核心啟動程序完成 (v2)')
    logger.info(`whitelist: ${getCleanWhitelist().join(', ')}`)
    sendLobbyCommand()
    
    // 初始化空間索引
    entityIndexer = new EntityIndexer(bot);
    bot.entityIndexer = entityIndexer; // 導出給其他模組使用
    
    bot.botinfo = { server: 0 }
    bot.loadPlugin(require('mineflayer-collectblock').plugin)
    bot.chatAddPattern(/^\[傳送\]\s*(.+?)\s*請求傳送到你這裡（請注意安全）。?$/, 'tpa_to_me', 'TPA請求')
    bot.chatAddPattern(/^\[傳送\]\s*(.+?)\s*請求你傳送到他那裡（請注意安全）。?$/, 'tpa_from_me', 'TPA請求')
    // 地圖畫外掛：確保設定目錄並初始化
    ensureMapartConfigDirs(config.username)
    try {
      await mapart.init(bot, config.username, mapartLogger)
      mapartReady = true
      console.log('[Mapart] 地圖畫外掛已載入，可用 mapart / mp / map 前綴下指令。')
    } catch (e) {
      console.error('[Mapart] 初始化失敗:', e.message)
    }
  })

  // ----- TPA handling -----
  bot.on('tpa_to_me', (player) => {
    const cleanedPlayer = cleanPlayerName(player)
    if (getCleanWhitelist().includes(cleanedPlayer)) {
      bot.chat(`/tpyes ${cleanedPlayer}`)
      console.log(`已接受來自 ${cleanedPlayer} 的TPA請求`)
    } else {
      bot.chat(`/tpno ${cleanedPlayer}`)
      console.log(`已拒絕來自 ${cleanedPlayer} 的TPA請求 (不在白名單)`)
    }
  })

  bot.on('tpa_from_me', (player) => {
    const cleanedPlayer = cleanPlayerName(player)
    if (getCleanWhitelist().includes(cleanedPlayer)) {
      bot.chat(`/tpyes ${cleanedPlayer}`)
      console.log(`已接受來自 ${cleanedPlayer} 的TPA請求`)
    } else {
      bot.chat(`/tpno ${cleanedPlayer}`)
      console.log(`已拒絕來自 ${cleanedPlayer} 的TPA請求 (不在白名單)`)
    }
  })

  // ----- Message handling (commands) -----
  bot.on('message', (jsonMsg) => {
    const text = jsonMsg.toString().trim()
    if (!text) return

    try { if (!text.includes(HEART_SYMBOL)) console.log(text) } catch (e) { console.error('[MSG_LOG_ERROR]', e) }

    const directMsgMatch = text.match(/^\[(.+?)\s*->\s*我\]\s*(.+)$/)
    if (directMsgMatch) {
      const player = cleanPlayerName(directMsgMatch[1])
      const message = directMsgMatch[2].trim()
      if (getCleanWhitelist().includes(player)) {
        const parts = message.split(/\s+/)
        if (parts[0] && mapart.identifier.includes(parts[0].toLowerCase())) {
          if (mapartReady) {
            dispatchMapartCommand(bot, parts, 'minecraft-dm', player).then(handled => {
              if (handled) return
              // 如果沒被處理，繼續檢查其他指令
            })
            // 注意：這裡因為 async 關係，可能會繼續執行後面的 check
          }
        }
        const command = parts[0]
        if (command === 'dropall') dropAll(bot)
        if (command === 'job') autoJob(bot)
        if (command === 'gorpg') toRpg(bot)
      }
    }
  })

  // ----- Death handling -----
  bot.on('death', async () => {
    await bot.waitForTicks(10)
    deathCount++
    console.log(`已死亡: ${deathCount} 次，且已自動/back返回`)
    try { bot.chat('/back') } catch (e) { console.error('Failed to send /back command after death:', e) }
  })

  // ----- Kick/disconnect debug -----
  bot.on('kicked', (reason) => {
    console.log('被伺服器踢出:', reason)
  })

  bot.on('error', (err) => {
    console.log('發生錯誤:', err)
  })

  // ----- Auto-reconnect -----
  bot.on('end', (reason) => {
    console.log(`連線已中斷: ${reason}, 10秒後將重新連線...`)
    rl.close()
    clearTimeout(dailyRewardTimer)
    clearInterval(moneyTransferTimer)
    setTimeout(startBot, 10000)
  })
}

// --- Actions ---
// 丟出背包所有物品
async function dropAll(bot) {
  console.log('正在丟棄所有物品...')
  for (const item of bot.inventory.items()) {
    try {
      await bot.tossStack(item)
    } catch (e) {
      // ignore errors
    }
  }
  console.log('所有物品已丟棄完畢')
}

// 自動開啟並選擇職業
async function autoJob(bot) {
  console.log('正在自動選擇職業...')
  try {
    bot.chat('/job')
    const menu = await bot.waitForWindow()
    await bot.clickWindow(19, 0, 0) // 點擊礦工
    await bot.waitForTicks(20)
    await bot.clickWindow(40, 0, 0) // 點擊確認
    bot.closeWindow(menu)
    console.log('職業選擇完畢')
  } catch (e) {
    console.error('自動選擇職業失敗:', e)
  }
}

// 切換到 RPG 分流
async function toRpg(bot) {
  console.log('正在前往RPG分流...')
  try {
    bot.chat('/rpg')
    const menu = await bot.waitForWindow()
    await bot.clickWindow(9, 0, 0) // 點擊RPG-1
    await bot.waitForTicks(20)
    await bot.clickWindow(24, 0, 0) // 點擊確認
    bot.closeWindow(menu)
    console.log('已進入RPG分流')
  } catch (e) {
    console.error('前往RPG分流失敗:', e)
  }
}

// 每小時自動轉帳任務
async function transferMoneyTask(bot) {
  const targetPlayer = config.moneyTransferTarget
  try {
    console.log('[PAY] 執行每小時轉帳任務...')
    const amount = await getMoney(bot)

    if (amount !== null && amount > 0) {
      console.log(`[PAY] 查詢到餘額: ${amount}。正在支付給 ${targetPlayer}...`)
      bot.chat(`/pay ${targetPlayer} ${amount}`)
    } else {
      console.log('[PAY] 餘額為0或查詢失敗，本次不執行轉帳。')
    }
  } catch (err) {
    console.error('[PAY] 轉帳任務發生錯誤:', err.message)
  }
}

// 查詢餘額並解析回應訊息
function getMoney(bot) {
  console.log('[MONEY] 正在查詢餘額...')
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      bot.removeListener('message', listener)
      reject(new Error('查詢餘額超時，伺服器沒有回應。'))
    }, 10000) // 10秒超時

    const listener = (jsonMsg) => {
      const message = jsonMsg.toString().trim()
      if (!message) return

      // [偵錯用] 將收到的每一條訊息都印出來，方便我們看到原始資料
      console.log(`[MONEY_DEBUG] Received message: "${message}"`)

      // 最終修正版正規表示式：
      // 1. 使用 [\s:：$]* 避免貪婪匹配問題
      // 2. 使用 ([\d,]+\.?\d*) 來同時支援整數和小數
      const moneyRegex = /(?:餘額|金錢|您目前擁有|money|balance)[\s:：$]*([\d,]+\.?\d*)/i
      const match = message.match(moneyRegex)

      if (match && match[1]) {
        clearTimeout(timeout)
        bot.removeListener('message', listener)
        // 使用 parseFloat 來處理小數，並在轉換前移除所有逗號
        const amount = parseFloat(match[1].replace(/,/g, ''))
        resolve(amount)
      }
    }

    bot.on('message', listener)
    bot.chat('/money')
  })
}

// --- Graceful Shutdown ---
// 清理資源（保留擴充點）
function cleanup() {
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit()) // ctrl-c
process.on('SIGTERM', () => process.exit()) // kill

// --- Start the bot (only when executed directly) ---
if (require.main === module) {
  startBot()
}

// 匯出函式供開發/測試使用
module.exports = {
  startBot,
  getConfigPath,
  resolveDefaultConfigPath
}
