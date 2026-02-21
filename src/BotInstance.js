const mineflayer = require('mineflayer')
const path = require('path')
const fs = require('fs')
const ResourcePackHandler = require('./utils/ResourcePackHandler')
const mapart = require('./mapart')
const logger = require('../lib/logger')
const EntityIndexer = require('../lib/entityIndexer')
const WebServer = require('../lib/webServer')
const commandManager = require('./commands/CommandManager')

class BotInstance {
  constructor(config, runtimeDataDir, configPath) {
    this.config = config
    this.id = config.id || config.username // 優先使用 ID，沒有則退回 Username
    this.runtimeDataDir = runtimeDataDir
    this.configPath = configPath
    this.bot = null
    this.webServer = null
    this.mapartReady = false
    this.deathCount = 0
    this.entityIndexer = null
    this.log = logger.module('Main', this.id)
    this.HEART_SYMBOL = '❤'
  }

  buildBotOptions() {
    const opts = {
      host: this.config.ip,
      port: this.config.port,
      username: this.config.username, // 這裡使用實際的遊戲帳號
      auth: this.config.auth,
      version: this.config.version,
      hideErrors: true,
      // 憑證存在 .minecraft 資料夾下 (prismarine-auth 會自動依帳號 hash 分開存放)
      profilesFolder: path.join(this.runtimeDataDir, '.minecraft'),
      onMsaCode: (data) => {
        console.log(`[MSA][${this.id}] 請於 ${data.verification_uri} 輸入代碼：${data.user_code}，有效期 ${Math.round(data.expires_in / 60)} 分鐘`)
      }
    }
    return opts
  }

  async start() {
    // ... (其餘不變)
    const opts = this.buildBotOptions()
    this.bot = mineflayer.createBot(opts)
    this.bot.bot_id = this.id // 將 ID 存入 bot 實例，確保 WebServer 與指令使用 ID
    this.mapartReady = false
    this.bot.resourcePackLoaded = false

    // 初始化資源包處理器
    const resourcePackHandler = new ResourcePackHandler(this.bot, {
      autoAccept: true,
      logPackets: true
    })
    resourcePackHandler.enable()
    this.log.info('資源包自動接受已啟用')

    // 初始化 WebServer
    if (this.webServer) {
      this.webServer.stop()
    }
    this.webServer = new WebServer(this.bot, this.config.webPort || 3000, this.configPath)
    
    // 註冊重啟事件 (由 WebServer 發出)
    this.webServer.on('reload-bots', () => {
      process.emit('reload-bots-signal');
    });
    
    this.webServer.onCommandHandler = async (cmd) => {
      const trimmed = (cmd || '').trim()
      if (!trimmed.length) return false
      
      if (trimmed.startsWith('.')) {
        const msg = trimmed.slice(1).trim()
        if (msg.length) {
          try { this.bot.chat(msg) } catch (e) { this.log.error(`[WEB_CHAT_ERROR] ${e.message}`) }
        }
        return true
      }
      
      const parts = trimmed.split(/\s+/)
      if (mapart.identifier.includes(parts[0]?.toLowerCase())) {
        if (!this.mapartReady) {
          this.log.warn('Mapart 尚未就緒')
          return true
        }
        return await this.dispatchMapartCommand(parts, 'web', '')
      }
      
      return false
    }
    this.webServer.start()

    // 掛載事件
    this.bot.on('spawn', async () => {
      this.log.info('機器人核心啟動程序完成')
      await this.sendLobbyCommand()
      
      this.entityIndexer = new EntityIndexer(this.bot)
      this.bot.entityIndexer = this.entityIndexer
      
      this.bot.botinfo = { server: 0 }
      this.bot.loadPlugin(require('mineflayer-collectblock').plugin)

      await this.initMapart()
    })

    this.bot.on('message', (jsonMsg) => this.onMessage(jsonMsg))
    this.bot.on('death', () => this.onDeath())
    this.bot.on('kicked', (reason) => this.log.warn(`被伺服器踢出: ${reason}`))
    this.bot.on('error', (err) => this.log.error(`發生錯誤: ${err.message}`))
    this.bot.on('end', (reason) => this.onEnd(reason))
  }

