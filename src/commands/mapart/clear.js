const { readConfig, sleep, v, checkStop } = require('../../../lib/utils');
const { Vec3 } = require('vec3');
const mcFallout = require('../../../lib/mcFallout');
const pathfinder = require('../../../lib/pathfinder');
const schematic = require('../../../lib/schematic');
const litematicPrinter = require('../../../lib/litematicPrinter');
const logger = require('../../../lib/logger').module('Mapart-Clear');

const DEFAULT_OFFSETS = {
    "bN": new Vec3(0, 1, -2),
    "bS": new Vec3(0, 1, 2),
    "bW": new Vec3(-2, 1, 0),
    "bE": new Vec3(2, 1, 0),
    "N": new Vec3(0, 1, -3),
    "S": new Vec3(0, 1, 3),
    "W": new Vec3(-3, 1, 0),
    "E": new Vec3(3, 1, 0)
};

module.exports = {
    name: "地圖畫 清理區域",
    identifier: ["clear", "cl"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        
        litematicPrinter.initBot(bot);
        bot._litematicState.stop = false; // 重置停止狀態

        const setStatus = (msg) => {
            if (bot.sharedState && bot.sharedState.build_cache) {
                bot.sharedState.build_cache.currentAction = msg;
            }
        };

        let cfg = await readConfig(configPath);
        if (!cfg.clear) {
            logger.error("缺少 'clear' 設定，請檢查 mapart.json");
            return;
        }

        // 取得全域鎖，確保同時只有一位機器人在清圖
        const webServer = bot.centralWebServer;
        const lockKey = `clear_lock_${cfg.task_group_id || 'default'}`;
        if (webServer && webServer.globalMapartCfg) {
            if (webServer.globalMapartCfg[lockKey] && webServer.globalMapartCfg[lockKey] !== bot_id) {
                logger.warn(`已有其他機器人 (${webServer.globalMapartCfg[lockKey]}) 正在執行清理，${bot_id} 跳過。`);
                return;
            }
            // 上鎖
            webServer.globalMapartCfg[lockKey] = bot_id;
            logger.info(`機器人 ${bot_id} 已取得清理鎖。`);
        }

        const clearCfg = cfg.clear;
        const schCfg = cfg.schematic;

        try {
            const centerX = schCfg.placementPoint_x + (clearCfg.center_offset_x || 64);
            const centerZ = schCfg.placementPoint_z + (clearCfg.center_offset_z || 64);
            const centerPos = new Vec3(centerX, schCfg.placementPoint_y + 10, centerZ);

            // --- 第 0 階段：前往藍圖中央 (確保區塊加載與指令執行位置) ---
            setStatus("正在前往地圖中央...");
            logger.info("--- [第 0 階段] 前往藍圖中央 ---");
            if (checkStop(bot, logger)) throw new Error("中止信號");
            try {
                await bot.creative.flyTo(centerPos);
                await sleep(1000);
            } catch (e) {
                logger.warn(`前往中心失敗，嘗試使用尋路: ${e.message}`);
                await pathfinder.astarfly(bot, centerPos, null, null, null, true);
            }

            // --- 第 1 階段：觸發清理按鈕 ---
            setStatus("正在觸發清理按鈕...");
            logger.info("--- [第 1 階段] 前往清理按鈕並觸發 ---");
            if (checkStop(bot, logger)) throw new Error("中止信號");
            
            // 執行設定的傳送指令 (如 /home r)
            if (clearCfg.home_cmd) {
                setStatus(`執行傳送指令: ${clearCfg.home_cmd}`);
                logger.info(`執行傳送指令: ${clearCfg.home_cmd}`);
                bot.chat(clearCfg.home_cmd);
                await sleep(2000); // 等待傳送完成
            }

            if (clearCfg.button) {
                const btnPos = new Vec3(clearCfg.button[0], clearCfg.button[1], clearCfg.button[2]);
                // 使用內建 DEFAULT_OFFSETS，不再依賴材料站設定檔
                const standOffset = DEFAULT_OFFSETS[clearCfg.button[3]] || new Vec3(0, 1, 0);
                const standPos = btnPos.plus(standOffset);
                
                logger.info(`正在前往按鈕位置: ${standPos}`);
                await pathfinder.astarfly(bot, standPos, null, null, null, true);
                await sleep(500);
                
                const btnBlock = bot.blockAt(btnPos);
                if (btnBlock) {
                    logger.info(`觸發清理按鈕於 ${btnPos}`);
                    await bot.activateBlock(btnBlock);
                    // 增加等待時間 (5秒)，讓伺服器有時間執行清理指令並避免立即移動造成的同步錯誤
                    await sleep(5000); 
                    
                    // 按完按鈕後執行 /back 回到按下按鈕前的位置 (通常是 /home r 之後的位置)
                    setStatus("執行 /back 指令...");
                    logger.info("執行 /back 指令...");
                    bot.chat('/back');
                    await sleep(2000);
                } else {
                    throw new Error(`找不到清理按鈕於 ${btnPos}`);
                }
            }

            // --- 第 2 階段：持續監測直到清空 ---
            setStatus("正在飛往高空監測清空狀態...");
            logger.info("--- [第 2 階段] 前往地圖中央並監測清空狀態 ---");
            if (checkStop(bot, logger)) throw new Error("中止信號");
            
            // 先飛到高空 (Y=120) 以避開可能尚未清空完成的方塊，防止被伺服器判定為卡住或墜落
            const safeHighPos = new Vec3(centerX, 120, centerZ);
            
            logger.info(`正在飛往高空安全點監測...`);
            try {
                // 使用 creative.flyTo 通常比 astarfly 在這種單純位移上更穩定
                await bot.creative.flyTo(safeHighPos);
                await sleep(1000);
                await bot.creative.flyTo(centerPos);
            } catch (e) {
                logger.warn(`自動飛行至中心失敗，嘗試使用尋路: ${e.message}`);
                await pathfinder.astarfly(bot, centerPos, null, null, null, true);
            }
            await sleep(2000);

            setStatus("正在載入藍圖進行比對...");
            let targetSch;
            try {
                targetSch = await schematic.loadFromFile(schCfg.filename);
                targetSch.toMineflayerID();
            } catch (e) {
                throw new Error(`載入藍圖失敗: ${e.message}`);
            }

            const placementOrigin = new Vec3(schCfg.placementPoint_x, schCfg.placementPoint_y, schCfg.placementPoint_z);
            // 過濾掉藍圖中的空氣方塊，只計算實際需要清空的方塊總數
            const blocksToClear = [];
            for (let i = 0; i < targetSch.Metadata.TotalVolume; i++) {
                const pId = targetSch.getBlockPIDByIndex(i);
                if (!["air", "cave_air"].includes(targetSch.palette[pId].Name)) {
                    blocksToClear.push(i);
                }
            }
            const totalToClear = blocksToClear.length;
            
            let isCleared = false;
            let lastReportTime = 0;

            while (!isCleared) {
                // 檢查是否中止
                if (checkStop(bot, logger)) throw new Error("中止信號");

                let remainingBlocks = 0;
                for (const index of blocksToClear) {
                    const rel = targetSch.vec3(index);
                    const absPos = placementOrigin.plus(rel);
                    const block = bot.blockAt(absPos);
                    
                    // 如果區塊未加載或非空氣，計為剩餘方塊
                    if (!block || !["air", "cave_air"].includes(block.name)) {
                        remainingBlocks++;
                    }
                }

                const progress = totalToClear > 0 ? ((totalToClear - remainingBlocks) / totalToClear * 100).toFixed(1) : 0;
                setStatus(`正在監測區域清空... (進度: ${progress}%)`);
                const now = Date.now();
                
                // 每 30 秒向前端發送一次進度更新，或當進度完成時
                if (now - lastReportTime > 30000 || remainingBlocks === 0) {
                    logger.info(`清理進度: ${progress}% (剩餘方塊: ${remainingBlocks}/${totalToClear})`);
                    if (bot.centralWebServer) {
                        bot.centralWebServer.io.emit('task_progress', {
                            botId: bot_id,
                            taskName: "清理區域",
                            progress: progress,
                            message: `正在監測清理狀態... 剩餘方塊: ${remainingBlocks}`
                        });
                    }
                    lastReportTime = now;
                }

                if (remainingBlocks === 0) {
                    isCleared = true;
                    logger.info("✅ 檢測到區域已完全清空！");
                } else {
                    await sleep(10000); // 每 10 秒檢查一次
                }
            }

            // --- 第 3 階段：完成 ---
            setStatus("清理完成！");
            logger.info("發出完成提示音...");
            if (bot.centralWebServer) {
                bot.centralWebServer.io.emit('task_finished', {
                    botId: bot_id,
                    taskName: "清理區域",
                    message: "地圖繪區域已完全清空！"
                });
            }
            
            logger.info("✅ 清理監測任務已完成！");
            
            // --- 第 4 階段：自動啟動佇列中的下一個任務 ---
            await module.exports.tryTriggerNextTask(bot, task.source);

        } catch (err) {
            logger.error(`清理任務失敗: ${err.message}`);
        } finally {
            // 解鎖
            if (webServer && webServer.globalMapartCfg && webServer.globalMapartCfg[lockKey] === bot_id) {
                delete webServer.globalMapartCfg[lockKey];
                logger.info(`機器人 ${bot_id} 已釋放清理鎖。`);
            }
        }
    },

    async tryTriggerNextTask(bot, source) {
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        const { readConfig, saveConfig, checkStop } = require('../../../lib/utils');
        const cmdMgr = require('../CommandManager');
        
        // 檢查是否應中止
        if (checkStop(bot, logger)) return;

        try {
            let cfg = await readConfig(configPath);
            if (!cfg.queue || cfg.queue.length === 0) return;

            logger.info(`--- [自動任務系統] 正在處理任務結束 (目前佇列長度: ${cfg.queue.length}) ---`);

            // 1. 無論如何都移除已經完成的當前任務 (第一個)
            const finishedTask = cfg.queue.shift();
            logger.info(`[自動任務系統] 已從佇列移除完成的任務: ${finishedTask.filename}`);

            // 2. 如果佇列空了，代表全部結束
            if (cfg.queue.length === 0) {
                cfg.schematic = null;
                await saveConfig(configPath, cfg);
                logger.info("--- [自動任務系統] 佇列中所有任務已完成！ ---");
                
                // 通知前端：所有任務已完成 (觸發提示音)
                if (bot.centralWebServer) {
                    bot.centralWebServer.io.emit('all_tasks_finished', {
                        message: "所有佇列任務已完成！"
                    });
                    bot.centralWebServer.io.emit('config_updated', { type: 'mapart' });
                }
                return;
            }

            // 3. 佇列中還有下一個任務
            const nextTask = cfg.queue[0];
            cfg.schematic = {
                filename: nextTask.filename,
                placementPoint_x: nextTask.x,
                placementPoint_y: nextTask.y,
                placementPoint_z: nextTask.z
            };
            
            // 先儲存移除後的設定
            await saveConfig(configPath, cfg);
            if (bot.centralWebServer) {
                bot.centralWebServer.io.emit('config_updated', { type: 'mapart' });
            }

            // 4. 檢查是否要自動啟動下一個
            if (!cfg.autoNext) {
                logger.info("[自動任務系統] 自動執行下一個任務已關閉，停止於此。");
                return;
            }

            logger.info(`--- [自動任務系統] 正在切換至下一個任務: ${nextTask.filename} ---`);
            
            // 5. 通知所有機器人開始建造
            const botIds = cfg.botIds || [];
            const webServer = bot.centralWebServer;
            
            if (webServer) {
                logger.info(`[自動任務系統] 正在通知 ${botIds.length} 個參與者開始建造...`);
                for (const id of botIds) {
                    const instance = webServer.botInstances.get(id);
                    if (instance && instance.bot && instance.bot.entity) {
                        cmdMgr.dispatch(instance.bot, ["build"], { source: source }).catch(e => {
                            logger.error(`通知機器人 ${id} 失敗: ${e.message}`);
                        });
                    }
                }
            } else {
                await cmdMgr.dispatch(bot, ["build"], { source: source });
            }
        } catch (e) {
            logger.error(`[自動任務系統] 處理下一個任務失敗: ${e.message}`);
        }
    }
};
