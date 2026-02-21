const { readConfig, saveConfig, taskreply } = require('../../../lib/utils');
const fs = require('fs');
const path = require('path');

module.exports = {
    name: "地圖畫 設定",
    identifier: ["set"],
    vaild: true,
    longRunning: false,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        let mapart_set_cache = await readConfig(configPath);
        
        const filePath = task.content[1];
        if (!fs.existsSync(filePath)) {
            await taskreply(task,
                `&7[&bMP&7] &c未發現投影 &7${filePath} &r請重新輸入`,
                `未發現投影 請重新輸入\n路徑: ${filePath}`,
                null,
            );
            return;
        }
        
        mapart_set_cache.schematic.filename = filePath;
        
        // 如果有提供座標才更新，否則保留舊有座標
        if (task.content[2] !== undefined) mapart_set_cache.schematic.placementPoint_x = parseInt(task.content[2]);
        if (task.content[3] !== undefined) mapart_set_cache.schematic.placementPoint_y = parseInt(task.content[3]);
        if (task.content[4] !== undefined) mapart_set_cache.schematic.placementPoint_z = parseInt(task.content[4]);
        
        // 只有在更新了 X 座標的情況下才進行檢查
        if (task.content[2] !== undefined && Math.abs(mapart_set_cache.schematic.placementPoint_x + 64) % 128 != 0) {
            await taskreply(task,
                `&7[&bMP&7] &cX座標可能錯了`,
                `X座標可能錯了`,
                null,
            );
            return;
        }
        
        try {
            await saveConfig(configPath, mapart_set_cache);
        } catch (e) {
            await taskreply(task,
                `&7[&bMP&7] &c設置失敗`,
                `設置失敗 ${e}`,
                null,
            );
            return;
        }
        
        await taskreply(task,
            `&7[&bMP&7] &a設置成功`,
            `設置成功`,
            null,
        );
    }
}
