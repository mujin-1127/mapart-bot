const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
// 移除靜態 require，改用動態匯入
const logger = require('./logger').module('WebServer');
const { readConfig, saveConfig } = require('./utils');

class WebServer {
    constructor(bot, port = 3000) {
        this.bot = bot;
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        
        // 在構造時就傳入 CORS 配置，確保握手階段正確
        this.io = new Server(this.server, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"]
            },
            transports: ['websocket', 'polling'] // 顯式定義支援的傳輸協定
        });
        
        this.setup();
    }

    setup() {
        // 靜態檔案目錄 (前端介面)
        const publicPath = path.join(__dirname, '../src/gui/public');
        this.app.use(express.static(publicPath));
        this.app.use(express.json());

        // API: 基本資訊
        this.app.get('/api/status', (req, res) => {
            res.json(this.getBotStatus());
        });

        // API: 讀取設定檔
        this.app.get('/api/config/:type', async (req, res) => {
            const { type } = req.params;
            let filePath;
            try {
                if (type === 'mapart') {
                    filePath = path.join(process.cwd(), 'config/global/mapart.json');
                } else if (type === 'station') {
                    filePath = path.join(process.cwd(), 'config/global/station_01.json');
                } else if (type === 'bot') {
                    const bot_id = this.bot.bot_id || this.bot.username;
                    if (!bot_id) throw new Error('機器人尚未就緒，無法取得 ID');
                    filePath = path.join(process.cwd(), 'config', bot_id, 'mapart.json');
                }

                if (!filePath) return res.status(400).json({ error: '無效的設定類型' });

                const data = await readConfig(filePath);
                res.json(data);
            } catch (err) {
                logger.error(`讀取設定 API 出錯 (${type}): ${err.message}`);
                res.status(500).json({ error: err.message });
            }
        });

        // API: 儲存設定檔
        this.app.post('/api/config/:type', async (req, res) => {
            const { type } = req.params;
            let filePath;
            if (type === 'mapart') {
                filePath = path.join(process.cwd(), 'config/global/mapart.json');
            } else if (type === 'station') {
                filePath = path.join(process.cwd(), 'config/global/station_01.json');
            } else if (type === 'bot') {
                const bot_id = this.bot.bot_id || this.bot.username;
                filePath = path.join(process.cwd(), 'config', bot_id, 'mapart.json');
            }

            if (!filePath) return res.status(400).json({ error: '無效的設定類型' });

            try {
                await saveConfig(filePath, req.body);
                logger.info(`已更新設定檔: ${filePath}`);
                res.json({ success: true });
            } catch (err) {
                res.status(500).json({ error: err.message });
            }
        });

        // Socket.io: 連線處理
        this.io.on('connection', (socket) => {
            console.log(`[WebServer] 新的 Socket 連線: ${socket.id} (來自 ${socket.handshake.address})`);
            logger.info(`網頁控制端已連線: ${socket.id}`);
            
            // 立即發送一次狀態
            socket.emit('status', this.getBotStatus());

            // 處理前端指令
            socket.on('command', (cmd) => {
                logger.info(`收到網頁指令: ${cmd}`);
                this.bot.chat(cmd);
            });

            socket.on('disconnect', () => {
                logger.info('網頁控制端已斷開');
            });
        });

        // 定期推播狀態 (每秒一次)
        setInterval(() => {
            // 移除 this.bot.entity 檢查，讓離線狀態也能推播
            this.io.emit('status', this.getBotStatus());
        }, 1000);

        // 攔截控制台日誌 (可選，讓網頁也能看到日誌)
        // 這裡可以考慮串接 logger.js 的 transport
    }

    getBotStatus() {
        if (!this.bot || !this.bot.entity) return { online: false };

        const items = this.bot.inventory.items().map(item => ({
            name: item.name,
            count: item.count,
            displayName: item.displayName
        }));

        return {
            online: true,
            username: this.bot.username,
            pos: this.bot.entity.position,
            health: this.bot.health,
            food: this.bot.food,
            inventory: items,
            // 可以在這裡加入地圖畫進度
            build_cache: this.bot.sharedState?.build_cache || null
        };
    }

    start() {
        this.server.listen(this.port, async () => {
            const url = `http://localhost:${this.port}`;
            logger.info(`網頁控制面板啟動於: ${url}`);
            
            // 使用動態 import 解決 ESM 報錯問題
            try {
                const open = (await import('open')).default;
                await open(url);
            } catch (err) {
                logger.warn(`自動開啟瀏覽器失敗: ${err.message}`);
                logger.info(`請手動開啟瀏覽器並輸入: ${url}`);
            }
        });
    }
}

module.exports = WebServer;
