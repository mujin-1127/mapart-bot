const { readConfig, sleep, v } = require('../../../lib/utils');
const containerOperation = require('../../../lib/containerOperation');
const mcFallout = require('../../../lib/mcFallout');
const logger = require('../../../lib/logger').module('Mapart-Wrap');

module.exports = {
    name: "地圖畫 分裝",
    identifier: ["wrap", "w"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        let mapart_name_cfg_cache = await readConfig(configPath);
        
        let counter = 64;
        let wrap_items = [];
        let inputVec = v(mapart_name_cfg_cache["wrap"]["wrap_input_shulker"]);
        let outputVec = v(mapart_name_cfg_cache["wrap"]["wrap_output_shulker"]);
        let btvec = v(mapart_name_cfg_cache["wrap"]["wrap_button"]);
        
        bot.setQuickBarSlot(8);
        await mcFallout.openPreventSpecItem(bot);

        // 檢查輸入盒子
        let input = await containerOperation.openContainerWithTimeout(bot, inputVec, 500);
        await sleep(500);
        if (!input) {
            logger.error("無法開啟輸入盒子");
            return;
        }
        
        for (let i = 0; i < 27; i++) {
            let item = { name: null, mapid: -1 };
            if (input.slots[i] != null) {
                item.name = input.slots[i]?.name;
                counter = Math.min(input.slots[i].count, counter);
            }
            if (input.slots[i]?.name == 'filled_map') {
                item.mapid = input.slots[i]?.nbt?.value?.map?.value;
            }
            wrap_items.push(item);
        }
        await input.close();
        await sleep(500);

        for (let i = 0; i < counter; i++) {
            let input2 = await containerOperation.openContainerWithTimeout(bot, inputVec, 1000);
            if (!input2) {
                logger.error("無法開啟輸入盒子 (第二次)");
                return;
            }
            
            // 取出
            for (let gg = 0; gg < 27; gg++) {
                if (wrap_items[gg].name == null) continue;
                let emptySlot = input2.firstEmptySlotRange(input2.inventoryStart, input2.inventoryEnd);
                await bot.simpleClick.leftMouse(gg);
                await bot.simpleClick.rightMouse(emptySlot);
                await bot.simpleClick.leftMouse(gg);
            }
            await input2.close();
            await sleep(50);
            
            // 放入
            let output = await containerOperation.openContainerWithTimeout(bot, outputVec, 1000);
            if (!output) {
                logger.error("無法開啟輸出盒子");
                return;
            }
            
            for (let gg = 0; gg < 27; gg++) {
                if (wrap_items[gg].name == null) continue;
                if (wrap_items[gg].name == "filled_map") {
                    let tgmp = -1;
                    for (let ff = 27; ff <= 62; ff++) {
                        if (output.slots[ff]?.nbt?.value?.map?.value == wrap_items[gg].mapid) {
                            tgmp = ff;
                            break;
                        }
                    }
                    if (tgmp != -1) {
                        await bot.simpleClick.leftMouse(tgmp);
                        await bot.simpleClick.leftMouse(gg);
                    }
                } else {
                    let tgmp = -1;
                    for (let ff = 27; ff <= 62; ff++) {
                        if (output.slots[ff]?.name == wrap_items[gg].name) {
                            tgmp = ff;
                            break;
                        }
                    }
                    if (tgmp != -1) {
                        await bot.simpleClick.leftMouse(tgmp);
                        await bot.simpleClick.leftMouse(gg);
                    }
                }
            }

            await output.close();
            await sleep(50);
            logger.info(`第 ${i + 1} 套 完成`);
            await bot.activateBlock(bot.blockAt(btvec));
            await sleep(250);
        }
    }
};
