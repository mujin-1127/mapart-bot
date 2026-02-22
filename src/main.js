const fs = require('fs')
const path = require('path')
const readline = require('readline')
const BotInstance = require('./BotInstance')
const logger = require('../lib/logger').module('Main')
const mapart = require('./mapart')

require('events').EventEmitter.defaultMaxListeners = 0

// --- Path and Config Setup ---
const executableDir = path.dirname(process.execPath)
const projectRootDir = path.resolve(__dirname, '..')

function resolveDefaultConfigPath() {
  const candidates = []
  if (process.pkg) {
    candidates.push(path.join(executableDir, 'config.json'))
    candidates.push(path.join(process.cwd(), 'config.json'))
  } else {
    candidates.push(path.join(projectRootDir, 'config.json'))
    candidates.push(path.join(process.cwd(), 'config.json'))
    candidates.push(path.join(executableDir, 'config.json'))
  }
  return candidates.find(p => fs.existsSync(p)) || candidates[0]
}

function getConfigPath() {
  const arg = process.argv.find(a => a.startsWith('--config='))
  if (arg) return path.resolve(arg.split('=')[1])
  if (process.env.BOT_CONFIG_PATH) return path.resolve(process.env.BOT_CONFIG_PATH)
  return resolveDefaultConfigPath()
}

const configPath = getConfigPath()
let fullConfig
try {
  console.log(`[INFO] Attempting to load configuration from: ${configPath}`)
  if (!fs.existsSync(configPath)) {
    throw new Error(`Configuration file 'config.json' not found at: ${configPath}`)
  }
  fullConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'))
} catch (error) {
  console.error(`[FATAL] Failed to read or parse config file: ${error.message}`)
  process.exit(1)
}

const runtimeDataDir = path.dirname(configPath)
const WebServer = require('../lib/webServer')

// --- Global Error Handling ---
// ...

// --- Multi-Bot Management ---
const botInstances = new Map()
let activeBotUsername = null
let centralWebServer = null

function getBotConfigs() {
  // 如果設定檔有 bots 陣列，則使用多 bot 模式
  if (Array.isArray(fullConfig.bots)) {
    return fullConfig.bots.map(botCfg => ({
      ...fullConfig, // 繼承全域設定
      ...botCfg      // 覆蓋 bot 特定設定
    }))
  }
  // 否則退回單 bot 模式 (相容舊版)
  return [fullConfig]
}

async function startAllBots() {
  if (!centralWebServer) {
    centralWebServer = new WebServer(fullConfig.webPort || 3000, configPath)
    centralWebServer.on('reload-bots', () => reloadAllBots())
    centralWebServer.start()
  }

  const configs = getBotConfigs()
  for (const cfg of configs) {
    const botId = cfg.id || cfg.username
    if (!botId) continue
    const instance = new BotInstance(cfg, runtimeDataDir, configPath, centralWebServer)
    botInstances.set(botId, instance)
    if (!activeBotUsername) activeBotUsername = botId
    
    // 預設不自動連線，除非設定中有註記或是列表第一個
    // 這裡我們維持手動啟動
  }
}

async function stopAllBots() {
  for (const [botId, instance] of botInstances) {
    if (centralWebServer) centralWebServer.unregisterBot(botId)
    instance.stop()
  }
  botInstances.clear()
}

