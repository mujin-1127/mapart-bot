const { readConfig } = require('../../../lib/utils');
const litematicPrinter = require('../../../lib/litematicPrinter');
const logger = require('../../../lib/logger').module('Mapart-Info');

module.exports = {
    name: "地圖畫 查詢設定",
    identifier: ["info", "i"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        try {
            let mapart_info_cfg_cache = await readConfig(configPath);
            let lppq = await litematicPrinter.progress_query(task, bot);
            
            let prog = 0;
            if (lppq && lppq.totalBlocks > 0) {
                prog = ((lppq.placedBlock / lppq.totalBlocks) * 100).toFixed(1);
            }

            const msg = `${mapart_info_cfg_cache.schematic.filename} ${prog}%`;

            switch (task.source) {
                case 'minecraft-dm':
                    bot.chat(`/m ${task.minecraftUser} ${msg}`);
                    break;
                case 'console':
                    logger.info(msg);
                    break;
                case 'discord':
                    // TODO: Implement Discord reply
                    logger.info(`[Discord] ${msg}`);
                    break;
                default:
                    break;
            }
        } catch (error) {
            logger.error(`查詢失敗: ${error.message}`);
        }
    }
}