  async sendLobbyCommand() {
    try {
      const lobbyCmd = this.config.lobbyCommand || '/server lobby'
      this.bot.chat(lobbyCmd)
      this.log.info(`已發送切換分流指令: ${lobbyCmd}`)
    } catch (e) {
      this.log.error(`發送切換分流指令發生異常: ${e.message}`)
    }
  }

  async initMapart() {
    this.ensureMapartConfigDirs(this.config.username)
    try {
      await mapart.init(this.bot, this.config.username, this.log.log.bind(this.log))
      this.mapartReady = true
      this.log.info('地圖畫外掛已載入')
    } catch (e) {
      this.log.error(`Mapart 初始化失敗: ${e.message}`)
    }
  }

  ensureMapartConfigDirs(botId) {
    const base = path.join(process.cwd(), 'config')
    const dirs = [path.join(base, botId), path.join(base, 'global')]
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }
  }

  async dispatchMapartCommand(content, source, minecraftUser) {
    if (!content || content.length < 2) return false
    const prefix = (content[0] || '').toLowerCase()
    const subArgs = content.slice(1)
    
    if (!commandManager.isPrefix(prefix)) return false
    
    const context = { source, minecraftUser: minecraftUser || '' }
    
    try {
      const handled = await commandManager.dispatch(this.bot, subArgs, context)
      return handled
    } catch (err) {
      this.log.error(`執行錯誤: ${err.message}`)
      if (source === 'minecraft-dm' && minecraftUser) this.bot.chat(`/m ${minecraftUser} &c執行錯誤: ${err.message}`)
      return true
    }
  }

  onMessage(jsonMsg) {
    const text = jsonMsg.toString().trim()
    if (!text) return

    if (!text.includes(this.HEART_SYMBOL)) {
        // 只有當前 bot 是 Console 焦點時才輸出？或全部輸出但帶前綴
        // 這裡選擇全部輸出但帶前綴
        console.log(`[${this.config.username}] ${text}`)
    }

    const directMsgMatch = text.match(/^\[(.+?)\s*->\s*我\]\s*(.+)$/)
    if (directMsgMatch) {
      const player = this.cleanPlayerName(directMsgMatch[1])
      const message = directMsgMatch[2].trim()
      if (this.getCleanWhitelist().includes(player)) {
        const parts = message.split(/\s+/)
        if (parts[0] && mapart.identifier.includes(parts[0].toLowerCase())) {
          if (this.mapartReady) {
            this.dispatchMapartCommand(parts, 'minecraft-dm', player)
          }
        }
        if (parts[0] === 'dropall') this.dropAll()
      }
    }
  }

  async onDeath() {
    await this.bot.waitForTicks(10)
    this.deathCount++
    this.log.info(`已死亡: ${this.deathCount} 次，正在嘗試 /back`)
    try { this.bot.chat('/back') } catch (e) { this.log.error(`Failed to send /back: ${e.message}`) }
  }

  onEnd(reason) {
    this.log.warn(`連線已中斷: ${reason}, 10秒後將重新連線...`)
    if (this.webServer) {
      this.webServer.stop()
      this.webServer = null
    }
    const delay = this.config.reconnectDelay || 10000
    setTimeout(() => this.start(), delay)
  }

  getCleanWhitelist() {
    return (this.config.whitelist || []).map(u => u.replace(/\s*\(.+?\)\s*/, '').trim())
  }

  cleanPlayerName(username) {
    return username.replace(/\s*\(.+?\)\s*/, '').trim()
  }

  async dropAll() {
    this.log.info('正在丟棄所有物品...')
    for (const item of this.bot.inventory.items()) {
      try { await this.bot.tossStack(item) } catch (e) {}
    }
    this.log.info('所有物品已丟棄完畢')
  }

  stop() {
    if (this.bot) {
        this.bot.end('Stopping bot');
    }
    if (this.webServer) {
        this.webServer.stop();
    }
  }
}

module.exports = BotInstance