async function reloadAllBots() {
  logger.info('[Main] 收到重新載入請求，正在更新機器人清單...')
  
  // 重新讀取設定檔
  try {
    const configFileContent = fs.readFileSync(configPath, 'utf8')
    fullConfig = JSON.parse(configFileContent)
  } catch (err) {
    logger.error(`[Main] 重新載入設定檔失敗: ${err.message}`)
    return
  }

  const newConfigs = getBotConfigs()
  const newBotIds = new Set(newConfigs.map(c => c.id || c.username).filter(id => id))

  // 1. 移除不再需要的機器人
  for (const [botId, instance] of botInstances) {
    if (!newBotIds.has(botId)) {
      logger.info(`[Main] 正在移除機器人: ${botId}`)
      if (centralWebServer) centralWebServer.unregisterBot(botId)
      instance.stop()
      botInstances.delete(botId)
    }
  }

  // 2. 新增或更新機器人
  for (const cfg of newConfigs) {
    const botId = cfg.id || cfg.username
    if (!botId) continue

    if (botInstances.has(botId)) {
      // 更新現有機器人的配置
      const instance = botInstances.get(botId)
      instance.config = cfg
      // 注意：這裡只更新了內存中的 config 物件，若需要重新連線才能生效的設定（如 IP/Username）
      // 則需要使用者在 GUI 手動斷開再連線，或我們在此判斷是否需要重連
    } else {
      // 建立新機器人
      logger.info(`[Main] 正在新增機器人: ${botId}`)
      const instance = new BotInstance(cfg, runtimeDataDir, configPath, centralWebServer)
      botInstances.set(botId, instance)
    }
  }

  logger.info('[Main] 機器人清單更新完成')
}

// 監聽重啟信號
process.on('reload-bots-signal', () => {
  reloadAllBots()
})

// --- Console Readline ---
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false })
rl.on('line', async (line) => {
  const trimmed = (line || '').trim()
  if (!trimmed.length) return

  // 管理指令：切換目前的 Console 焦點 bot
  if (trimmed.startsWith('!')) {
    const parts = trimmed.slice(1).split(/\s+/)
    const cmd = parts[0].toLowerCase()
    
    if (cmd === 'list') {
      console.log('--- 機器人列表 ---')
      for (const [username, instance] of botInstances) {
        const status = instance.bot?.entity ? '在線' : '離線'
        const activeMark = username === activeBotUsername ? '*' : ' '
        console.log(`${activeMark} ${username} [${status}]`)
      }
      return
    }
    
    if (cmd === 'switch' || cmd === 's') {
      const target = parts[1]
      if (botInstances.has(target)) {
        activeBotUsername = target
        console.log(`[Main] 已將 Console 焦點切換至: ${target}`)
      } else {
        console.log(`[Main] 找不到機器人: ${target}`)
      }
      return
    }

    if (cmd === 'help') {
      console.log('--- 管理指令 ---')
      console.log('!list - 列出所有機器人')
      console.log('!switch <username> - 切換 Console 焦點')
      console.log('!help - 顯示此說明')
      return
    }
  }

  // 取得當前的焦點 bot
  const currentInstance = botInstances.get(activeBotUsername)
  if (!currentInstance || !currentInstance.bot) {
    console.log('[Main] 目前沒有活動中的機器人焦點，請使用 !switch 切換')
    return
  }

  // 發送到遊戲聊天窗
  if (trimmed.startsWith('.')) {
    const msg = trimmed.slice(1).trim()
    if (msg.length) {
      try {
        currentInstance.bot.chat(msg)
      } catch (e) {
        console.error(`[${activeBotUsername}][RL_CHAT_ERROR]`, e)
      }
    }
    return
  }

  // 地圖畫指令
  const parts = trimmed.split(/\s+/)
  if (mapart.identifier.includes(parts[0]?.toLowerCase())) {
    if (!currentInstance.mapartReady) {
      console.log(`[${activeBotUsername}] Mapart 尚未就緒`)
      return
    }
    currentInstance.dispatchMapartCommand(parts, 'console', '').then(handled => {
      if (!handled) {
        console.log(`[${activeBotUsername}] 請輸入子指令，例如: mp info、mp set 檔名 x y z、mp build`)
      }
    })
    return
  }

  console.log(`[提示][${activeBotUsername}] 要發送到遊戲聊天室請在開頭加 .  例如: .你好`)
})

// --- Graceful Shutdown ---
process.on('exit', () => {
  stopAllBots()
})
process.on('SIGINT', () => process.exit())
process.on('SIGTERM', () => process.exit())

// --- Start ---
if (require.main === module) {
  startAllBots()
}

module.exports = {
  botInstances,
  getConfigPath
}
