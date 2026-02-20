const logger = require('../../../lib/logger').module('Mapart-Drop');

module.exports = {
    name: "地圖畫 丟棄所有物品",
    identifier: ["drop", "dropall"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        logger.info("正在丟棄所有物品...");
        
        const items = bot.inventory.items();
        if (items.length === 0) {
            logger.info("背包是空的，沒什麼好丟的。");
            return;
        }

        for (const item of items) {
            try {
                await bot.tossStack(item);
            } catch (e) {
                // ignore
            }
        }
        logger.info("所有物品已丟棄完畢");
    }
}
