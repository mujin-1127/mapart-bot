const { sleep, promiseWithTimeout, v, checkStop } = require('./utils');
const { Vec3 } = require('vec3');
const pathfinder = require('./pathfinder');
const mcFallout = require('./mcFallout');

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
     * 從容器中提取指定數量物品 (強化版：自動判斷背包剩餘空間)
     */
    async withdraw(bot, container, id, count, dontlog = false, reserve = 0) {
        const { calculateAvailableSpace } = require('./utils');
        const mcData = require('minecraft-data')(bot.version);
        const itemInfo = typeof id === 'number' ? mcData.items[id] : mcData.itemsByName[id];
        
        if (!itemInfo) return count;
        const itemTypeId = itemInfo.id;
        const stackSize = itemInfo.stackSize || 64;
        
        // 1. 計算容器內現有數量
        const targetInContainer = this.countInWindow(container, 0, container.inventoryStart, itemTypeId);
        if (targetInContainer <= 0) return -2; // 盒子空了，通知上層換下一個

        // 2. 核心：計算背包可用空間 (單位：個數)
        let availableSpace = calculateAvailableSpace(bot, itemTypeId, container);
        
        // 扣除預留格數 (假設每格預留一疊)
        availableSpace = Math.max(0, availableSpace - (reserve * stackSize));

        if (availableSpace <= 0) {
            if (!dontlog) console.log(`[Container] 背包空間已滿，停止提取 ${itemInfo.name}`);
            return count;
        }

        // 3. 計算本次實際要拿多少
        let toWithdraw = count === -1 ? targetInContainer : Math.min(count, targetInContainer);
        
        // 根據背包空間上限進行截斷
        if (toWithdraw > availableSpace) {
            if (!dontlog) console.log(`[Container] 背包空間僅剩 ${availableSpace}，將原本目標 ${toWithdraw} 調整為 ${availableSpace}`);
            toWithdraw = availableSpace;
        }

        if (toWithdraw <= 0) return count;

        let remainAfterThisBox = count === -1 ? 0 : count - toWithdraw;

        try {
            // 執行提取 (帶重試)
            await withRetry(async () => {
                await container.withdraw(itemTypeId, null, toWithdraw, null);
            }, 3, 300);

            if (!dontlog) console.log(`[Container] \x1b[31m取出 x${toWithdraw} \x1b[36m${itemInfo.name}\x1b[0m`);
            
            return remainAfterThisBox;
        } catch (e) {
            console.log(`[Container] 提取失敗 (${itemInfo.name}): ${e.message}`);
            return count; 
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
            // 優先嘗試使用內建 deposit
            try {
                await withRetry(async () => {
                    await container.deposit(itemTypeId, null, toDeposit, null);
                }, 2, 200);
                if (!dontlog) console.log(`[Container] \x1b[32m放入 x${toDeposit} \x1b[36m${itemInfo.name}\x1b[0m`);
                return count === -1 ? 0 : count - toDeposit;
            } catch (e) {
                // 如果內建失敗，嘗試手動尋找槽位放入
                console.log(`[Container] 內建 deposit 失敗，切換為手動尋找槽位 (${e.message})`);
                const itemsInInv = container.items().filter(i => i.type === itemTypeId && i.slot >= container.inventoryStart);
                let depositedCount = 0;

                for (const item of itemsInInv) {
                    if (depositedCount >= toDeposit) break;
                    
                    // 尋找容器中的空位或可疊加位
                    let targetSlot = -1;
                    for (let i = 0; i < container.inventoryStart; i++) {
                        const slotItem = container.slots[i];
                        if (!slotItem) {
                            targetSlot = i;
                            break;
                        } else if (slotItem.type === itemTypeId && slotItem.count < slotItem.stackSize) {
                            targetSlot = i;
                            break;
                        }
                    }

                    if (targetSlot !== -1) {
                        const amount = Math.min(item.count, toDeposit - depositedCount);
                        await bot.clickWindow(item.slot, 0, 0);
                        await bot.clickWindow(targetSlot, 0, 0);
                        depositedCount += amount;
                        await sleep(500); // 增加延遲確保伺服器同步
                    } else {
                        break; // 容器滿了
                    }
                }

                if (!dontlog) console.log(`[Container] \x1b[32m手動放入 x${depositedCount} \x1b[36m${itemInfo.name}\x1b[0m`);
                return count === -1 ? 0 : count - depositedCount;
            }
        } catch (e) {
            console.log(`[Container] 放入失敗 (${itemInfo.name}): ${e.message}`);
            return toDeposit;
        }
    },

    /**
     * 強健的箱子操作流程 (含尋路、按鈕、重試)
     * @param {object} bot 
     * @param {object} stationConfig 
     * @param {Array} boxInfo [x, y, z, f, bf]
     * @param {Function} action 
     */
    async operateBox(bot, stationConfig, boxInfo, action) {
        if (checkStop(bot)) return false;
        if (!boxInfo || boxInfo.length < 3) return false;
        const boxPos = new Vec3(boxInfo[0], boxInfo[1], boxInfo[2]);
        const standPos = boxPos.plus(v(stationConfig.offset[boxInfo[3] || 'N']));
        const btnPos = boxPos.plus(v(stationConfig.offset[boxInfo[4] || 'bN']));

        // 1. 檢查距離，太遠則傳送
        if (standPos.distanceTo(bot.entity.position) > 100 && stationConfig.stationWarp) {
            if (checkStop(bot)) return false;
            await mcFallout.warp(bot, stationConfig.stationWarp, 3000);
            await sleep(1000);
        }

        // 2. 尋路
        for (let i = 0; i < 3; i++) {
            if (checkStop(bot)) return false;
            try {
                await pathfinder.astarfly(bot, standPos, null, null, null, true);
                if (bot.entity && standPos.distanceTo(bot.entity.position) < 2) break;
            } catch(e) {}
            await sleep(200);
        }
        
        // 3. 開啟邏輯
        let container = null;
        for (let attempt = 0; attempt < 5; attempt++) {
            if (checkStop(bot)) return false;
            const block = bot.blockAt(boxPos);
            if (!block || block.name === 'air') {
                const btnBlock = bot.blockAt(btnPos);
                if (btnBlock) {
                    await bot.activateBlock(btnBlock);
                    await sleep(500);
                }
            }
            container = await this.openContainerWithTimeout(bot, boxPos, 1500);
            if (container) break;
            await sleep(300);
        }

        if (!container) return false;

        try {
            if (checkStop(bot)) { await container.close(); return false; }
            const result = await action(container);
            await container.close();
            return result !== false;
        } catch (err) {
            console.error(`[Container] 操作失敗: ${err.message}`);
            try { await container.close(); } catch(e) {}
            return false;
        }
    }
};

module.exports = containerOperation;
