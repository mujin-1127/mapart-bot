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
 * 建立 Vec3 物件的輔助函式 (支援陣列或現有 Vec3)
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

module.exports = {
  sleep,
  readConfig,
  saveConfig,
  v,
  hashConfig,
  promiseWithTimeout,
  taskreply
};
