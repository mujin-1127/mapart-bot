const fs = require('fs')
const path = require('path')
const readline = require('readline')
const mineflayer = require('mineflayer')
const ResourcePackHandler = require('./utils/ResourcePackHandler')
const mapart = require('./mapart')
const logger = require('../lib/logger').module('Main')
const { sleep } = require('../lib/utils')
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
  console.log('UncaughtError: ' + (err && err.stack ? err.stack : err))
})
process.on('unhandledRejection', (reason, promise) => {
  console.error('UnhandledRejection:', reason)
})
let deathCount = 0
let dailyRewardTimer = null
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

// --- Global Variables ---
let currentBot = null
let currentWebServer = null
let rl = null
let mapartReady = false

// --- Main Bot Logic ---
// 啟動 bot 並掛載事件與重連邏輯
async function startBot() {
  const opts = buildBotOptions()
  const bot = mineflayer.createBot(opts)
  currentBot = bot
  mapartReady = false
  bot.resourcePackLoaded = false

  // 初始化並立即啟用資源包處理器（1.20.2+ configuration 階段需要）
  const resourcePackHandler = new ResourcePackHandler(bot, {
    autoAccept: true,
    logPackets: true
  })
  resourcePackHandler.enable()
  console.log('[ResourcePack] 資源包自動接受已啟用')

  // ----- Web GUI Server -----
  // 斷線重連前先關閉舊的 WebServer
  if (currentWebServer) {
    currentWebServer.stop()
  }
  const webServer = new WebServer(bot, config.webPort || 3000)
  currentWebServer = webServer
  
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
  // 僅在第一次啟動時初始化 readline 介面
  if (!rl) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
    rl.on('line', (line) => {
      // 在監聽器內部抓取當前的 currentBot
      const bot = currentBot
      if (!bot) return

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
  }

  // ----- On spawn -----
  let lobbySent = false
  const sendLobbyCommand = async () => {
    if (lobbySent) return
    lobbySent = true
    
    try {
      const lobbyCmd = config.lobbyCommand || '/server lobby'
      bot.chat(lobbyCmd)
      logger.info(`[AutoCommand] 已發送切換分流指令: ${lobbyCmd}`)
    } catch (e) {
      logger.error(`[AutoCommand] 發送切換分流指令發生異常: ${e.message}`)
      lobbySent = false
    }
  }

  // ----- Mapart Initialization -----
  const initMapart = async () => {
    ensureMapartConfigDirs(config.username)
    try {
      await mapart.init(bot, config.username, mapartLogger)
      mapartReady = true
      console.log('[Mapart] 地圖畫外掛已載入，可用 mapart / mp / map 前綴下指令。')
    } catch (e) {
      console.error('[Mapart] 初始化失敗:', e.message)
    }
  }

  bot.once('spawn', async () => {
    logger.info('[Main] 機器人核心啟動程序完成')

    await sendLobbyCommand()
    
    // 初始化空間索引
    entityIndexer = new EntityIndexer(bot);
    bot.entityIndexer = entityIndexer; // 導出給其他模組使用
    
    bot.botinfo = { server: 0 }
    bot.loadPlugin(require('mineflayer-collectblock').plugin)

    // 地圖畫外掛：確保設定目錄並初始化
    await initMapart()
  })

  const onMessage = (jsonMsg) => {
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
      }
    }
  }

  const onDeath = async () => {
    await bot.waitForTicks(10)
    deathCount++
    console.log(`已死亡: ${deathCount} 次，且已自動/back返回`)
    try { bot.chat('/back') } catch (e) { console.error('Failed to send /back command after death:', e) }
  }

  const onKicked = (reason) => {
    console.log('被伺服器踢出:', reason)
  }

  const onError = (err) => {
    console.log('發生錯誤:', err)
  }

  const onEnd = (reason) => {
    console.log(`連線已中斷: ${reason}, 10秒後將重新連線...`)
    clearTimeout(dailyRewardTimer)

    // 清理資源與事件監聽器，避免記憶體洩漏
    bot.removeListener('message', onMessage)
    bot.removeListener('death', onDeath)
    bot.removeListener('kicked', onKicked)
    bot.removeListener('error', onError)
    bot.removeListener('end', onEnd)

    // 取消 Mapart 的 onBlockUpdate 等全域監聽 (如有)
    bot.removeAllListeners('blockUpdate')

    // 關閉網頁伺服器，釋放埠號
    if (currentWebServer) {
      currentWebServer.stop()
      currentWebServer = null
    }

    const delay = config.reconnectDelay || 10000
    setTimeout(startBot, delay)
  }

  // 掛載事件監聽器
  bot.on('message', onMessage)
  bot.on('death', onDeath)
  bot.on('kicked', onKicked)
  bot.on('error', onError)
  bot.on('end', onEnd)
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
