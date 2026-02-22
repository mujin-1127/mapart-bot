const process = require('process');
const fs = require('fs');
const { Vec3 } = require('vec3');
const { readConfig, saveConfig } = require('../lib/utils');
const globalLogger = require('../lib/logger');
const commandManager = require('./commands/CommandManager');

const mapart = {
    identifier: ["mapart", "mp", "map"],
    cmd: [], // 舊指令列表，現在改用 CommandManager
    
    async init(bott, user_id, lg) {
        const bot = bott;
        const bot_id = user_id;
        bot.bot_id = bot_id; // 存入 bot 實例供指令使用
        const logger = lg || globalLogger.module('Mapart', bot_id).log.bind(globalLogger);
        const mcData = require('minecraft-data')(bot.version);

        // 預設地圖畫設定
        const default_mapart_cfg = {
            "schematic": {
                filename: "example_0_0.nbt",
                placementPoint_x: 0,
                placementPoint_y: 100,
                placementPoint_z: 0,
            },
            "workRegion": {
                "minX": 0,
                "minZ": 0,
                "maxX": 128,
                "maxZ": 128
            },
            "replaceMaterials": [],
            "materialsMode": "station",
            "station": "mpStation_Example.json",
            "open": {
                "folder": "暫時用不到",
                "warp": "Example_10",
                "height": 9,
                "width": 6,
                "open_start": -1,
                "open_end": -1,
            },
            "wrap": {
                "warp": "Example_10",
                "height": 9,
                "width": 6,
                "origin": [0, 0, 0],
                "anvil": [0, 0, 0],
                "anvil_stand": [0, 0, 0],
                "facing": "north",
                "cartography_table": [0, 0, 0],
                "cartography_table_stand": [0, 0, 0],
                "copy_f_shulker": [0, 0, 0],
                "copy_amount": 64,
                "wrap_input_shulker": [0, 0, 0],
                "wrap_output_shulker": [0, 0, 0],
                "wrap_button": [0, 0, 0],
            }
        };

        const mapart_global_cfg_default = {
            "discord_webhookURL": "https://discord.com/api/webhooks/1234567890123456789/abc",
            replaceMaterials: []
        };

        // 載入設定
        const botConfigPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        let mapart_cfg;
        if (!fs.existsSync(botConfigPath)) {
            mapart_cfg = default_mapart_cfg;
            await saveConfig(botConfigPath, mapart_cfg);
        } else {
            mapart_cfg = await readConfig(botConfigPath);
        }

        const globalConfigPath = `${process.cwd()}/config/global/mapart.json`;
        let mapart_global_cfg;
        if (!fs.existsSync(globalConfigPath)) {
            mapart_global_cfg = mapart_global_cfg_default;
            await saveConfig(globalConfigPath, mapart_global_cfg);
        } else {
            mapart_global_cfg = await readConfig(globalConfigPath);
        }

        // 將狀態儲存到 bot 實例中
        bot.mapartState = {
            cfg: mapart_cfg,
            global_cfg: mapart_global_cfg,
            mcData: mcData,
            logger: logger
        };

        // 註冊指令前綴 (全域單例，只需註冊一次，但重複註冊無傷大雅)
        commandManager.registerPrefix(this.identifier);

        // 註冊指令模組 (全域單例，只需註冊一次)
        // 為了避免重複註冊，這裡可以加個判斷，或者依賴 CommandManager 的 Set/Map 覆蓋
        commandManager.registerCommand(require('./commands/mapart/set'));
        commandManager.registerCommand(require('./commands/mapart/info'));
        commandManager.registerCommand(require('./commands/mapart/pause'));
        commandManager.registerCommand(require('./commands/mapart/resume'));
        commandManager.registerCommand(require('./commands/mapart/stop'));
        commandManager.registerCommand(require('./commands/mapart/build'));
        commandManager.registerCommand(require('./commands/mapart/open'));
        commandManager.registerCommand(require('./commands/mapart/debug'));
        commandManager.registerCommand(require('./commands/mapart/test'));
        commandManager.registerCommand(require('./commands/mapart/name'));
        commandManager.registerCommand(require('./commands/mapart/copy'));
        commandManager.registerCommand(require('./commands/mapart/wrap'));
        commandManager.registerCommand(require('./commands/mapart/drop'));
        commandManager.registerCommand(require('./commands/mapart/tp'));
        
        logger(true, 'INFO', `Mapart module initialized for bot ${bot_id}`);
    }
};

module.exports = mapart;
