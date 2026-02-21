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
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        let mapart_build_cfg_cache = await readConfig(configPath);
        const mapart_global_cfg = await readConfig(`${process.cwd()}/config/global/mapart.json`);
        
        mapart_build_cfg_cache.bot_id = bot_id;
        
        // 合併全域與機器人特定替換表
        const botReplace = mapart_build_cfg_cache.replaceMaterials || [];
        const globalReplace = mapart_global_cfg.replaceMaterials || [];
        mapart_build_cfg_cache.replaceMaterials = [...globalReplace, ...botReplace];

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

        await litematicPrinter.build_file(task, bot, litematicPrinter.model_mapart, mapart_build_cfg_cache);
        
        let build_result_query = await litematicPrinter.progress_query(task, bot);
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
                const fullCfg = await readConfig(configPath);
                fullCfg.schematic.filename = nextFilename;
                await saveConfig(configPath, fullCfg);
                
                // 延遲啟動下一個任務
                setTimeout(async () => {
                    logger.info(`[AutoNext] 正在啟動自動建造任務...`);
                    const context = { source: task.source, minecraftUser: task.minecraftUser || '' };
                    try {
                        const cmdMgr = require('../CommandManager');
                        await cmdMgr.dispatch(bot, ["build", "-a", FLAG_autonext_value, FLAG_disableWebHookNotification ? "-n" : ""].filter(Boolean), context);
                    } catch (e) {
                        logger.error(`[AutoNext] 自動建造啟動失敗: ${e.message}`);
                    }
                }, 10000);
            } else {
                logger.info(`[AutoNext] 未發現檔案: ${nextFilename}，自動建造結束。`);
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
