const path = require('path');
const fs = require('fs');

/**
 * 統一的日誌管理器，支援 Console 與後續擴展
 * 嚴格遵守 OCP：透過註冊不同的 Transport 進行擴展
 */
class Logger {
  constructor() {
    this.transports = [
      this.consoleTransport.bind(this)
    ];
    this.levels = {
      INFO: 'info',
      WARN: 'warn',
      ERROR: 'error',
      DEBUG: 'debug'
    };
  }

  /**
   * 註冊新的日誌輸出端 (Transport)
   * @param {Function} transportFn 接受 (level, message, meta) 的函式
   */
  registerTransport(transportFn) {
    this.transports.push(transportFn);
  }

  /**
   * 核心日誌記錄方法
   * @param {string} level 日誌等級
   * @param {string} message 訊息內容
   * @param {Object} [meta] 額外資訊
   */
  log(level, message, meta = {}) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}][${level}] ${message}`;
    
    this.transports.forEach(transport => {
      try {
        transport(level, formattedMessage, meta);
      } catch (err) {
        process.stderr.write(`Logger Transport Error: ${err.message}\n`);
      }
    });
  }

  info(message, meta) { this.log('INFO', message, meta); }
  warn(message, meta) { this.log('WARN', message, meta); }
  error(message, meta) { this.log('ERROR', message, meta); }
  debug(message, meta) { this.log('DEBUG', message, meta); }

  /**
   * 預設的 Console 輸出
   */
  consoleTransport(level, message, meta) {
    const colorMap = {
      INFO: '\x1b[32m',  // Green
      WARN: '\x1b[33m',  // Yellow
      ERROR: '\x1b[31m', // Red
      DEBUG: '\x1b[36m'  // Cyan
    };
    const reset = '\x1b[0m';
    const color = colorMap[level] || '';
    
    console.log(`${color}${message}${reset}`);
    if (meta && Object.keys(meta).length > 0 && level === 'DEBUG') {
      console.dir(meta, { depth: null });
    }
  }

  /**
   * 建立特定模組的日誌包裝器
   * @param {string} moduleName 模組名稱
   * @param {string} [botName] 機器人名稱
   * @returns {Object} 帶有模組前綴的日誌函式
   */
  module(moduleName, botName = '') {
    const prefix = botName ? `[${botName}][${moduleName}]` : `[${moduleName}]`;
    return {
      info: (msg, meta) => this.info(`${prefix} ${msg}`, meta),
      warn: (msg, meta) => this.warn(`${prefix} ${msg}`, meta),
      error: (msg, meta) => this.error(`${prefix} ${msg}`, meta),
      debug: (msg, meta) => this.debug(`${prefix} ${msg}`, meta),
      log: (showInConsole, level, msg) => {
        if (showInConsole) this.log(level, `${prefix} ${msg}`);
      }
    };
  }
}

// 匯出單例
module.exports = new Logger();
