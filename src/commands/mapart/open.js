const { readConfig, sleep, v, getItemFrame, moveToHotbar, getEmptySlots } = require('../../../lib/utils');
const { Vec3 } = require('vec3');
const mcFallout = require('../../../lib/mcFallout');
const pathfinder = require('../../../lib/pathfinder');
const logger = require('../../../lib/logger').module('Mapart-Open');

module.exports = {
    name: "地圖畫 開圖",
    identifier: ["open", "o"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const mcData = require('minecraft-data')(bot.version);
        const Item = require('prismarine-item')(bot.version);
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/global/mapart.json`;
        
        let mapart_open_cfg_cache = await readConfig(configPath);
        
        // 動態計算 worker_id 與 worker_count
        const botIds = mapart_open_cfg_cache.botIds || [];
        const workerIndex = botIds.indexOf(bot_id);
        
        if (workerIndex === -1) {
            logger.error(`目前機器人 (${bot_id}) 不在被指派的任務名單內！`);
            return;
        }
        
        mapart_open_cfg_cache.worker_id = workerIndex;
        mapart_open_cfg_cache.worker_count = botIds.length;

        if (!mapart_open_cfg_cache.schematic) {
            logger.error("尚未設定藍圖位置，請先使用 set 指令或在網頁端設定。");
            return;
        }

        let stationConfig;
        if (mapart_open_cfg_cache["materialsMode"] == 'station') {
            const stationFile = mapart_open_cfg_cache?.station || 'station.json';
            stationConfig = await readConfig(`${process.cwd()}/config/global/${stationFile}`);
        }

        await mcFallout.warp(bot, mapart_open_cfg_cache["open"]["warp"]);
        await sleep(100);
        bot.setQuickBarSlot(8);
        await bot.creative.flyTo(bot.entity.position.offset(0, 0.01, 0));
        bot._client.write("abilities", {
            flags: 2,
            flyingSpeed: 1.0,
            walkingSpeed: 1.0
        });

        const sx = Math.floor((Math.floor((bot.entity.position.x) / 16) - 4) / 8) * 8 * 16 + 64;
        const sz = Math.floor((Math.floor((bot.entity.position.z) / 16) - 4) / 8) * 8 * 16 + 64;
        const mapart_ori = new Vec3(sx + 1, mapart_open_cfg_cache["schematic"]["placementPoint_y"] - 2, sz);
        
        await pathfinder.astarfly(bot, mapart_ori.offset(0, 0, 3), null, null, null, false);
        
        let mpstate = [];
        // Init 檢查是否有未完成
        for (let dx = 0; dx < mapart_open_cfg_cache["open"]["width"]; dx++) {
            for (let dy = 0; dy < mapart_open_cfg_cache["open"]["height"]; dy++) {
                let csmp = {
                    skip: false,
                    x: dx,
                    y: dy,
                    z: 0,
                    mapartRealPos: new Vec3(sx + 128 * (dx * mapart_open_cfg_cache["open"]["height"] + dy), 256, sz),
                    pos: mapart_ori.offset(dx, 0 - dy, 0),
                    itemframe: false,
                    mapid: undefined,
                    finish: false,
                };
                let currentIF = getItemFrame(bot, csmp.pos);
                if (currentIF) csmp.itemframe = true;
                if (currentIF?.metadata && currentIF?.metadata[8]?.itemId == mcData.itemsByName['filled_map'].id) {
                    csmp.mapid = currentIF.metadata[8].nbtData.value.map.value;
                    csmp.finish = true;
                }
                mpstate.push(csmp);
            }
        }

        let blockToAdd = 'quartz_block';
        await moveToEmptySlot(bot, 44);
        for (let i = 0; i < mpstate.length;) {
            if (!bot.blockAt(mpstate[i].pos.offset(0, 0, -1))) {
                await pathfinder.astarfly(bot, mpstate[i].pos, null, null, null, false);
                await sleep(500);
                continue;
            }
            if (bot.blockAt(mpstate[i].pos.offset(0, 0, -1)).name == 'air') {
                if (!bot.inventory?.slots[44] || bot.inventory?.slots[44].name != blockToAdd) {
                    let invhasblockToAdd = -1;
                    for (let id = 9; id <= 43; id++) {
                        if (bot.inventory.slots[id]?.name == blockToAdd) {
                            invhasblockToAdd = id;
                            break;
                        }
                    }
                    if (invhasblockToAdd == -1) {
                        if (mapart_open_cfg_cache["materialsMode"] == 'station') {
                            await sleep(5000);
                            const station = require('../../../lib/station');
                            await station.restock(bot, stationConfig, [{ name: blockToAdd, count: 64 }]);
                            await sleep(500);
                            await mcFallout.warp(bot, mapart_open_cfg_cache["open"]["warp"]);
                            await sleep(2500);
                        }
                        continue;
                    } else {
                        await moveToHotbar(bot, invhasblockToAdd);
                        continue;
                    }
                }
                await pathfinder.astarfly(bot, mpstate[i].pos, null, null, null, true);
                await sleep(50);
                const packet = {
                    location: mpstate[i].pos.offset(0, 0, -1),
                    direction: 0,
                    heldItem: Item.toNotch(bot.heldItem),
                    cursorX: 0.5,
                    cursorY: 0.5,
                    cursorZ: 0.5
                };
                bot._client.write('block_place', packet);
                await sleep(100);
                continue;
            }
            i++;
        }
        
        logger.info("開圖指令執行完成");
    }
};

async function moveToEmptySlot(bot, slot) {
    let emptySlots = getEmptySlots(bot);
    if (emptySlots.length == 0) {
        throw new Error("Can't find empty slot to use");
    }
    await bot.simpleClick.leftMouse(slot);
    await bot.simpleClick.leftMouse(emptySlots[0]);
}
