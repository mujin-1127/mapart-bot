const BasePrinter = require('./BasePrinter');

class RedstonePrinter extends BasePrinter {
    constructor() {
        super();
        this.name = 'redstone';
    }

    async build(task, bot, cfg, project, sharedState) {
        throw new Error("Redstone Printer is Not Implemented yet.");
    }
}

module.exports = RedstonePrinter;
