const { sleep, v, checkStop } = require('../lib/utils');
const containerOperation = require(`./containerOperation`);
const { Vec3 } = require('vec3');

/**
 * 材料站管理模組 (Refactored)
 */
const station = {
    /**
     * 檢查材料站是否支援該材料
     */
    checkSupport(bot, stationConfig, target) {
        return this.getIndexOF(stationConfig, target) !== -1;
    },

    /**
     * 獲取材料在配置中的第一個索引
     */
    getIndexOF(stationConfig, target) {
        for (let i = 0; i < stationConfig.materials.length; i++) {
            if (stationConfig.materials[i][0] === target) return i;
        }
        return -1;
    },

    /**
     * 獲取材料在配置中的所有索引 (支援多個箱子存放同一種材料)
     */
    getIndicesOF(stationConfig, target) {
        const indices = [];
        for (let i = 0; i < stationConfig.materials.length; i++) {
            if (stationConfig.materials[i][0] === target) indices.push(i);
        }
        return indices;
    },

    /**
     * 核心補給函式
     */
    async restock(bot, stationConfig, RS_obj_array) {
        const mcData = require('minecraft-data')(bot.version);
        this.log(bot, `開始執行補給任務，目標項數: ${RS_obj_array.length}`);

        for (const item of RS_obj_array) {
            if (checkStop(bot)) break;
            await this.restockSingleItem(bot, stationConfig, item.name, item.count, mcData);
        }

        this.log(bot, "補給任務完成");
    },

    /**
     * 單項物品補給邏輯
     */
    async restockSingleItem(bot, stationConfig, itemName, quantity, mcData) {
        if (checkStop(bot)) return;
        let remain = quantity;
        const isDeposit = quantity === -1; 
        
        const materialIndices = this.getIndicesOF(stationConfig, itemName);
        
        if (materialIndices.length === 0 && !isDeposit) {
            this.log(bot, `警告: 材料站不支援材料 ${itemName}`, 'WARN');
            return;
        }

        if (isDeposit) {
            if (materialIndices.length > 0) {
                remain = await this.processBoxList(bot, stationConfig, materialIndices, itemName, -1, 'deposit');
            }
            if (remain !== 0 && !checkStop(bot)) {
                await this.processOverfull(bot, stationConfig, itemName);
            }
        } else {
            await this.processBoxList(bot, stationConfig, materialIndices, itemName, remain, 'withdraw');
        }
    },

    /**
     * 遍歷箱子列表進行操作
     */
    async processBoxList(bot, stationConfig, indices, itemName, quantity, mode) {
        let remain = quantity;
        for (const idx of indices) {
            if (checkStop(bot)) break;
            if (mode === 'withdraw' && remain <= 0) break;
            
            const boxData = stationConfig.materials[idx];
            const success = await containerOperation.operateBox(bot, stationConfig, boxData[1], async (container) => {
                if (checkStop(bot)) return false;
                if (mode === 'withdraw') {
                    const result = await containerOperation.withdraw(bot, container, itemName, remain, false);
                    if (result === -2) return { continue: true, remain }; 
                    remain = result;
                    return { continue: false, remain };
                } else {
                    remain = await containerOperation.deposit(bot, container, itemName, -1, false);
                    return { continue: remain > 0, remain }; 
                }
            });

            if (!success && mode === 'withdraw' && !checkStop(bot)) {
                this.log(bot, `無法處理箱子 ${itemName}`, 'ERROR');
            }
        }
        return remain;
    },

    /**
     * 處理溢出 (Overfull) 的存入
     */
    async processOverfull(bot, stationConfig, itemName) {
        if (!stationConfig.overfull) return;
        await containerOperation.operateBox(bot, stationConfig, stationConfig.overfull, async (container) => {
            await containerOperation.deposit(bot, container, itemName, -1, false);
            return { continue: false };
        });
    },

    log(bot, message, level = 'INFO') {
        console.log(`[Station] [${level}] ${message}`);
    }
};

module.exports = station;
