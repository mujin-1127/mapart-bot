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
    await fs.writeFile(filePath, JSON.stringify(data, null, '\t'), 'utf8');
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

module.exports = {
  sleep,
  readConfig,
  saveConfig,
  v,
  hashConfig,
  promiseWithTimeout
};
