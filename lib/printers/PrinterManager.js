/**
 * 建築模式管理器 (符合 OCP)
 * 允許註冊不同的建築模型插件
 */
class PrinterManager {
    constructor() {
        this.printers = new Map();
    }

    /**
     * 註冊一個新的 Printer
     * @param {Object} printer 實作了 build 方法的 Printer 物件
     */
    registerPrinter(printer) {
        this.printers.set(printer.name, printer);
    }

    /**
     * 獲取指定的 Printer
     * @param {string} name Printer 名稱 (mapart, building, redstone)
     */
    getPrinter(name) {
        return this.printers.get(name);
    }

    /**
     * 分發建造任務
     */
    async executeBuild(name, task, bot, cfg, project, sharedState) {
        const printer = this.getPrinter(name);
        if (!printer) {
            throw new Error(`Unsupport printer model: ${name}`);
        }
        return await printer.build(task, bot, cfg, project, sharedState);
    }
}

module.exports = new PrinterManager();
