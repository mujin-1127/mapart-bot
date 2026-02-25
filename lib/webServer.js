const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const { existsSync } = require('fs');
const EventEmitter = require('events');
const logger = require('./logger').module('WebServer');
const { readConfig, saveConfig } = require('./utils');

class WebServer extends EventEmitter {
    constructor(port = 3000, configPath = '') {
        super();
        this.port = port;
        this.configPath = configPath || path.join(process.cwd(), 'config.json');
        this.botInstances = new Map(); // key: botId, value: BotInstance
        
        this.app = express();
        this.server = http.createServer(this.app);
        this.io = new Server(this.server, {
            cors: { origin: "*", methods: ["GET", "POST"] },
            transports: ['websocket', 'polling']
        });
        
        this.connectionQueue = []; // 機器人連線佇列
        this.isProcessingQueue = false; // 是否正在處理連線中
        this.connectionDelay = 5000; // 兩次連線之間的最小間隔 (5秒)
        
        this.setup();
    }

    /**
     * 處理機器人連線佇列
     */
    async processConnectionQueue() {
        if (this.isProcessingQueue || this.connectionQueue.length === 0) return;
        this.isProcessingQueue = true;

        while (this.connectionQueue.length > 0) {
            const { botId, exclusive } = this.connectionQueue.shift();
            const instance = this.botInstances.get(botId);
            
            if (instance) {
                logger.info(`[連線佇列] 正在啟動機器人: ${botId} (剩餘等待: ${this.connectionQueue.length})`);
                
                if (exclusive) {
                    for (const [id, inst] of this.botInstances) {
                        if (id !== botId) inst.disconnect();
                    }
                }
                
                await instance.connect();
                
                // 如果佇列中還有下一個，則等待一段時間
                if (this.connectionQueue.length > 0) {
                    logger.info(`[連線佇列] 等待 ${this.connectionDelay / 1000} 秒後再啟動下一個...`);
                    const { sleep } = require('./utils');
                    await sleep(this.connectionDelay);
                }
            }
        }

        this.isProcessingQueue = false;
    }

    registerBot(botId, instance) {
        this.botInstances.set(botId, instance);
        logger.info(`機器人 ${botId} 已在面板就緒 (狀態: ${instance.status})`);
    }

    unregisterBot(botId) {
        this.botInstances.delete(botId);
    }

