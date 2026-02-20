const { sleep, promiseWithTimeout } = require('../lib/utils');
const { Vec3 } = require('vec3');

/**
 * 通用的重試包裝器
 * @param {Function} fn - 要執行的非同步函式
 * @param {number} retries - 最大重試次數
 * @param {number} delay - 重試間隔 (ms)
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
     * 開啟容器並具備超時機制與重試
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
     * 從容器中提取指定數量物品 (具備重試)
     */
    async withdraw(bot, container, id, count, dontlog = false, reserve = 0) {
        const mcData = require('minecraft-data')(bot.version);
        let targetItem = typeof id === 'number' ? mcData.items[id] : mcData.itemsByName[id];
        
        if (!targetItem) {
            console.log(`[Container] 找不到物品 ID/名稱: ${id}`);
            return count;
        }

        let targetInContainer = container.countRange(0, container.inventoryStart, targetItem.id, null);
        let toWithdraw = Math.min(count, targetInContainer);
        let remain = count - toWithdraw;

        if (toWithdraw <= 0) return remain;

        // 背包空間檢查
        let emptySlots = bot.inventory.emptySlotCount() - reserve;
        if (emptySlots < 1) {
            if (!dontlog) console.log('[Container] 背包空間不足');
            return count;
        }

        // 限制提取量不超過剩餘背包空間
        let maxWithdraw = targetItem.stackSize * emptySlots;
        if (toWithdraw > maxWithdraw) {
            remain += (toWithdraw - maxWithdraw);
            toWithdraw = maxWithdraw;
        }

        try {
            const countInPlayerSlots = (c) => c.countRange(c.inventoryStart, c.inventoryEnd, targetItem.id, null);
            const before = countInPlayerSlots(container);

            await withRetry(async () => {
                await container.withdraw(targetItem.id, null, toWithdraw, null);
            }, 3, 200);

            await sleep(50);
            const after = countInPlayerSlots(container);
            const actual = after - before;

            if (!dontlog) {
                if (actual < toWithdraw) {
                    console.log(`[Container] \x1b[33m提取量不足 (${targetItem.name}): 預期 ${toWithdraw} 實際 ${actual}\x1b[0m`);
                } else {
                    console.log(`[Container] \x1b[31m取出 x${actual} \x1b[36m${targetItem.name}\x1b[0m`);
                }
            }
            return remain + (toWithdraw - actual);
        } catch (e) {
            console.log(`[Container] 提取失敗 (${targetItem.name}): ${e.message}`);
            return count;
        }
    },

    /**
     * 放入容器指定數量物品 (具備重試)
     */
    async deposit(bot, container, id, count, dontlog = false) {
        const mcData = require('minecraft-data')(bot.version);
        let targetItem = typeof id === 'number' ? mcData.items[id] : mcData.itemsByName[id];

        if (!targetItem) return count;

        let inInv = container.countRange(container.inventoryStart, container.inventoryEnd, targetItem.id, null);
        let toDeposit = count === -1 ? inInv : Math.min(count, inInv);
        
        if (toDeposit <= 0) return 0;

        // 容器空間檢查 (簡化版：檢查容器是否有空位或可堆疊)
        // 這裡暫時維持原邏輯，主要加強重試
        try {
            await withRetry(async () => {
                await container.deposit(targetItem.id, null, toDeposit, null);
            }, 3, 200);

            if (!dontlog) console.log(`[Container] \x1b[32m放入 x${toDeposit} \x1b[36m${targetItem.name}\x1b[0m`);
            return count === -1 ? 0 : count - toDeposit;
        } catch (e) {
            console.log(`[Container] 放入失敗 (${targetItem.name}): ${e.message}`);
            return toDeposit;
        }
    }
};

module.exports = containerOperation;
