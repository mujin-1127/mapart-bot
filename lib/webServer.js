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
        
        this.setup();
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

        this.app.get('/api/:botId/config/:type', async (req, res) => {
            const { botId, type } = req.params;
            const file = type === 'bot' ? path.join(process.cwd(), 'config', botId, 'mapart.json') : path.join(process.cwd(), 'config/global', `${type}.json`);
            if (!existsSync(file)) return res.json({});
            try { res.json(await readConfig(file)); } catch (e) { res.json({ error: e.message }); }
        });

        this.app.post('/api/:botId/config/:type', async (req, res) => {
            const { botId, type } = req.params;
            const file = type === 'bot' ? path.join(process.cwd(), 'config', botId, 'mapart.json') : path.join(process.cwd(), 'config/global', `${type}.json`);
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
                if (exclusive) {
                    for (const [id, inst] of this.botInstances) {
                        if (id !== botId) inst.disconnect();
                    }
                }
                const instance = this.botInstances.get(botId);
                if (instance) instance.connect();
            });

            socket.on('stop_bot', ({ botId }) => {
                const instance = this.botInstances.get(botId);
                if (instance) instance.disconnect();
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
        const base = { id: instance.id, status: instance.status, online: !!(bot && bot.entity) };
        if (!base.online) return base;
        return {
            ...base,
            username: bot.username,
            pos: bot.entity.position,
            health: bot.health,
            food: bot.food,
            inventory: bot.inventory.items().map(i => ({ name: i.name, count: i.count })),
            build_cache: bot.sharedState?.build_cache || null
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
