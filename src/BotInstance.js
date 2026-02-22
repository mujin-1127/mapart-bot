const mineflayer = require('mineflayer')
const path = require('path')
const fs = require('fs')
const ResourcePackHandler = require('./utils/ResourcePackHandler')
const mapart = require('./mapart')
const logger = require('../lib/logger')
const EntityIndexer = require('../lib/entityIndexer')
const commandManager = require('./commands/CommandManager')

class BotInstance {
  constructor(config, runtimeDataDir, configPath, webServer) {
    this.config = config
    this.id = config.id || config.username
    this.runtimeDataDir = runtimeDataDir
    this.configPath = configPath
    this.webServer = webServer
    this.bot = null
    this.status = 'offline' // offline, connecting, online
    this.mapartReady = false
    this.deathCount = 0
    this.entityIndexer = null
    this.log = logger.module('Main', this.id)
    this.HEART_SYMBOL = '❤'
    this.reconnectTimer = null

    // 初始註冊到 WebServer (即使尚未連線)
    if (this.webServer) {
      this.webServer.registerBot(this.id, this);
    }
  }

  buildBotOptions() {
    return {
      host: this.config.ip,
      port: this.config.port,
      username: this.config.username,
      auth: this.config.auth,
      version: this.config.version,
      hideErrors: true,
      profilesFolder: path.join(this.runtimeDataDir, '.minecraft'),
      onMsaCode: (data) => {
        console.log(`[MSA][${this.id}] 請於 ${data.verification_uri} 輸入代碼：${data.user_code}，有效期 ${Math.round(data.expires_in / 60)} 分鐘`)
        if (this.webServer) {
          this.webServer.io.emit('msa_code', { botId: this.id, ...data });
        }
      }
    }
  }

  async connect() {
    if (this.bot) return;
    
    this.log.info('正在嘗試連線至伺服器...');
    this.status = 'connecting';
    const opts = this.buildBotOptions()
    
    try {
      this.bot = mineflayer.createBot(opts)
      this.bot.bot_id = this.id
      this.mapartReady = false

      // 初始化資源包處理器
      const resourcePackHandler = new ResourcePackHandler(this.bot, { autoAccept: true, logPackets: true })
      resourcePackHandler.enable()

      // 掛載事件
      this.bot.on('spawn', async () => {
        this.status = 'online';
        this.log.info('機器人已進入遊戲');
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
      this.bot.on('error', (err) => this.log.error(`連線錯誤: ${err.message}`))
      this.bot.on('end', (reason) => this.onEnd(reason))
    } catch (e) {
      this.log.error(`啟動失敗: ${e.message}`);
      this.status = 'offline';
    }
  }

  disconnect() {
    this.status = 'offline';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.bot) {
      this.bot.end('User requested disconnect');
      this.bot = null;
    }
    this.log.info('已中斷連線');
  }

  onEnd(reason) {
    this.log.warn(`連線已中斷: ${reason}`);
    this.bot = null;
    if (this.status !== 'offline') {
      this.status = 'connecting';
      this.log.info('10秒後將嘗試自動重新連線...');
      this.reconnectTimer = setTimeout(() => this.connect(), this.config.reconnectDelay || 10000);
    }
  }

  // --- 其餘輔助函式 (initMapart, onMessage 等) 保持不變 ---
  async sendLobbyCommand() {
    try {
      const lobbyCmd = this.config.lobbyCommand || '/server lobby'
      this.bot.chat(lobbyCmd)
    } catch (e) {}
  }

  async initMapart() {
    const base = path.join(process.cwd(), 'config')
    const dirs = [path.join(base, this.id), path.join(base, 'global')]
    for (const dir of dirs) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) }
    try {
      await mapart.init(this.bot, this.id, this.log.log.bind(this.log))
      this.mapartReady = true
    } catch (e) { this.log.error(`Mapart 初始化失敗: ${e.message}`) }
  }

  async onCommandHandler(cmd) {
    const trimmed = (cmd || '').trim()
    if (!trimmed.length) return false
    if (trimmed.startsWith('.')) {
      const msg = trimmed.slice(1).trim()
      if (msg.length && this.bot) {
        try { this.bot.chat(msg) } catch (e) {}
      }
      return true
    }
    const parts = trimmed.split(/\s+/)
    if (mapart.identifier.includes(parts[0]?.toLowerCase())) {
      if (!this.mapartReady) { this.log.warn('Mapart 尚未就緒'); return true }
      const context = { source: 'web', minecraftUser: '' }
      return await commandManager.dispatch(this.bot, parts.slice(1), context)
    }

    // 3. 其他指令，直接視為 chat 指令 (自動加上 / 如果沒加的話)
    if (this.bot) {
      try {
        const finalCmd = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
        this.bot.chat(finalCmd)
      } catch (e) {
        this.log.error(`發送指令失敗: ${e.message}`)
      }
    }
    return true
  }

  onMessage(jsonMsg) {
    const text = jsonMsg.toString().trim()
    if (!text || text.includes(this.HEART_SYMBOL)) return
    console.log(`[${this.id}] ${text}`)
  }

  async onDeath() {
    if (!this.bot) return
    await this.bot.waitForTicks(10)
    this.deathCount++
    try { this.bot.chat('/back') } catch (e) {}
  }

  stop() {
    this.disconnect();
  }
}

module.exports = BotInstance
