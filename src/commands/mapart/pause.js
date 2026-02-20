const litematicPrinter = require('../../../lib/litematicPrinter');
const logger = require('../../../lib/logger').module('Mapart-Pause');

module.exports = {
    name: "地圖畫 建造-暫停",
    identifier: ["pause", "p"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        litematicPrinter.pause(true);
        logger.info("已暫停建造");
    }
}
