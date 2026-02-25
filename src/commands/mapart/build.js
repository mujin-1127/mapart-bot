const { readConfig, saveConfig, taskreply, sleep, clearInventory, checkStop } = require('../../../lib/utils');
const litematicPrinter = require('../../../lib/litematicPrinter');
const { WebhookClient } = require('discord.js');
const fs = require('fs');
const logger = require('../../../lib/logger').module('Mapart-Build');

module.exports = {
    name: "地圖畫 建造",
    identifier: ["build", "b"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        
        let mapart_build_cfg_cache;
        let mapart_global_cfg;
        try {
            mapart_build_cfg_cache = await readConfig(configPath);
            mapart_global_cfg = mapart_build_cfg_cache; 
        } catch (e) {
            logger.error(`讀取設定檔失敗: ${e.message}`);
            return;
        }

        const botIds = mapart_build_cfg_cache.botIds || [];
        const workerIndex = botIds.indexOf(bot_id);
        
        if (workerIndex === -1) {
            logger.error(`目前機器人 (${bot_id}) 不在被指派的任務名單內！`);
            return;
        }
        
        mapart_build_cfg_cache.worker_id = workerIndex;
        mapart_build_cfg_cache.worker_count = botIds.length;
        mapart_build_cfg_cache.bot_id = bot_id;

        if (bot.sharedState && bot.sharedState.build_cache) {
            bot.sharedState.build_cache.currentAction = "正在建造...";
        }
        
        const stationFile = mapart_build_cfg_cache?.station || 'station.json';
        
        try {
            const stationConfig = await readConfig(`${process.cwd()}/config/global/${stationFile}`);
            if (stationConfig && stationConfig.offset) {
                mapart_build_cfg_cache.offset = stationConfig.offset;
            }
        } catch(e) {
            logger.warn(`無法讀取材料站設定檔 ${stationFile}: ${e.message}`);
        }
        
        mapart_build_cfg_cache.replaceMaterials = mapart_build_cfg_cache.replaceMaterials || [];

        delete mapart_build_cfg_cache.open;
        delete mapart_build_cfg_cache.wrap;

        let FLAG_disableWebHookNotification = false;
        for (let i = 0; i < task.content.length; i++) {
            if (task.content[i] === '-n') FLAG_disableWebHookNotification = true;
        }

        // --- 建造前清理背包 ---
        await clearInventory(bot, logger);

        try {
            await litematicPrinter.build_file(task, bot, litematicPrinter.model_mapart, mapart_build_cfg_cache);
        } catch (e) {
            logger.error(`建造過程發生錯誤: ${e.message}`);
            return;
        }
        
        let build_result_query;
        try {
            build_result_query = await litematicPrinter.progress_query(task, bot);
        } catch (e) {
            logger.error(`查詢進度失敗: ${e.message}`);
            return;
        }
        const mapartBuildUseTime = (build_result_query.endTime - build_result_query.startTime) / 1000;
        logger.info(`消耗時間 ${parseInt((mapartBuildUseTime / 3600))} h ${parseInt((mapartBuildUseTime % 3600) / 60)} m ${parseInt(mapartBuildUseTime % 60)} s`);

        // Discord Webhook
        let webhookClient = null;
        const webhookURL = (mapart_global_cfg.discord_webhookURL || '').trim();
        if (webhookURL && webhookURL.startsWith('https://discord.com/api/webhooks/')) {
            try { webhookClient = new WebhookClient({ url: webhookURL }); } catch (e) { }
        }

        if (!FLAG_disableWebHookNotification && webhookClient) {
            const embed = gen_mapartFinishEmbed(bot, mapart_build_cfg_cache, build_result_query, mapartBuildUseTime);
            webhookClient.send({
                username: bot.username,
                avatarURL: `https://mc-heads.net/avatar/${bot.username}`,
                embeds: [embed]
            }).catch(e => logger.error(`Webhook 發送失敗: ${e.message}`));
        }

        // --- 核心：全員完成後的鏈條邏輯 ---
        const webServer = bot.centralWebServer;
        let allBotsFinished = true;

        if (webServer) {
            for (const id of botIds) {
                const instance = webServer.botInstances.get(id);
                let bc = instance?.bot?.sharedState?.build_cache || instance?.sharedState?.build_cache;
                if (!bc || bc.endTime === -1) {
                    allBotsFinished = false;
                    logger.info(`[AutoNext] 等待其他機器人完成: ${id} 尚未結束`);
                    break;
                }
            }
        } else {
            if (workerIndex !== 0) allBotsFinished = false;
        }

        if (allBotsFinished) {
            // 延遲一下確保全體狀態已寫入 WebServer
            setTimeout(async () => {
                // 再次檢查自己是否已被停止
                if (checkStop(bot, logger)) return;

                // 防止重複觸發 (利用全域鎖)
                const lockKey = `autosave_lock_${mapart_global_cfg.task_group_id || 'default'}`;
                if (webServer && webServer.globalMapartCfg) {
                    if (webServer.globalMapartCfg[lockKey]) return;
                    webServer.globalMapartCfg[lockKey] = true;
                    // 60 秒後自動解鎖，避免卡死
                    setTimeout(() => { if (webServer.globalMapartCfg) delete webServer.globalMapartCfg[lockKey]; }, 60000);
                }

                if (mapart_global_cfg.save && mapart_global_cfg.save.autoSaveAfterBuild) {
                    logger.info(`[AutoNext] 檢測到全體建造完成，啟動自動存圖流程 (執行者: ${bot_id})...`);
                    const cmdMgr = require('../CommandManager');
                    cmdMgr.dispatch(bot, ["save"], { source: task.source });
                } else {
                    // 無論 autoNext 是否開啟，都進入 tryTriggerNextTask 處理佇列清理
                    logger.info(`[AutoNext] 檢測到全體建造完成，處理任務佇列...`);
                    const { tryTriggerNextTask } = require('./clear');
                    await tryTriggerNextTask(bot, task.source);
                }
            }, 5000);
        }
    }
};

function gen_mapartFinishEmbed(bot, cfg, result, useTime) {
    let iconurl = `https://mc-heads.net/avatar/${bot.username}`;
    return {
        color: 0x0099ff,
        title: `${cfg.schematic.filename.split(/[\\/]/).pop()} 建造完成`,
        author: { name: bot.username, icon_url: iconurl },
        thumbnail: { url: iconurl },
        fields: [
            { name: 'Placement Origin', value: `X:\`${result.placement_origin.x}\` Y:\`${result.placement_origin.y}\` Z:\`${result.placement_origin.z}\`` },
            { name: '消耗時間', value: `${parseInt((useTime / 3600))} h ${parseInt((useTime % 3600) / 60)} m ${parseInt(useTime % 60)} s`, inline: true },
            { name: 'Speed', value: `${Math.round((result.totalBlocks / (useTime / 3600)) * 10) / 10} Blocks / h`, inline: true }
        ]
    };
}
