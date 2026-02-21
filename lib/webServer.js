const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
// 移除靜態 require，改用動態匯入
const logger = require('./logger').module('WebServer');
const { readConfig, saveConfig } = require('./utils');

class WebServer {
    constructor(bot, port = 3000) {
        this.bot = bot;
        this.port = port;
        this.app = express();
        this.server = http.createServer(this.app);
        
        // 自定義指令處理器
        this.onCommandHandler = null;
        
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

        // API: 檔案列表 (自訂 UI 使用)
        this.app.get('/api/utils/list-files', async (req, res) => {
            const currentDir = req.query.path || process.cwd();
            try {
                const items = await fs.readdir(currentDir, { withFileTypes: true });
                const result = items.map(item => ({
                    name: item.name,
                    isDirectory: item.isDirectory(),
                    fullPath: path.resolve(currentDir, item.name)
                })).filter(item => {
                    // 只顯示資料夾或 .nbt 檔案
                    return item.isDirectory || item.name.endsWith('.nbt');
                }).sort((a, b) => {
                    // 資料夾排在前面
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });

                res.json({
                    currentDir: path.resolve(currentDir),
                    parentDir: path.dirname(path.resolve(currentDir)),
                    items: result
                });
            } catch (err) {
                logger.error(`讀取目錄失敗: ${err.message}`);
                res.status(500).json({ error: '無法讀取目錄: ' + err.message });
            }
        });

        // API: 檔案選擇器 (原生 OS，保留作為備援或未來參考)
        this.app.get('/api/utils/select-file', (req, res) => {
            logger.info('[WebServer] 正在呼叫原生檔案選擇器...');
            // ... (keep the existing native picker code if needed, but the user wants the custom one)
            // 使用 Base64 編碼發送指令給 PowerShell，避免字元轉義與編碼問題
            const psCommand = `
                Add-Type -AssemblyName System.Windows.Forms;
                $f = New-Object System.Windows.Forms.OpenFileDialog;
                $f.Filter = 'NBT files (*.nbt)|*.nbt|All files (*.*)|*.*';
                $f.Title = '請選擇地圖畫投影檔 (.nbt)';
                $res = $f.ShowDialog();
                if ($res -eq 'OK') { $f.FileName } else { '' }
            `.trim();

            // PowerShell 的 EncodedCommand 需要 UTF-16LE 編碼
            const encodedCommand = Buffer.from(psCommand, 'utf16le').toString('base64');

            exec(`powershell -NoProfile -EncodedCommand ${encodedCommand}`, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`[WebServer] 呼叫原生選擇器失敗: ${error.message}`);
                    return res.status(500).json({ error: '無法開啟檔案選擇器' });
                }
                const selectedPath = stdout.trim();
                logger.info(`[WebServer] 原生選擇器返回路徑: ${selectedPath || '(未選擇)'}`);
                res.json({ path: selectedPath || null });
            });
        });

        // Socket.io: 連線處理
        this.io.on('connection', (socket) => {
            console.log(`[WebServer] 新的 Socket 連線: ${socket.id} (來自 ${socket.handshake.address})`);
            logger.info(`網頁控制端已連線: ${socket.id}`);
            
            // 立即發送一次狀態
            socket.emit('status', this.getBotStatus());

            // 處理前端指令
            socket.on('command', async (cmd) => {
                logger.info(`收到網頁指令: ${cmd}`);
                
                // 如果有註冊處理器，先交給處理器
                if (this.onCommandHandler) {
                    const handled = await this.onCommandHandler(cmd);
                    if (handled) return;
                }
                
                // 否則當作一般聊天發送
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

    stop() {
        if (this.server) {
            this.server.close();
            logger.info('網頁伺服器已關閉');
        }
        if (this.io) {
            this.io.close();
        }
    }
}

module.exports = WebServer;
