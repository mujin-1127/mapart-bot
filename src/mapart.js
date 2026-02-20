const process = require('process');
const fs = require('fs');
const { Vec3 } = require('vec3');
const { readConfig, saveConfig } = require('../lib/utils');
const globalLogger = require('../lib/logger');
const commandManager = require('./commands/CommandManager');

let logger, mcData, bot_id, bot;

// 預設地圖畫設定
let mapart_cfg = {
    "schematic": {
        filename: "example_0_0.nbt",
        placementPoint_x: 0,
        placementPoint_y: 100,
        placementPoint_z: 0,
    },
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

let mapart_global_cfg = {
    "schematic_folder": "C:\\Users\\User\\AppData\\Roaming\\.minecraft\\schematics\\",
    "discord_webhookURL": "https://discord.com/api/webhooks/1234567890123456789/abc",
    replaceMaterials: []
};

const mapart = {
    identifier: ["mapart", "mp", "map"],
    cmd: [], // 舊指令列表，現在改用 CommandManager
    
    async init(bott, user_id, lg) {
        logger = lg || globalLogger.module('Mapart').log.bind(globalLogger);
        bot_id = user_id;
        bot = bott;
        bot.bot_id = bot_id; // 存入 bot 實例供指令使用
        mcData = require('minecraft-data')(bot.version);

        // 載入設定
        const botConfigPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        if (!fs.existsSync(botConfigPath)) {
            await saveConfig(botConfigPath, mapart_cfg);
        } else {
            mapart_cfg = await readConfig(botConfigPath);
        }

        const globalConfigPath = `${process.cwd()}/config/global/mapart.json`;
        if (!fs.existsSync(globalConfigPath)) {
            await saveConfig(globalConfigPath, mapart_global_cfg);
        } else {
            mapart_global_cfg = await readConfig(globalConfigPath);
        }

        // 註冊指令前綴
        commandManager.registerPrefix(this.identifier);

        // 註冊指令模組
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
        
        logger(true, 'INFO', 'Mapart module initialized with CommandManager');
    }
};

module.exports = mapart;
