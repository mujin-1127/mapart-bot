const logger = require('../../../lib/logger').module('Mapart-Debug');

module.exports = {
    name: "toggle debug mode",
    identifier: ["debug"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        let mp = {};
        for (let i = bot.inventory.inventoryStart; i <= bot.inventory.inventoryEnd; i++) {
            if (bot.inventory.slots[i] == null) continue;
            let c = bot.inventory.slots[i].count;
            let n = bot.inventory.slots[i].name;
            if (!mp[n]) mp[n] = c;
            else mp[n] += c;
        }
        logger.info("當前背包內容:");
        for (const i in mp) {
            console.log(i.toString().padEnd(16), mp[i]);
        }
    }
}
