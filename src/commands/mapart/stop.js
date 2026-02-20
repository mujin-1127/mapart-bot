const litematicPrinter = require('../../../lib/litematicPrinter');
const logger = require('../../../lib/logger').module('Mapart-Stop');

module.exports = {
    name: "地圖畫 建造-中止",
    identifier: ["stop", "s"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        litematicPrinter.stop();
        logger.info("已中止建造");
    }
}
