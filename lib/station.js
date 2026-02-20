const { sleep, v, promiseWithTimeout } = require('../lib/utils');
const containerOperation = require(`../lib/containerOperation`);
const mcFallout = require(`../lib/mcFallout`);
const pathfinder = require(`../lib/pathfinder`);
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
     * @param {object} bot - Mineflayer bot 實例
     * @param {object} stationConfig - 材料站配置物件
     * @param {Array} RS_obj_array - 補給目標陣列 [{ name: 'stone', count: 64 }, ...]
     */
    async restock(bot, stationConfig, RS_obj_array) {
        const mcData = require('minecraft-data')(bot.version);
        
        // 輸出當前背包物品
        const items = bot.inventory.items();
        console.log(`\n============= [${bot.username}] 準備補給，目前背包內容 =============`);
        if (items.length === 0) {
            console.log("背包是空的");
        } else {
            const summary = {};
            items.forEach(item => { summary[item.name] = (summary[item.name] || 0) + item.count; });
            Object.entries(summary).sort().forEach(([name, count]) => {
                console.log(`${name.padEnd(25)}: x${count.toString().padEnd(4)} (${Math.ceil(count/64)} 組)`);
            });
        }
        console.log("==============================================================\n");

        this.log(bot, `開始執行補給任務，目標項數: ${RS_obj_array.length}`);

        for (const item of RS_obj_array) {
            await this.restockSingleItem(bot, stationConfig, item.name, item.count, mcData);
        }

        this.log(bot, "補給任務完成");
    },

    /**
     * 單項物品補給邏輯
     */
    async restockSingleItem(bot, stationConfig, itemName, quantity, mcData) {
        let remain = quantity;
        const isDeposit = quantity === -1; // -1 代表放回 (Deposit)
        
        // 獲取該材料的所有儲存點
        const materialIndices = this.getIndicesOF(stationConfig, itemName);
        
        if (materialIndices.length === 0 && !isDeposit) {
            this.log(bot, `警告: 材料站不支援材料 ${itemName}`, 'WARN');
            return;
        }

        if (isDeposit) {
            // 放回邏輯：嘗試放回原位，如果放不下則放入 Overfull
            if (materialIndices.length > 0) {
                remain = await this.processBoxList(bot, stationConfig, materialIndices, itemName, -1, 'deposit');
            }
            if (remain !== 0) {
                await this.processOverfull(bot, stationConfig, itemName);
            }
        } else {
            // 提取邏輯：依序搜尋所有箱子直到補齊數量
            await this.processBoxList(bot, stationConfig, materialIndices, itemName, remain, 'withdraw');
        }
    },

    /**
     * 遍歷箱子列表進行操作
     */
    async processBoxList(bot, stationConfig, indices, itemName, quantity, mode) {
        let remain = quantity;
        for (const idx of indices) {
            if (mode === 'withdraw' && remain <= 0) break;
            
            const boxData = stationConfig.materials[idx];
            const boxPos = new Vec3(boxData[1][0], boxData[1][1], boxData[1][2]);
            const standPos = boxPos.plus(v(stationConfig.offset[boxData[1][3]]));
            const btnPos = boxPos.plus(v(stationConfig.offset[boxData[1][4]]));

            const success = await this.operateBox(bot, stationConfig, boxPos, standPos, btnPos, async (container) => {
                if (mode === 'withdraw') {
                    const result = await containerOperation.withdraw(bot, container, itemName, remain, false);
                    if (result === -2) return { continue: true, remain }; // 盒子空了，換下一個
                    remain = result;
                    return { continue: false, remain };
                } else {
                    remain = await containerOperation.deposit(bot, container, itemName, -1, false);
                    return { continue: remain > 0, remain }; // 沒放完則繼續下一個
                }
            });

            if (!success && mode === 'withdraw') {
                this.log(bot, `無法處理箱子 ${itemName} 於 ${boxPos}`, 'ERROR');
            }
        }
        return remain;
    },

    /**
     * 處理溢出 (Overfull) 的存入
     */
    async processOverfull(bot, stationConfig, itemName) {
        if (!stationConfig.overfull) return;
        
        const boxPos = new Vec3(stationConfig.overfull[0], stationConfig.overfull[1], stationConfig.overfull[2]);
        const standPos = boxPos.plus(v(stationConfig.offset[stationConfig.overfull[3]]));
        const btnPos = boxPos.plus(v(stationConfig.offset[stationConfig.overfull[4]]));

        await this.operateBox(bot, stationConfig, boxPos, standPos, btnPos, async (container) => {
            await containerOperation.deposit(bot, container, itemName, -1, false);
            return { continue: false };
        });
    },

    /**
     * 通用的箱子操作流程 (包含尋路、檢查距離、補給站傳送、開啟)
     */
    async operateBox(bot, stationConfig, boxPos, standPos, btnPos, actionCallback) {
        // 1. 檢查距離，太遠則傳送
        if (standPos.distanceTo(bot.entity.position) > 100) {
            this.log(bot, `距離目標過遠，執行傳送: ${stationConfig.stationWarp}`);
            await mcFallout.warp(bot, stationConfig.stationWarp, 3000);
            await sleep(1000);
        }

        // 2. 尋路至站點
        let retry = 0;
        while (retry++ < 3) {
            await pathfinder.astarfly(bot, standPos, null, null, null, true);
            if (standPos.distanceTo(bot.entity.position) < 2) break;
            await sleep(200);
        }

        // 3. 開啟箱子 (含按鈕邏輯)
        let container = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            if (bot.blockAt(boxPos)?.name === 'air') {
                await bot.activateBlock(bot.blockAt(btnPos));
                await sleep(400);
            }
            
            container = await containerOperation.openContainerWithTimeout(bot, boxPos, 1500);
            if (container) break;
            await sleep(200);
        }

        if (!container) return false;

        // 4. 執行具體動作
        try {
            const result = await actionCallback(container);
            await container.close();
            return true;
        } catch (err) {
            this.log(bot, `執行箱子操作時出錯: ${err.message}`, 'ERROR');
            await container.close();
            return false;
        }
    },

    log(bot, message, level = 'INFO') {
        console.log(`[Station] [${level}] ${message}`);
    }
};

module.exports = station;
