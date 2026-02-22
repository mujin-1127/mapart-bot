const mcFallout = require('../../../lib/mcFallout');
const { readConfig, taskreply } = require('../../../lib/utils');
const path = require('path');

module.exports = {
  name: '傳送',
  identifier: ['tp', 'warp'],
  async execute(task) {
    const { bot, content } = task;
    let warpName = content[1];

    // 如果沒有提供傳送點名稱，嘗試從設定檔讀取
    if (!warpName) {
      try {
        const botCfg = bot.mapartState?.cfg;
        const stationFile = botCfg?.station || 'station.json';
        const stationPath = path.join(process.cwd(), 'config/global', stationFile);
        const stationConfig = await readConfig(stationPath);
        warpName = stationConfig.stationWarp;
      } catch (e) {
        // 忽略讀取錯誤，後續會處理 warpName 為空的情況
      }
    }

    // 最終備位方案
    warpName = warpName || '繪圖機';
    
    await taskreply(task, 
      `&7[&bMP&7] &e正在傳送至 &f${warpName}&e...`,
      `正在傳送至 ${warpName}...`
    );

    try {
      await mcFallout.warp(bot, warpName, 5000, 3);
    } catch (e) {
      await taskreply(task, 
        `&7[&bMP&7] &c傳送失敗: ${e.message}`,
        `傳送失敗: ${e.message}`
      );
    }
  }
};
