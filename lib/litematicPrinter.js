const { sleep, readConfig, saveConfig, v, hashConfig, promiseWithTimeout } = require('../lib/utils');
const globalLogger = require('../lib/logger');
const printerManager = require('./printers'); // 自動註冊所有 printer
const fs = require('fs');

let pause = false, stop = false;
let build_cache = {
    hash: "",
};

const litematicPrinter = {
    model_mapart: 'mapart',
    model_redstone: 'redstone',
    model_building: 'building',

    build_file: async function (task, bot, model, cfg) {
        const fullPath = cfg.schematic.filename; // 現在 filename 直接存完整路徑
        if (!fs.existsSync(fullPath)) {
            console.log(`&7[&LP&7] &c未發現投影 &7${fullPath} &r請檢查路徑`);
            return;
        }
        
        stop = false; // 重置狀態
        return await this.execute(task, bot, model, cfg);
    },

    build_project: async function (task, bot, model, cfg, project) {
        stop = false; // 重置狀態
        return await this.execute(task, bot, model, cfg, project);
    },

    async execute(task, bot, model, cfg, project = null) {
        const sharedState = {
            get pause() { return pause; },
            get stop() { return stop; },
            build_cache: build_cache
        };
        bot.sharedState = sharedState; // 導出給 WebServer 使用

        try {
            const result = await printerManager.executeBuild(model, task, bot, cfg, project, sharedState);
            build_cache = sharedState.build_cache; // 更新快取
            return result;
        } catch (error) {
            const logger = globalLogger.module('Printer');
            logger.error(`建造過程中出錯 (${model}): ${error.message}`);
            throw error;
        }
    },

    progress_query: async function (task, bot) {
        return build_cache;
    },

    pause: function (p = true) {
        pause = p;
    },

    resume: function () {
        pause = false;
    },

    stop: function (task) {
        stop = true;
    }
};

module.exports = litematicPrinter;
