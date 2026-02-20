const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))
const { Vec3 } = require('vec3')
const wait = () => new Promise(setImmediate)
const { once } = require('events')
const containerOperation = {
    /**
     * 
     */
    async openContainerWithTimeout(bot, containerVec3, timeout) {
        let block = bot.blockAt(containerVec3)
        if(!block){
            console.log("目標不可見")
            return null
        }
        let fail = false
        try{
			let result = await new Promise(async (res, rej) => {
				const to = setTimeout(()=>{
					fail = true;
					rej(new Error("開啟容器超時"))
				}, timeout)
                let ct = await bot.openBlock(block)
				if(!fail){
                    await sleep(30)
					res(ct)
				}
			})
            return result  // why not just return the promise?

		}catch(e){
            return null
		}
    },
    /**
     * 從容器中提取指定數量物品
     * @param  {object} bot - bot.
     * @param  {object} container - container實例.
     * @param  {(number|string)} id - id或name都可以.
     * @param {number} count - 數量
     * @param {boolean} dontlog - 不顯示信息
     * @param {number} reserve - 預留空間
     * @returns {number} - 未完成數量(如inv還夠)
     */
    async withdraw(bot, container, id, count, dontlog, reserve) {
        //count -1 to withdraw ALL
        //id -1 to withdraw ALL type 
        //console.log(container)
        const mcData = require('minecraft-data')(bot.version)
        let targerItem;
        let remain = 0;
        if (Number.isInteger(id)) targerItem = mcData.items[id];
        else targerItem = mcData.itemsByName[id];
        if (reserve == null || reserve == undefined) reserve = 0;
        if (dontlog == null || dontlog == undefined) dontlog = false;
        let targetItemInContainerCount = container.countRange(0, container.inventoryStart, targerItem.id, null);
        //console.log(`容器內有 ${targetItemInContainerCount}`);
        if (count > targetItemInContainerCount) {
            remain = count - targetItemInContainerCount;
            count = targetItemInContainerCount;
        }
        let withdrawNeedSlot = Math.ceil(count / targerItem.stackSize);
        let invEmptySlot = bot.inventory.emptySlotCount() - reserve;
        //console.log(`withdrawNeedSlot ${withdrawNeedSlot} invEmptySlot ${invEmptySlot}`);
        if (invEmptySlot < 1) {
            console.log('背包已滿 取消')
            return -1;
        }
        if (withdrawNeedSlot > invEmptySlot) {
            count = targerItem.stackSize * invEmptySlot;
            remain = 0;
        }
        try {
            if (count == 0) return -2; //盒內無
            // 用「目前開啟的 container 視窗」的玩家欄位數量，避免 bot.inventory 未同步
            const countInPlayerSlots = (c) => c.countRange(c.inventoryStart, c.inventoryEnd, targerItem.id, null);
            const countBefore = countInPlayerSlots(container);
            try {
                await container.withdraw(targerItem.id, null, count, null);
            } catch (error) {
                if (!dontlog) console.log(`\x1b[33m取出失敗 (${targerItem.name}):\x1b[0m`, error.message || error);
                return count + remain; // 未取得，全部當作未完成讓上層重試
            }
            await sleep(50);
            const countAfter = countInPlayerSlots(container);
            const actualReceived = countAfter - countBefore;
            if (actualReceived < count) {
                if (!dontlog) console.log(`\x1b[33m取出數量不足 ${targerItem.name}: 預期 ${count} 實際 ${actualReceived}\x1b[0m`);
                remain = remain + (count - actualReceived);
                if (!dontlog) console.log(`\x1b[31m取出 x${actualReceived} \x1b[36m${targerItem.name}\x1b[0m`);
            } else {
                if (!dontlog) console.log(`\x1b[31m取出 x${count} \x1b[36m${targerItem.name}\x1b[0m`);
            }
        } catch (e) {
            console.log('提取失敗 Reason:', e.message || e);
        }
        return remain;
    },
    /**
     * 放入容器指定數量物品
     * @param  {object} bot - bot.
     * @param  {object} container - container實例.
     * @param  {(number|string)} id - id或name都可以.
     * @param {number} count - 數量 (-1 全放)
     * @param {boolean} dontlog - 不顯示信息
     * @returns {number} - 未完成數量
     */
    async deposit(bot, container, id, count, dontlog) {
        //count -1 to deposit ALL
        //id -1 to deposit ALL type 
        const mcData = require('minecraft-data')(bot.version)
        let targerItem;
        let remain = 0;
        if (Number.isInteger(id)) targerItem = mcData.items[id];
        else targerItem = mcData.itemsByName[id];
        if (dontlog == null || dontlog == undefined) dontlog = false;
        //console.log(container)
        let targetItemInInvCount = container.countRange(container.inventoryStart, container.inventoryEnd, targerItem.id, null);
        let targetItemInContainerCount = container.countRange(0, container.inventoryStart, targerItem.id, null);
        if (count == -1) count = targetItemInInvCount;
        if (count == 0) return 0;
        else if (count > targetItemInInvCount) count = targetItemInInvCount;
        let maxCanDeposit = container.inventoryStart * targerItem.stackSize - targetItemInContainerCount;
        if (count > maxCanDeposit) {
            remain = count - maxCanDeposit;
            count = maxCanDeposit;
        }
        if (count <= 0) {
            console.log('盒子滿了')
            return -1;
        }
        try {
            await container.deposit(targerItem.id, null, count, null);
            if (!dontlog) console.log(`\x1b[32m放入 x${count} \x1b[36m${targerItem.name}\x1b[0m`);
        } catch (e) {
            console.log(`放入失敗 Reason: ${e}`)
            //console.log(e.stack)
        }
        return remain;
    },
}
module.exports = containerOperation 
