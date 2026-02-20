const { Vec3 } = require('vec3');

/**
 * 空間索引管理器，用於加速實體查詢 (例如 Item Frame)
 */
class EntityIndexer {
  constructor(bot) {
    this.bot = bot;
    this.index = new Map(); // key: "x,y,z", value: entity
    this.types = new Set(['item_frame', 'glow_item_frame']);

    this._onEntitySpawn = this.onEntitySpawn.bind(this);
    this._onEntityDespawn = this.onEntityDespawn.bind(this);
    
    this.bot.on('entitySpawn', this._onEntitySpawn);
    this.bot.on('entityGone', this._onEntityDespawn);
  }

  /**
   * 建立座標 Key
   * @param {Vec3} pos 
   */
  getPosKey(pos) {
    return `${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`;
  }

  onEntitySpawn(entity) {
    if (this.types.has(entity.name)) {
      const key = this.getPosKey(entity.position);
      this.index.set(key, entity);
    }
  }

  onEntityDespawn(entity) {
    if (this.types.has(entity.name)) {
      const key = this.getPosKey(entity.position);
      if (this.index.get(key) === entity) {
        this.index.delete(key);
      }
    }
  }

  /**
   * 根據座標獲取實體 (O(1) 效率)
   * @param {Vec3} pos 
   * @returns {Object|null}
   */
  getEntityAt(pos) {
    const key = this.getPosKey(pos);
    return this.index.get(key) || null;
  }

  /**
   * 重新掃描所有實體並建立索引
   */
  rescan() {
    this.index.clear();
    for (const id in this.bot.entities) {
      this.onEntitySpawn(this.bot.entities[id]);
    }
  }

  destroy() {
    this.bot.removeListener('entitySpawn', this._onEntitySpawn);
    this.bot.removeListener('entityGone', this._onEntityDespawn);
    this.index.clear();
  }
}

module.exports = EntityIndexer;
