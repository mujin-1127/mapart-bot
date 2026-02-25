const { readConfig, sleep, v } = require('../../../lib/utils');
const { Vec3 } = require('vec3');
const mcFallout = require('../../../lib/mcFallout');
const pathfinder = require('../../../lib/pathfinder');
const containerOperation = require('../../../lib/containerOperation');
const schematic = require('../../../lib/schematic');
const station = require('../../../lib/station');
const logger = require('../../../lib/logger').module('Mapart-Save');

module.exports = {
    name: "地圖畫 自動存圖",
    identifier: ["save", "sv"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const mcData = require('minecraft-data')(bot.version);
        const Item = require('prismarine-item')(bot.version);
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        
        let cfg = await readConfig(configPath);
        if (!cfg.save) {
            logger.error("缺少 'save' 設定，請檢查 mapart.json");
            return;
        }

        const saveCfg = cfg.save;
        const schCfg = cfg.schematic;
        
        // --- 第 0 階段：清理背包 ---
        // 在開始存圖流程前，先清理背包中剩餘的建築材料，確保有空間領取地圖與玻璃片
        const itemsToDrop = bot.inventory.items().filter(item => 
            item.name.includes('carpet') || 
            item.name.includes('concrete') || 
            item.name.includes('wool') ||
            item.name.includes('terracotta') ||
            item.name.includes('glass')
        );
        if (itemsToDrop.length > 0) {
            logger.info(`--- [第 0 階段] 正在清理背包中剩餘的 ${itemsToDrop.length} 堆建築材料 ---`);
            for (const item of itemsToDrop) {
                try {
                    await bot.tossStack(item);
                    await sleep(50);
                } catch (e) {}
            }
            await sleep(500);
        }

        // 0. 載入材料站設定 (用於獲取 Offset 與補救)
        let stationConfig;
        try {
            const stationFile = cfg.station || 'station.json';
            stationConfig = await readConfig(`${process.cwd()}/config/global/${stationFile}`);
        } catch (e) {
            logger.error("無法載入材料站設定，自動存圖需要 Offset 資訊");
            return;
        }

        // 定義一個內部輔助函式來處理箱子開啟 (含按鈕邏輯)
        const operateBox = async (boxInfo, action) => {
            if (!boxInfo || boxInfo.length < 3) return false;
            const boxPos = new Vec3(boxInfo[0], boxInfo[1], boxInfo[2]);
            const standPos = boxPos.plus(v(stationConfig.offset[boxInfo[3] || 'N']));
            const btnPos = boxPos.plus(v(stationConfig.offset[boxInfo[4] || 'bN']));

            // 尋路
            try {
                await pathfinder.astarfly(bot, standPos, null, null, null, true);
            } catch (e) {
                logger.error(`尋路失敗至 ${standPos}: ${e.message}`);
                return false;
            }
            
            // 開啟邏輯
            let container = null;
            for (let attempt = 0; attempt < 5; attempt++) {
                const block = bot.blockAt(boxPos);
                if (!block || block.name === 'air') {
                    const btnBlock = bot.blockAt(btnPos);
                    if (btnBlock) {
                        await bot.activateBlock(btnBlock);
                        await sleep(500);
                    }
                }
                container = await containerOperation.openContainerWithTimeout(bot, boxPos, 1500);
                if (container) break;
                await sleep(300);
            }

            if (!container) {
                logger.error(`無法開啟位於 ${boxPos} 的目標`);
                return false;
            }

            try {
                const result = await action(container);
                await container.close();
                return result !== false; // 如果 action 回傳 false 也代表失敗
            } catch (err) {
                logger.error(`操作失敗: ${err.message}`);
                await container.close();
                return false;
            }
        };

        // --- 第 1 階段：驗證補救 ---
        logger.info("--- [第 1 階段] 開始全區域驗證與補救 ---");
        
        // 先飛往地圖中央，確保區塊載入
        const mapCenterX = schCfg.placementPoint_x + 64;
        const mapCenterZ = schCfg.placementPoint_z + 64;
        const mapCenterPos = new Vec3(mapCenterX, schCfg.placementPoint_y + 10, mapCenterZ);
        
        logger.info(`正在飛往地圖中央 (${mapCenterPos}) 以載入區塊...`);
        try {
            await pathfinder.astarfly(bot, mapCenterPos, null, null, null, true);
            await sleep(1000); // 等待區塊載入
        } catch (e) {
            logger.error(`無法飛往地圖中央: ${e.message}`);
            return;
        }

        let targetSch;
        try {
            targetSch = await schematic.loadFromFile(schCfg.filename);
            targetSch.toMineflayerID();
            for (const i in cfg.replaceMaterials) {
                targetSch.changeMaterial(cfg.replaceMaterials[i][0], cfg.replaceMaterials[i][1]);
            }
        } catch (e) {
            logger.error(`載入藍圖失敗: ${e.message}`);
            return;
        }

        const placementOrigin = new Vec3(schCfg.placementPoint_x, schCfg.placementPoint_y, schCfg.placementPoint_z);
        let missingBlocks = [];
        let consecutiveFailures = 0;
        
        for (let i = 0; i < targetSch.Metadata.TotalVolume; i++) {
            const rel = targetSch.vec3(i);
            const expectedPid = targetSch.getBlockPIDByIndex(i);
            const expectedName = targetSch.palette[expectedPid].Name;
            if (["air", "cave_air"].includes(expectedName)) continue;

            const absPos = placementOrigin.plus(rel);
            const block = bot.blockAt(absPos);
            // 如果區塊未載入，block 會是 null
            if (!block || block.name !== expectedName) {
                missingBlocks.push({ pos: absPos, name: expectedName });
            }
        }

        if (missingBlocks.length > 0) {
            logger.warn(`發現 ${missingBlocks.length} 個漏蓋方塊，開始補救...`);
            for (const mb of missingBlocks) {
                await pathfinder.astarfly(bot, mb.pos.offset(0, 2, 0), null, null, null, true);
                let current = bot.blockAt(mb.pos);
                if (current && current.name === mb.name) continue;

                let item = bot.inventory.items().find(i => i.name === mb.name);
                if (!item && stationConfig) {
                    await station.restock(bot, stationConfig, [{ name: mb.name, count: 64 }]);
                    await pathfinder.astarfly(bot, mb.pos.offset(0, 2, 0), null, null, null, true);
                }

                item = bot.inventory.items().find(i => i.name === mb.name);
                if (item) {
                    await bot.equip(item, 'hand');
                    if (current && !["air", "cave_air", "water", "lava"].includes(current.name)) {
                        try { await bot.dig(current, true); } catch(e) {}
                    }
                    bot._client.write('block_place', {
                        location: mb.pos,
                        direction: 0,
                        heldItem: Item.toNotch(bot.heldItem),
                        cursorX: 0.5, cursorY: 0.5, cursorZ: 0.5
                    });
                    await sleep(300);
                    const checkBlock = bot.blockAt(mb.pos);
                    if (checkBlock && checkBlock.name === mb.name) {
                        consecutiveFailures = 0;
                    } else {
                        consecutiveFailures++;
                        if (consecutiveFailures >= 20) {
                            logger.error("連續放置失敗超過 20 次，中斷流程");
                            return;
                        }
                    }
                } else {
                    logger.error(`缺少補救方塊 ${mb.name} 且無法補給，中斷流程`);
                    return;
                }
            }
            // 補救完再次檢查
            logger.info("補救完成，再次確認全區域...");
            for (const mb of missingBlocks) {
                const b = bot.blockAt(mb.pos);
                if (!b || b.name !== mb.name) {
                    logger.error(`方塊 ${mb.name} 於 ${mb.pos} 補救失敗，中斷流程`);
                    return;
                }
            }
        }

        // --- 第 2 階段：物資準備 ---
        logger.info("--- [第 2 階段] 正在前往補給站並領取物資 ---");
        if (saveCfg.warp) {
            const warpOk = await mcFallout.warp(bot, saveCfg.warp, 5000, 3);
            if (!warpOk) {
                logger.error("傳送至補給站失敗，中斷流程");
                return;
            }
            await sleep(2000);
        }

        // 領取空白地圖與玻璃片
        const getMapOk = await operateBox(saveCfg.empty_map_chest, async (c) => {
            const remain = await containerOperation.withdraw(bot, c, 'map', 1);
            return remain !== 1; // 如果領取成功，remain 會是 0 或比 1 小
        });
        if (!getMapOk) { logger.error("領取空白地圖失敗，中斷流程"); return; }

        const getGlassOk = await operateBox(saveCfg.glass_pane_chest, async (c) => {
            const remain = await containerOperation.withdraw(bot, c, 'glass_pane', 1);
            return remain !== 1;
        });
        if (!getGlassOk) { logger.error("領取玻璃片失敗，中斷流程"); return; }

        // --- 第 3 階段：地圖寫入 ---
        const centerX = schCfg.placementPoint_x + (saveCfg.center_offset_x || 64);
        const centerZ = schCfg.placementPoint_z + (saveCfg.center_offset_z || 64);
        const centerPos = new Vec3(centerX, schCfg.placementPoint_y + 2, centerZ);
        
        await pathfinder.astarfly(bot, centerPos, null, null, null, true);
        const emptyMap = bot.inventory.items().find(i => i.name === 'map');
        if (!emptyMap) { logger.error("背包中找不到空白地圖，中斷流程"); return; }

        await bot.equip(emptyMap, 'hand');
        await sleep(500);
        bot.activateItem();
        await sleep(2000);
        
        const filledMap = bot.inventory.items().find(i => i.name === 'filled_map');
        if (!filledMap) { logger.error("地圖寫入失敗 (未生成 filled_map)，中斷流程"); return; }

        // --- 第 4 階段：鎖定地圖 ---
        logger.info("--- [第 4 階段] 正在前往製圖台鎖定地圖 ---");
        let lockOk = false;
        const cartOk = await operateBox(saveCfg.cartography_table, async (table) => {
            const mapInInv = table.items().find(i => i.name === 'filled_map');
            const glassInInv = table.items().find(i => i.name === 'glass_pane');
            if (!mapInInv || !glassInInv) {
                logger.error("製圖台中找不到地圖或玻璃片，請檢查背包同步");
                return false;
            }
            
            await bot.clickWindow(mapInInv.slot, 0, 0);
            await bot.clickWindow(0, 0, 0);
            await bot.clickWindow(glassInInv.slot, 0, 0);
            await bot.clickWindow(1, 0, 0);
            await sleep(1000);
            
            if (table.slots[2]) {
                await bot.clickWindow(2, 0, 0);
                const emptySlot = table.firstEmptySlotRange(3, 38);
                await bot.clickWindow(emptySlot || 3, 0, 0);
                lockOk = true;
                return true;
            }
            return false;
        });
        if (!cartOk || !lockOk) { logger.error("鎖定地圖失敗，中斷流程"); return; }

        // --- 第 5 階段：存檔指令 ---
        logger.info("--- [第 5 階段] 執行 /savemap 指令 ---");
        const lockedMap = bot.inventory.items().find(i => i.name === 'filled_map');
        if (!lockedMap) { logger.error("背包中找不到已鎖定的地圖，中斷流程"); return; }

        await bot.equip(lockedMap, 'hand');
        await sleep(500);
        bot.chat('/savemap');
        await sleep(2000); // 給予伺服器一點時間處理

        // --- 第 6 階段：歸檔存入 ---
        logger.info("--- [第 6 階段] 正在存入成果箱 ---");
        const finalDepositOk = await operateBox(saveCfg.filled_map_chest, async (c) => {
            await sleep(500);
            bot.updateHeldItem(); // 強制同步背包狀態
            
            // 必須從目前開啟的視窗 (c) 中尋找物品，且槽位必須在背包區域 (>= c.inventoryStart)
            const itemToDeposit = c.items().find(i => i.name === 'filled_map' && i.slot >= c.inventoryStart);
            
            if (!itemToDeposit) {
                logger.warn("視窗中找不到填滿的地圖，嘗試直接使用 deposit");
                const remain = await containerOperation.deposit(bot, c, 'filled_map', 1);
                return remain === 0;
            }

            let targetSlot = -1;
            for (let i = 0; i < c.inventoryStart; i++) {
                if (!c.slots[i]) {
                    targetSlot = i;
                    break;
                }
            }

            if (targetSlot !== -1) {
                logger.info(`將地圖從槽位 ${itemToDeposit.slot} 存入容器槽位 ${targetSlot}`);
                await bot.clickWindow(itemToDeposit.slot, 0, 0);
                await bot.clickWindow(targetSlot, 0, 0);
                await sleep(600);
                return true;
            } else {
                const remain = await containerOperation.deposit(bot, c, 'filled_map', 1);
                return remain === 0;
            }
        });

        if (!finalDepositOk) {
            logger.error("最後存入成果箱失敗！請手動檢查機器人背包");
            return;
        }

        logger.info("✅ 自動存圖流程已全部嚴謹完成！");
    }
};
