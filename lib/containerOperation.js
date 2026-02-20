const { sleep, promiseWithTimeout } = require('../lib/utils');
const { Vec3 } = require('vec3');

/**
 * 通用的重試包裝器
 */
async function withRetry(fn, retries = 3, delay = 500) {
    let lastError;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            if (i < retries - 1) await sleep(delay);
        }
    }
    throw lastError;
}

const containerOperation = {
    /**
     * 強健的物品計數器
     */
    countInWindow(window, start, end, itemTypeId) {
        let total = 0;
        for (let i = start; i < end; i++) {
            const item = window.slots[i];
            if (item && item.type === itemTypeId) {
                total += item.count;
            }
        }
        return total;
    },

    /**
     * 開啟容器
     */
    async openContainerWithTimeout(bot, containerVec3, timeout = 3000) {
        const block = bot.blockAt(containerVec3);
        if (!block) {
            console.log(`[Container] 目標位置 ${containerVec3} 沒有方塊`);
            return null;
        }

        try {
            return await withRetry(async () => {
                return await promiseWithTimeout(bot.openBlock(block), timeout);
            }, 3, 300);
        } catch (e) {
            console.log(`[Container] 無法開啟容器於 ${containerVec3}: ${e.message}`);
            return null;
        }
    },

    /**
     * 從容器中提取指定數量物品
     */
    async withdraw(bot, container, id, count, dontlog = false, reserve = 0) {
        const mcData = require('minecraft-data')(bot.version);
        const itemInfo = typeof id === 'number' ? mcData.items[id] : mcData.itemsByName[id];
        
        if (!itemInfo) return count;
        const itemTypeId = itemInfo.id;
        
        // 1. 計算容器內現有數量
        const targetInContainer = this.countInWindow(container, 0, container.inventoryStart, itemTypeId);
        if (targetInContainer <= 0) return -2; // 盒子空了，通知上層換下一個

        // 2. 計算本次要拿多少
        let toWithdraw = count === -1 ? targetInContainer : Math.min(count, targetInContainer);
        let remainAfterThisBox = count === -1 ? 0 : count - toWithdraw;

        // 3. 檢查背包空間
        let emptySlots = bot.inventory.emptySlotCount() - reserve;
        if (emptySlots < 1) {
            const hasStackable = bot.inventory.items().some(i => i.type === itemTypeId && i.count < i.stackSize);
            if (!hasStackable) {
                if (!dontlog) console.log('[Container] 背包空間不足');
                return count;
            }
        }

        try {
            // 執行提取 (帶重試)
            await withRetry(async () => {
                await container.withdraw(itemTypeId, null, toWithdraw, null);
            }, 3, 300);

            if (!dontlog) console.log(`[Container] \x1b[31m取出 x${toWithdraw} \x1b[36m${itemInfo.name}\x1b[0m`);
            
            // 直接回傳理論剩餘量，不再做二次校驗避免同步延遲誤判
            return remainAfterThisBox;
        } catch (e) {
            console.log(`[Container] 提取失敗 (${itemInfo.name}): ${e.message}`);
            return count; // 失敗則回傳原數量，觸發上層重試
        }
    },

    /**
     * 放入容器指定數量物品
     */
    async deposit(bot, container, id, count, dontlog = false) {
        const mcData = require('minecraft-data')(bot.version);
        const itemInfo = typeof id === 'number' ? mcData.items[id] : mcData.itemsByName[id];

        if (!itemInfo) return count;
        const itemTypeId = itemInfo.id;

        const inInv = this.countInWindow(container, container.inventoryStart, container.inventoryEnd, itemTypeId);
        let toDeposit = count === -1 ? inInv : Math.min(count, inInv);
        
        if (toDeposit <= 0) return 0;

        try {
            await withRetry(async () => {
                await container.deposit(itemTypeId, null, toDeposit, null);
            }, 3, 300);

            if (!dontlog) console.log(`[Container] \x1b[32m放入 x${toDeposit} \x1b[36m${itemInfo.name}\x1b[0m`);
            return count === -1 ? 0 : count - toDeposit;
        } catch (e) {
            console.log(`[Container] 放入失敗 (${itemInfo.name}): ${e.message}`);
            return toDeposit;
        }
    }
};

module.exports = containerOperation;
