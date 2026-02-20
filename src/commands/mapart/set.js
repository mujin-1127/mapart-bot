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
        // 這邊需要全域設定，可以從 bot 或外部傳入
        const mapart_global_cfg = await readConfig(`${process.cwd()}/config/global/mapart.json`);
        
        if (!fs.existsSync(mapart_global_cfg.schematic_folder + task.content[2])) {
            await taskreply(task,
                `&7[&bMP&7] &c未發現投影 &7${task.content[2]} &r請重新輸入`,
                `未發現投影 請重新輸入\n資料夾: ${mapart_global_cfg.schematic_folder}\n檔案: ${task.content[2]}`,
                null,
            );
            return;
        }
        
        mapart_set_cache.schematic.filename = task.content[2];
        mapart_set_cache.schematic.placementPoint_x = parseInt(task.content[3]);
        mapart_set_cache.schematic.placementPoint_y = parseInt(task.content[4]);
        mapart_set_cache.schematic.placementPoint_z = parseInt(task.content[5]);
        
        if (Math.abs(mapart_set_cache.schematic.placementPoint_x + 64) % 128 != 0) {
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
