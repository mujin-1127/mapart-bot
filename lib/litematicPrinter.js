const { sleep, readConfig, saveConfig, v, hashConfig, promiseWithTimeout } = require('../lib/utils');
const globalLogger = require('../lib/logger');
const printerManager = require('./printers'); // 自動註冊所有 printer
const fs = require('fs');

const litematicPrinter = {
    model_mapart: 'mapart',
    model_redstone: 'redstone',
    model_building: 'building',

    /**
     * 初始化 bot 的 printer 狀態
     */
    initBot(bot) {
        if (!bot._litematicState) {
            bot._litematicState = {
                pause: false,
                stop: false,
                build_cache: {
                    hash: "",
                }
            };
        }
    },

    build_file: async function (task, bot, model, cfg) {
        const fullPath = cfg.schematic.filename; // 現在 filename 直接存完整路徑
        if (!fs.existsSync(fullPath)) {
            console.log(`&7[&LP&7] &c未發現投影 &7${fullPath} &r請檢查路徑`);
            return;
        }
        
        this.initBot(bot);
        bot._litematicState.stop = false; // 重置狀態
        return await this.execute(task, bot, model, cfg);
    },

    build_project: async function (task, bot, model, cfg, project) {
        this.initBot(bot);
        bot._litematicState.stop = false; // 重置狀態
        return await this.execute(task, bot, model, cfg, project);
    },

    async execute(task, bot, model, cfg, project = null) {
        this.initBot(bot);
        const state = bot._litematicState;
        
        const sharedState = {
            get pause() { return state.pause; },
            get stop() { return state.stop; },
            get build_cache() { return state.build_cache; },
            set build_cache(val) { state.build_cache = val; }
        };
        bot.sharedState = sharedState; // 導出給 WebServer 使用

        try {
            const result = await printerManager.executeBuild(model, task, bot, cfg, project, sharedState);
            return result;
        } catch (error) {
            const logger = globalLogger.module('Printer', bot.username);
            logger.error(`建造過程中出錯 (${model}): ${error.message}`);
            throw error;
        }
    },

    progress_query: async function (task, bot) {
        this.initBot(bot);
        return bot._litematicState.build_cache;
    },

    pause: function (bot, p = true) {
        this.initBot(bot);
        bot._litematicState.pause = p;
    },

    resume: function (bot) {
        this.initBot(bot);
        bot._litematicState.pause = false;
    },

    stop: function (bot) {
        this.initBot(bot);
        bot._litematicState.stop = true;
    }
};

module.exports = litematicPrinter;
