const fs = require('fs').promises;
const crypto = require('crypto');
const { Vec3 } = require('vec3');

/**
 * 非阻塞延遲函式
 * @param {number} ms 延遲毫秒數
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 讀取並解析 JSON 設定檔
 * @param {string} filePath 檔案路徑
 * @returns {Promise<Object>} 解析後的物件
 */
async function readConfig(filePath) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    throw new Error(`讀取設定檔失敗 [${filePath}]: ${error.message}`);
  }
}

/**
 * 將物件儲存為 JSON 設定檔
 * @param {string} filePath 檔案路徑
 * @param {Object} data 要儲存的物件
 * @returns {Promise<void>}
 */
async function saveConfig(filePath, data) {
  try {
    // 先轉成標準 JSON 字串
    let json = JSON.stringify(data, null, 2);
    
    // 美化排版：將簡單的數值陣列或座標陣列（例如 [0, 1, 2]）合併回同一行
    // 處理 [0, 1, -3] 這種純數字陣列
    json = json.replace(/\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+)\s+\]/g, '[$1, $2, $3]');
    
    // 處理材料清單中的小型座標陣列 ["name", [x, y, z, "f", "bf"]]
    // 這裡針對材料格式 [x, y, z, "dir", "btn"] 進行收縮
    json = json.replace(/\[\s+(-?\d+),\s+(-?\d+),\s+(-?\d+),\s+"([^"]+)",\s+"([^"]+)"\s+\]/g, '[$1, $2, $3, "$4", "$5"]');
    
    // 處理材料最外層的包裹陣列，讓它看起來更緊湊
    json = json.replace(/\[\s+"([^"]+)",\s+\[/g, '["$1", [');

    await fs.writeFile(filePath, json, 'utf8');
  } catch (error) {
    throw new Error(`儲存設定檔失敗 [${filePath}]: ${error.message}`);
  }
}

/**
 * 建立 Vec3 物件的輔助函式 (支援陣列 or 現有 Vec3)
 * @param {Array|Object} vec 座標資料
 * @returns {Vec3}
 */
function v(vec) {
  if (Array.isArray(vec)) return new Vec3(vec[0], vec[1], vec[2]);
  if (vec instanceof Vec3) return vec;
  if (typeof vec === 'object' && vec !== null) return new Vec3(vec.x || 0, vec.y || 0, vec.z || 0);
  return new Vec3(0, 0, 0);
}

/**
 * 對設定物件進行雜湊處理，用於快取檢查
 * @param {Object} cfg 設定物件
 * @returns {string} SHA-256 雜湊值
 */
function hashConfig(cfg) {
  const str = JSON.stringify(cfg);
  return crypto.createHash('sha256').update(str).digest('hex');
}

/**
 * 帶有逾時機制的 Promise 包裝
 * @param {Promise} promise 原始 Promise
 * @param {number} ms 逾時毫秒數
 * @param {string} [errorMessage] 自定義錯誤訊息
 * @returns {Promise}
 */
function promiseWithTimeout(promise, ms, errorMessage = '操作超時') {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), ms)
  );
  return Promise.race([promise, timeout]);
}

/**
 * 統一的任務回覆函式
 * @param {Object} task 任務物件
 * @param {string} mcMsg 遊戲內訊息
 * @param {string} consoleMsg 控制台訊息
 * @param {Object} [options] 額外參數
 */
async function taskreply(task, mcMsg, consoleMsg, options = null) {
  const bot = task.bot;
  const source = task.source;
  const minecraftUser = task.minecraftUser;

  // 1. 控制台輸出
  if (consoleMsg) {
    console.log(`[${source}] ${consoleMsg}`);
  }

  // 2. 遊戲內回覆
  if (mcMsg) {
    if (source === 'minecraft-dm' && minecraftUser) {
      bot.chat(`/m ${minecraftUser} ${mcMsg}`);
    } else if (source === 'console' || source === 'web') {
      // Console 來源通常不需要再用 bot.chat 回傳，以免洗版
    } else {
      bot.chat(mcMsg);
    }
  }
}

/**
 * 清理機器人背包中的剩餘建築材料
 * @param {object} bot Mineflayer bot 實例
 * @param {object} logger 日誌實例
 */
async function clearInventory(bot, logger = console) {
    const itemsToDrop = bot.inventory.items().filter(item => 
        item.name.includes('carpet') || 
        item.name.includes('concrete') || 
        item.name.includes('wool') ||
        item.name.includes('terracotta') ||
        item.name.includes('glass')
    );
    if (itemsToDrop.length > 0) {
        if (logger.info) logger.info(`正在清理背包中剩餘的 ${itemsToDrop.length} 堆建築材料...`);
        else logger.log(`正在清理背包中剩餘的 ${itemsToDrop.length} 堆建築材料...`);
        
        for (const item of itemsToDrop) {
            try {
                await bot.tossStack(item);
                await sleep(50);
            } catch (e) {}
        }
        await sleep(500);
    }
}

/**
 * 將物品移動到快捷列最後一格 (Slot 8 / Index 44)
 * @param {object} bot Mineflayer bot 實例
 * @param {number} slot 來源槽位索引
 * @param {number} hotbarIndex 快捷列槽位索引 (預設 44 為第 8 格)
 */
async function moveToHotbar(bot, slot, hotbarIndex = 44) {
    try {
        await bot.simpleClick.leftMouse(slot);
        await bot.simpleClick.leftMouse(hotbarIndex);
        await bot.simpleClick.leftMouse(slot);
    } catch (e) {
        throw new Error(`移動物品至快捷列失敗: ${e.message}`);
    }
}

