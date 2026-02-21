const { readConfig } = require('../../../lib/utils');
const station = require('../../../lib/station');
const logger = require('../../../lib/logger').module('Mapart-Test');

module.exports = {
    name: "test",
    identifier: ["test"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        let mapart_build_cfg_cache = await readConfig(configPath);
        let stationConfig = await readConfig(`${process.cwd()}/config/global/${mapart_build_cfg_cache.station}`);
        
        let needReStock = [
            { name: task.content[1], count: parseInt(task.content[2]) },
        ];

        logger.info(`開始測試補給: ${task.content[1]} x ${task.content[2]}`);
        await station.newrestock(bot, stationConfig, needReStock);
        logger.info("測試結束");
    }
}