    setup() {
        const publicPath = path.join(__dirname, '../src/gui/public');
        this.app.use(express.static(publicPath));
        this.app.use(express.json());

        // 讀取初始的全域設定
        try {
            const globalPath = path.join(process.cwd(), 'config', 'global', 'mapart.json');
            if (existsSync(globalPath)) {
                this.globalMapartCfg = require(globalPath);
            }
        } catch(e) { this.globalMapartCfg = {}; }

        this.app.get('/api/bots', (req, res) => res.json(Array.from(this.botInstances.keys())));
        this.app.get('/api/accounts', async (req, res) => {
            try { res.json((await readConfig(this.configPath)).bots || []); } catch (e) { res.status(500).send(e.message); }
        });
        this.app.post('/api/accounts', async (req, res) => {
            try {
                const cfg = await readConfig(this.configPath);
                cfg.bots = req.body;
                await saveConfig(this.configPath, cfg);
                this.emit('reload-bots');
                res.json({ success: true });
            } catch (e) { res.status(500).send(e.message); }
        });

        this.app.get('/api/global/config/:type', async (req, res) => {
            const { type } = req.params;
            const file = path.join(process.cwd(), 'config/global', `${type}.json`);
            if (!existsSync(file)) return res.json({});
            try { res.json(await readConfig(file)); } catch (e) { res.json({ error: e.message }); }
        });

        this.app.post('/api/global/config/:type', async (req, res) => {
            const { type } = req.params;
            const file = path.join(process.cwd(), 'config/global', `${type}.json`);
            try { await saveConfig(file, req.body); res.json({ success: true }); } catch (e) { res.status(500).send(e.message); }
        });

        this.app.get('/api/utils/list-files', async (req, res) => {
            const dir = req.query.path || process.cwd();
            try {
                const items = await fs.readdir(dir, { withFileTypes: true });
                const result = items.map(i => ({ name: i.name, isDirectory: i.isDirectory(), fullPath: path.resolve(dir, i.name) }))
                    .filter(i => i.isDirectory || i.name.endsWith('.nbt'))
                    .sort((a, b) => b.isDirectory - a.isDirectory || a.name.localeCompare(b.name));
                res.json({ currentDir: path.resolve(dir), parentDir: path.dirname(path.resolve(dir)), items: result });
            } catch (e) { res.status(500).send(e.message); }
        });

        this.io.on('connection', (socket) => {
            socket.on('command', async ({ botId, cmd }) => {
                const instance = this.botInstances.get(botId);
                if (instance) instance.onCommandHandler(cmd);
            });

            socket.on('start_bot', ({ botId, exclusive }) => {
                // 檢查是否已經在佇列中，避免重複點擊
                if (this.connectionQueue.some(q => q.botId === botId)) {
                    logger.warn(`機器人 ${botId} 已經在連線佇列中，跳過。`);
                    return;
                }
                
                const instance = this.botInstances.get(botId);
                if (instance && instance.status === 'online') {
                    logger.warn(`機器人 ${botId} 已在線，跳過。`);
                    return;
                }

                this.connectionQueue.push({ botId, exclusive });
                logger.info(`機器人 ${botId} 已加入連線佇列，目前順位: ${this.connectionQueue.length}`);
                this.processConnectionQueue();
            });

            socket.on('stop_bot', ({ botId }) => {
                const instance = this.botInstances.get(botId);
                if (instance) instance.disconnect();
            });

            // 部署投影任務：自動儲存設定給所有選中機器人 (改為全域範圍 + 序號分工)
            socket.on('deploy_task', async ({ filename, pos, region, replaceMaterials, botIds }) => {
                // 儲存為全域的佈署設定
                try {
                    const globalDir = path.join(process.cwd(), 'config', 'global');
                    if (!existsSync(globalDir)) await fs.mkdir(globalDir, { recursive: true });
                    
                    const configPath = path.join(globalDir, 'mapart.json');
                    let globalCfg = {};
                    if (existsSync(configPath)) {
                        globalCfg = JSON.parse(await fs.readFile(configPath, 'utf8'));
                    }
                    
                    globalCfg.schematic = {
                        filename: filename,
                        placementPoint_x: pos.x,
                        placementPoint_y: pos.y,
                        placementPoint_z: pos.z
                    };
                    globalCfg.workRegion = region;
                    globalCfg.replaceMaterials = replaceMaterials;
                    globalCfg.botIds = botIds;
                    globalCfg.materialsMode = globalCfg.materialsMode || "station";
                    globalCfg.station = globalCfg.station || "station.json";
                    
                    await saveConfig(configPath, globalCfg);
                    this.globalMapartCfg = globalCfg; // 更新內存全域設定
                    
                    // 更新內存狀態
                    for (const [id, inst] of this.botInstances) {
                        if (inst.bot && inst.bot.mapartState) {
                            inst.bot.mapartState.cfg = globalCfg;
                        }
                        if (botIds.includes(id)) {
                            // 清空在線機器的緩存
                            if (inst.bot && inst.bot.sharedState) {
                                inst.bot.sharedState.build_cache = { hash: "" };
                            }
                            // 即使離線也清空實例層級緩存
                            if (inst.sharedState) {
                                inst.sharedState.build_cache = { hash: "" };
                            }
                            // 刪除硬碟上的舊緩存
                            const oldCachePath = path.join(process.cwd(), 'config', id, 'build_cache.json');
                            fs.unlink(oldCachePath).catch(() => {});
                            
                            logger.info(`已部署任務給 ${id} (區域 X: ${region.minX}~${region.maxX})`);
                        }
                    }
                } catch(e) { logger.error(`儲存全域任務設定失敗: ${e.message}`); }
            });
        });

        setInterval(() => {
            const allStatus = {};
            for (const [botId, inst] of this.botInstances) allStatus[botId] = this.getBotStatus(inst);
            this.io.emit('all_status', allStatus);
        }, 1000);
    }

    getBotStatus(instance) {
        const bot = instance.bot;
        // 優先從 online bot 獲取進度，若離線則從 instance 的 sharedState 獲取 (已在啟動時載入)
        let bc = null;
        if (bot && bot.mapartState && bot.mapartState.cfg) {
            bc = { schematic: bot.mapartState.cfg.schematic, ...(bot.sharedState?.build_cache || {}) };
        } else if (bot && bot.sharedState) {
            bc = bot.sharedState.build_cache;
        } else {
            bc = instance.sharedState?.build_cache || null;
        }
        
        let isAssigned = false;
        // 若該機器人在全域任務的派發名單中，即使離線也能顯示預期的任務檔案名稱
        if (this.globalMapartCfg && this.globalMapartCfg.botIds && this.globalMapartCfg.botIds.includes(instance.id)) {
            isAssigned = true;
            if (!bc) bc = {};
            if (!bc.schematic && this.globalMapartCfg.schematic) {
                bc.schematic = this.globalMapartCfg.schematic;
            }
        }
        
        const base = { 
            id: instance.id, 
            status: instance.status, 
            online: !!(bot && bot.entity),
            build_cache: bc,
            isAssigned: isAssigned
        };
        if (!base.online) return base;
        return {
            ...base,
            username: bot.username,
            pos: bot.entity.position,
            health: bot.health,
            food: bot.food,
            inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count }))
        };
    }

    start() {
        this.server.listen(this.port, async () => {
            logger.info(`中央控制面板已啟動: http://localhost:${this.port}`);
        });
    }

    stop() {
        if (this.server) this.server.close();
    }
}

module.exports = WebServer;