/**
 * 強制同步並等待直到手中拿起指定物品
 * @param {object} bot Mineflayer bot 實例
 * @param {string} itemName 物品名稱
 * @param {number} timeout 最大等待時間 (ms)
 */
async function syncHeldItem(bot, itemName, timeout = 1500) {
    let waitTime = 0;
    while (waitTime < timeout) {
        bot.updateHeldItem();
        if (bot.heldItem && bot.heldItem.name === itemName) return true;
        await sleep(50);
        waitTime += 50;
    }
    return false;
}

/**
 * 尋找指定座標處的物品展示框 (Item Frame / Glow Item Frame)
 */
function getItemFrame(bot, tg_pos) {
    if (bot.entityIndexer) {
        return bot.entityIndexer.getEntityAt(tg_pos);
    }
    for (const etsIndex in bot.entities) {
        const entity = bot.entities[etsIndex];
        if (!(entity.name === 'glow_item_frame' || entity.name === 'item_frame')) continue;
        if (!entity.position.equals(tg_pos)) continue;
        return entity;
    }
    return null;
}

/**
 * 獲取地圖畫方向對應的增量
 */
function getMpDirections() {
    return {
        "north": { "inc_dx": -1, "inc_dy": -1, "inc_dz": 0 },
        "south": { "inc_dx": 1, "inc_dy": -1, "inc_dz": 0 },
        "west": { "inc_dx": 0, "inc_dy": -1, "inc_dz": 1 },
        "east": { "inc_dx": 0, "inc_dy": -1, "inc_dz": -1 },
    };
}

/**
 * 獲取背包中的空白槽位
 */
function getEmptySlots(bot) {
    let result = [];
    for (let i = 9; i < 44; i++) {
        if (!bot.inventory.slots[i]) {
            result.push(i);
        }
    }
    return result;
}

/**
 * 背包內容日誌輸出
 */
async function logInventory(bot, logger = console) {
    const items = bot.inventory.items();
    let msg = `\n============= [${bot.username}] 目前背包內容 =============\n`;
    if (items.length === 0) {
        msg += `背包是空的\n`;
    } else {
        const summary = {};
        items.forEach(item => { summary[item.name] = (summary[item.name] || 0) + item.count; });
        Object.entries(summary).sort().forEach(([name, count]) => {
            msg += `${name.padEnd(25)}: x${count.toString().padEnd(4)} (${Math.ceil(count/64)} 組)\n`;
        });
    }
    msg += `==============================================================\n`;
    if (logger.info) logger.info(msg);
    else logger.log(msg);
}

module.exports = {
    sleep,
    readConfig,
    saveConfig,
    v,
    hashConfig,
    promiseWithTimeout,
    taskreply,
    clearInventory,
    moveToHotbar,
    syncHeldItem,
    getItemFrame,
    getMpDirections,
    getEmptySlots,
    logInventory,
    calculateAvailableSpace,
    checkStop
};

/**
 * 檢查機器人是否已被下達中止指令
 * @param {object} bot Mineflayer bot 實例
 * @param {object} [logger] 日誌實例，提供時若中止會輸出資訊
 * @returns {boolean} 是否應中止
 */
function checkStop(bot, logger = null) {
    // 1. 檢查斷線狀態
    if (!bot || !bot.entity || (bot._client && bot._client.state !== 'play')) {
        if (logger) {
            if (logger.info) logger.info("機器人已斷線，終止目前流程。");
            else console.log("機器人已斷線，終止目前流程。");
        }
        return true;
    }

    // 2. 檢查中止信號
    if (bot._litematicState && bot._litematicState.stop) {
        if (logger) {
            if (logger.info) logger.info("檢測到中止信號，停止目前流程。");
            else console.log("檢測到中止信號，停止目前流程。");
        }
        
        // 發送中止事件給前端觸發提示音 (僅發送一次)
        if (!bot._litematicState._stopEventEmitted) {
            bot._litematicState._stopEventEmitted = true;
            if (bot.centralWebServer) {
                bot.centralWebServer.io.emit('task_interrupted', {
                    botId: bot.bot_id || bot.username,
                    message: "流程已被中止"
                });
            }
        }
        return true;
    }
    return false;
}

/**
 * 計算指定物品在目前視窗（或背包）中的可用空間
 * @param {object} bot Mineflayer bot 實例
 * @param {string|number} itemType 物品名稱或 ID
 * @param {object} [window] 指定視窗，若未提供則使用 bot.inventory
 * @returns {number} 可用空間（物品個數）
 */
function calculateAvailableSpace(bot, itemType, window = null) {
    const mcData = require('minecraft-data')(bot.version);
    const itemInfo = typeof itemType === 'number' ? mcData.items[itemType] : mcData.itemsByName[itemType];
    if (!itemInfo) return 0;

    const itemTypeId = itemInfo.id;
    const stackSize = itemInfo.stackSize || 64;
    const targetWindow = window || bot.inventory;
    
    // 判定槽位範圍 (Mineflayer inventory 的 slots 包含快捷列等)
    const start = targetWindow.inventoryStart || 0;
    const end = targetWindow.inventoryEnd || targetWindow.slots.length;

    let availableSpace = 0;
    for (let i = start; i < end; i++) {
        const item = targetWindow.slots[i];
        if (!item) {
            availableSpace += stackSize;
        } else if (item.type === itemTypeId) {
            availableSpace += Math.max(0, stackSize - item.count);
        }
    }
    return availableSpace;
}
