const { readConfig, sleep, v } = require('../../../lib/utils');
const { Vec3 } = require('vec3');
const mcFallout = require('../../../lib/mcFallout');
const pathfinder = require('../../../lib/pathfinder');
const containerOperation = require('../../../lib/containerOperation');
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
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        
        let cfg = await readConfig(configPath);
        if (!cfg.save) {
            logger.error("缺少 'save' 設定，請檢查 mapart.json");
            return;
        }

        const saveCfg = cfg.save;
        const schCfg = cfg.schematic;
        
        // 1. 前往補給站
        if (saveCfg.warp) {
            logger.info(`正在前往補給站: ${saveCfg.warp}`);
            try {
                await mcFallout.warp(bot, saveCfg.warp, 5000, 3);
            } catch (e) {
                logger.error(`前往補給站失敗: ${e.message}`);
                return;
            }
            await sleep(2000);
        }

        // 2. 拿取空白地圖
        const emptyMapChestInfo = saveCfg.empty_map_chest;
        if (!emptyMapChestInfo || emptyMapChestInfo.length < 3) {
            logger.error("空白地圖箱子座標設定不完全");
            return;
        }
        const emptyMapChestPos = new Vec3(emptyMapChestInfo[0], emptyMapChestInfo[1], emptyMapChestInfo[2]);
        logger.info(`正在從箱子 (${emptyMapChestPos}) 拿取空白地圖...`);
        
        await pathfinder.astarfly(bot, emptyMapChestPos.offset(0, 2, 0), null, null, null, true);
        const emptyMapChest = await containerOperation.openContainerWithTimeout(bot, emptyMapChestPos);
        
        if (!emptyMapChest) {
            logger.error("無法開啟空白地圖箱子");
            return;
        }

        // 拿取 1 個空白地圖
        const withdrawRes = await containerOperation.withdraw(bot, emptyMapChest, 'map', 1);
        await emptyMapChest.close();
        
        if (withdrawRes === 1) {
            logger.error("箱子中沒有空白地圖或拿取失敗");
            return;
        }
        await sleep(500);

        // 3. 飛向藍圖中央
        const centerX = schCfg.placementPoint_x + (saveCfg.center_offset_x || 64);
        const centerZ = schCfg.placementPoint_z + (saveCfg.center_offset_z || 64);
        const centerY = schCfg.placementPoint_y + 2; // 飛在藍圖上方一點點
        const centerPos = new Vec3(centerX, centerY, centerZ);

        logger.info(`正在飛往藍圖中央: ${centerPos}`);
        await pathfinder.astarfly(bot, centerPos, null, null, null, true);
        await sleep(1000);

        // 4. 寫入地圖 (使用地圖)
        const emptyMap = bot.inventory.items().find(i => i.name === 'map');
        if (!emptyMap) {
            logger.error("背包中找不到空白地圖");
            return;
        }

        // 切換到地圖槽位
        await bot.equip(emptyMap, 'hand');
        await sleep(500);
        
        logger.info("正在寫入地圖 (右鍵使用)...");
        bot.activateItem(); // 使用當前持有的物品
        await sleep(1500); // 等待地圖渲染/寫入

        // 5. 放入成果箱
        const filledMapChestInfo = saveCfg.filled_map_chest;
        if (!filledMapChestInfo || filledMapChestInfo.length < 3) {
            logger.error("成果箱子座標設定不完全");
            return;
        }
        const filledMapChestPos = new Vec3(filledMapChestInfo[0], filledMapChestInfo[1], filledMapChestInfo[2]);
        logger.info(`正在前往成果箱: ${filledMapChestPos}`);
        
        // 如果成果箱跟補給站很遠，可能需要先 warp 回去，
        // 但這裡假設飛得過去或者在同一個 warp 點附近。
        // 如果需要 warp，可以檢查距離或者強制 warp。
        if (saveCfg.warp) {
            // 這裡簡單處理：如果距離太遠就再 warp 一次
            if (bot.entity.position.distanceTo(filledMapChestPos) > 100) {
                logger.info(`距離成果箱過遠，重新傳送至: ${saveCfg.warp}`);
                try {
                    await mcFallout.warp(bot, saveCfg.warp, 5000, 3);
                } catch (e) {
                    logger.error(`重新傳送失敗: ${e.message}`);
                }
                await sleep(2000);
            }
        }

        await pathfinder.astarfly(bot, filledMapChestPos.offset(0, 2, 0), null, null, null, true);
        const filledMapChest = await containerOperation.openContainerWithTimeout(bot, filledMapChestPos);
        
        if (!filledMapChest) {
            logger.error("無法開啟成果箱子");
            return;
        }

        logger.info("正在放入完成的地圖...");
        await containerOperation.deposit(bot, filledMapChest, 'filled_map', 1);
        await filledMapChest.close();
        
        logger.info("✅ 自動存圖完成！");
    }
};
