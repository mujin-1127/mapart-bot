const { readConfig, saveConfig, taskreply } = require('../../../lib/utils');
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
            // 現在統一讀取全域 mapart.json
            mapart_build_cfg_cache = await readConfig(configPath);
            mapart_global_cfg = mapart_build_cfg_cache; 
        } catch (e) {
            logger.error(`讀取設定檔失敗: ${e.message}`);
            return;
        }

        // 動態計算 worker_id 與 worker_count
        const botIds = mapart_build_cfg_cache.botIds || [];
        const workerIndex = botIds.indexOf(bot_id);
        
        if (workerIndex === -1) {
            logger.error(`目前機器人 (${bot_id}) 不在被指派的任務名單內！`);
            return;
        }
        
        mapart_build_cfg_cache.worker_id = workerIndex;
        mapart_build_cfg_cache.worker_count = botIds.length;
        mapart_build_cfg_cache.bot_id = bot_id;
        
        const stationFile = mapart_build_cfg_cache?.station || 'station.json';
        
        // 將材料站的資料合併進 mapart_build_cfg_cache
        try {
            const stationConfig = await readConfig(`${process.cwd()}/config/global/${stationFile}`);
            if (stationConfig && stationConfig.offset) {
                mapart_build_cfg_cache.offset = stationConfig.offset;
            }
        } catch(e) {
            logger.warn(`無法讀取材料站設定檔 ${stationFile}: ${e.message}`);
        }
        
        // 替換材料已經在全域設定裡，直接使用
        mapart_build_cfg_cache.replaceMaterials = mapart_build_cfg_cache.replaceMaterials || [];

        delete mapart_build_cfg_cache.open;
        delete mapart_build_cfg_cache.wrap;

        // Flag parse
        let FLAG_autonext = false;
        let FLAG_autonext_value = '';
        let FLAG_disableWebHookNotification = false;
        let auto_regex = /^(\d+)_(\d+)$/;
        
        for (let i = 0; i < task.content.length; i++) {
            if (!task.content[i].startsWith('-')) continue;
            switch (task.content[i]) {
                case '-a':
                case '-auto':
                    FLAG_autonext = true;
                    const match = task.content[i + 1]?.match(auto_regex);
                    if (match) {
                        FLAG_autonext_value = task.content[i + 1];
                        i++;
                    }
                    break;
                case '-n':
                    FLAG_disableWebHookNotification = true;
                    break;
                default:
                    break;
            }
        }

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

        // Webhook and Auto-next logic
        const f_reg = /_(\d+)_(\d+)$/;
        let crt_filename_sp = mapart_build_cfg_cache.schematic.filename.split(".");
        let crt_filename = crt_filename_sp[0];
        const crt_filename_type = crt_filename_sp[1];
        let crt_filename_match = crt_filename.match(f_reg);
        crt_filename = crt_filename.replace(/_\d+_\d+$/, '');
        
        let crtFileIndex;
        if (crt_filename_match) {
            crtFileIndex = [parseInt(crt_filename_match[1]), parseInt(crt_filename_match[2])];
        }

        let webhookClient = null;
        const webhookURL = (mapart_global_cfg.discord_webhookURL || '').trim();
        if (webhookURL && webhookURL.startsWith('https://discord.com/api/webhooks/')) {
            try { webhookClient = new WebhookClient({ url: webhookURL }); } catch (e) { /* 無效 URL */ }
        }

        if (!FLAG_disableWebHookNotification && webhookClient) {
            const embed = gen_mapartFinishEmbed(bot, mapart_build_cfg_cache, build_result_query, mapartBuildUseTime);
            let wh = {
                username: bot.username,
                avatarURL: `https://mc-heads.net/avatar/${bot.username}`,
                embeds: [embed]
            };
            
            if (bot.debugMode) {
                // ... debug info logic ...
            }
            
            webhookClient.send(wh).catch(e => logger.error(`Webhook 發送失敗: ${e.message}`));
        }

        if (FLAG_autonext) {
            let nextIndex = [crtFileIndex[0], crtFileIndex[1]];
            let inc = [1, 0];
            if (FLAG_autonext_value) {
                const sp = FLAG_autonext_value.split("_");
                if (sp.length === 2) {
                    inc[0] = parseInt(sp[0]);
                    inc[1] = parseInt(sp[1]);
                }
            }
            nextIndex[0] += inc[0];
            nextIndex[1] += inc[1];

            const nextFilename = `${crt_filename}_${nextIndex[0]}_${nextIndex[1]}.${crt_filename_type}`;
            
            if (fs.existsSync(nextFilename)) {
                logger.info(`[AutoNext] 發現下一個區塊: ${nextFilename}`);
                
                // 更新設定檔
                try {
                    const fullCfg = await readConfig(configPath);
                    fullCfg.schematic.filename = nextFilename;
                    await saveConfig(configPath, fullCfg);
                } catch (e) {
                    logger.error(`[AutoNext] 更新設定檔失敗: ${e.message}`);
                    return;
                }
                
                // 延遲啟動下一個任務
                setTimeout(async () => {
                    try {
                        logger.info(`[AutoNext] 正在啟動自動建造任務...`);
                        const context = { source: task.source, minecraftUser: task.minecraftUser || '' };
                        const cmdMgr = require('../CommandManager');
                        await cmdMgr.dispatch(bot, ["build", "-a", FLAG_autonext_value, FLAG_disableWebHookNotification ? "-n" : ""].filter(Boolean), context);
                    } catch (e) {
                        logger.error(`[AutoNext] 自動建造啟動或執行失敗: ${e.message}`);
                    }
                }, 10000);
            } else {
                logger.info(`[AutoNext] 未發現檔案: ${nextFilename}，自動建造結束。`);
                
                // --- 新增：自動存圖邏輯 ---
                if (mapart_global_cfg.save && mapart_global_cfg.save.autoSaveAfterBuild) {
                    // 只有 worker_id 為 0 的機器人執行存圖
                    if (workerIndex === 0) {
                        logger.info(`[AutoSave] 檢測到全圖建造完成且開啟自動存圖，5秒後開始存圖流程...`);
                        setTimeout(async () => {
                            try {
                                const cmdMgr = require('../CommandManager');
                                await cmdMgr.dispatch(bot, ["save"], { source: task.source });
                            } catch (e) {
                                logger.error(`[AutoSave] 自動存圖啟動失敗: ${e.message}`);
                            }
                        }, 5000);
                    }
                }
            }
        }
    }
};

function gen_mapartFinishEmbed(bot, cfg, result, useTime) {
    let iconurl = `https://mc-heads.net/avatar/${bot.username}`;
    return {
        color: 0x0099ff,
        title: `${cfg.schematic.filename} 建造完成`,
        author: {
            name: bot.username,
            icon_url: iconurl,
        },
        thumbnail: {
            url: iconurl,
        },
        fields: [
            {
                name: 'Placement Origin',
                value: `X:\`${result.placement_origin.x}\` Y:\`${result.placement_origin.y}\` Z:\`${result.placement_origin.z}\``,
            },
            {
                name: '消耗時間',
                value: `${parseInt((useTime / 3600))} h ${parseInt((useTime % 3600) / 60)} m ${parseInt(useTime % 60)} s`,
                inline: true
            },
            {
                name: 'Speed',
                value: `${Math.round((result.totalBlocks / (useTime / 3600)) * 10) / 10} Blocks / h`,
                inline: true
            }
        ]
    };
}
