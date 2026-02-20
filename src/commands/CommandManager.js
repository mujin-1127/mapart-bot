/**
 * 統一的指令管理器
 * 嚴格遵守 OCP：透過註冊 Command 物件來擴展功能，不需要修改此檔案。
 */
class CommandManager {
  constructor() {
    this.commands = new Map();
    this.prefixes = new Set();
  }

  /**
   * 註冊指令前綴 (例如 mapart, mp)
   * @param {string|string[]} prefix 
   */
  registerPrefix(prefix) {
    if (Array.isArray(prefix)) {
      prefix.forEach(p => this.prefixes.add(p.toLowerCase()));
    } else {
      this.prefixes.add(prefix.toLowerCase());
    }
  }

  /**
   * 註冊指令物件
   * @param {Object} cmd 指令定義
   * @param {string} cmd.name 指令名稱
   * @param {string[]} cmd.identifier 觸發字串陣列
   * @param {Function} cmd.execute 執行函式
   */
  registerCommand(cmd) {
    cmd.identifier.forEach(id => {
      this.commands.set(id.toLowerCase(), cmd);
    });
  }

  /**
   * 判斷是否為已註冊的前綴
   * @param {string} prefix 
   */
  isPrefix(prefix) {
    return this.prefixes.has(prefix?.toLowerCase());
  }

  /**
   * 分發並執行指令
   * @param {Object} bot Mineflayer bot 實例
   * @param {string[]} args 指令參數陣列 (例如 ['set', 'file.nbt'])
   * @param {Object} context 任務上下文 (source, user 等)
   */
  async dispatch(bot, args, context) {
    if (args.length === 0) return false;
    
    const subCommand = args[0].toLowerCase();
    const cmd = this.commands.get(subCommand);
    
    if (!cmd) return false;

    const task = {
      ...context,
      content: args, // 這裡保持相容性，傳入完整的 args
      bot
    };

    try {
      await cmd.execute(task);
      return true;
    } catch (error) {
      throw error;
    }
  }
}

module.exports = new CommandManager();
