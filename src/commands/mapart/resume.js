const litematicPrinter = require('../../../lib/litematicPrinter');
const logger = require('../../../lib/logger').module('Mapart-Resume');

module.exports = {
    name: "地圖畫 建造-繼續",
    identifier: ["resume", "r"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        litematicPrinter.resume(task.bot);
        logger.info("已繼續建造");
    }
}
