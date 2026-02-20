const { readConfig, sleep, v } = require('../../../lib/utils');
const { Vec3 } = require('vec3');
const mcFallout = require('../../../lib/mcFallout');
const pathfinder = require('../../../lib/pathfinder');
const logger = require('../../../lib/logger').module('Mapart-Name');

module.exports = {
    name: "地圖畫 命名",
    identifier: ["name", "n"],
    vaild: true,
    longRunning: true,
    permissionRequre: 0,
    async execute(task) {
        const bot = task.bot;
        const mcData = require('minecraft-data')(bot.version);
        const bot_id = bot.bot_id || bot.username;
        const configPath = `${process.cwd()}/config/${bot_id}/mapart.json`;
        
        let mapart_name_cfg_cache = await readConfig(configPath);
        
        await mcFallout.warp(bot, mapart_name_cfg_cache["wrap"]["warp"]);
        await sleep(1000);
        bot.setQuickBarSlot(8);
        await bot.creative.flyTo(bot.entity.position.offset(0, 0.01, 0));
        bot._client.write("abilities", {
            flags: 2,
            flyingSpeed: 1.0,
            walkingSpeed: 1.0
        });

        const mp_origin = new Vec3(mapart_name_cfg_cache.wrap.origin[0], mapart_name_cfg_cache.wrap.origin[1], mapart_name_cfg_cache.wrap.origin[2]);
        const anvil_stand = new Vec3(mapart_name_cfg_cache.wrap.anvil_stand[0], mapart_name_cfg_cache.wrap.anvil_stand[1], mapart_name_cfg_cache.wrap.anvil_stand[2]);
        
        await pathfinder.astarfly(bot, anvil_stand);
        
        let maparts = [];
        const facing = mapart_name_cfg_cache["wrap"]["facing"];
        const mp_direction = getMpDirections();
        
        await pathfinder.astarfly(bot, mp_origin, null, null, null, true);
        
        for (let i = 0; i < mapart_name_cfg_cache["wrap"]["width"] * mapart_name_cfg_cache["wrap"]["height"]; i++) {
            let d_x = parseInt(i / mapart_name_cfg_cache["wrap"]["height"]);
            let d_y = i % mapart_name_cfg_cache["wrap"]["height"];
            let mps = {
                dx: d_x,
                dy: d_y,
                pos: mp_origin.offset(d_x * mp_direction[facing]["inc_dx"], d_y * mp_direction[facing]["inc_dy"], d_x * mp_direction[facing]["inc_dz"]),
                hasmap: false,
                mapid: undefined,
                named: false,
            };
            let currentIF = getItemFrame(bot, mps.pos);
            if (currentIF && currentIF?.metadata && currentIF?.metadata[8]?.itemId == mcData.itemsByName['filled_map'].id) {
                mps.hasmap = true;
                mps.mapid = currentIF.metadata[8].nbtData.value.map.value;
                mps.named = (currentIF.metadata[8].nbtData.value.display.value.Name) ? true : false;
            }
            maparts.push(mps);
        }

        for (let i = 0; i < maparts.length; i++) {
            let mps = maparts[i];
            if (!mps.hasmap || mps.named) continue;
            
            await pathfinder.astarfly(bot, mps.pos, null, null, null, true);
            await sleep(100);
            
            let itemFrame = getItemFrame(bot, mps.pos);
            if (!itemFrame) {
                logger.error(`mp_${mps.dx}_${mps.dy} 錯誤: 找不到 Item Frame`);
                continue;
            }
            
            logger.info(`取下 ${mps.dx}_${mps.dy}`);
            await bot.attack(itemFrame, false);
            
            try {
                await pickMapItem(bot, mps.mapid, mcData);
            } catch (e) {
                logger.error(`無法撿起地圖畫 ${mps.dx}_${mps.dy}: ${e.message}`);
            }
            
            await pathfinder.astarfly(bot, anvil_stand, null, null, null, true);
            await sleep(50);
            
            const anvilPos = new Vec3(mapart_name_cfg_cache.wrap.anvil[0], mapart_name_cfg_cache.wrap.anvil[1], mapart_name_cfg_cache.wrap.anvil[2]);
            let anvil = await bot.openAnvil(bot.blockAt(anvilPos));
            let it = getMapItemByMapIDInInventory(bot, mps.mapid);
            let tgname = mapart_name_cfg_cache["wrap"]["name"] ? `${mapart_name_cfg_cache["wrap"]["name"]} - ${mps.dx}-${mps.dy}` : `${mps.dx}-${mps.dy}`;
            
            logger.info(`命名 ${mps.dx}_${mps.dy} 為 ${tgname}`);
            await anvil.rename(it, tgname);
            await anvil.close();
            
            try {
                await pickMapItem(bot, mps.mapid, mcData);
            } catch (e) {
                logger.error(`無法取得地圖畫 ${mps.dx}_${mps.dy}: ${e.message}`);
            }
            
            let new_it = getMapItemByMapIDInInventory(bot, mps.mapid);
            let st = new_it.slot;
            await bot.simpleClick.leftMouse(st);
            await bot.simpleClick.leftMouse(44);
            await bot.simpleClick.leftMouse(st);
            
            let fail_c = 0;
            while (fail_c < 10) {
                await pathfinder.astarfly(bot, mps.pos, null, null, null, true);
                await sleep(50);
                let currentIF = getItemFrame(bot, mps.pos);
                if (!currentIF) {
                    await mcFallout.warp(bot, mapart_name_cfg_cache["wrap"]["warp"]);
                    continue;
                }
                
                logger.info(`放置 mp_${mps.dx}_${mps.dy}`);
                await bot.activateEntity(currentIF);
                await sleep(1000);
                let check = getItemFrame(bot, mps.pos);
                if (check && check.metadata[8]?.nbtData?.value?.map?.value == mps.mapid) {
                    break;
                }
                fail_c++;
            }
            logger.info(`${mps.dx}_${mps.dy} 完成`);
        }
    }
};

function getItemFrame(bot, tg_pos) {
    if (bot.entityIndexer) {
        return bot.entityIndexer.getEntityAt(tg_pos);
    }
    for (let etsIndex in bot.entities) {
        const entity = bot.entities[etsIndex];
        if (!(entity.name == 'glow_item_frame' || entity.name == 'item_frame')) continue;
        if (!entity.position.equals(tg_pos)) continue;
        return entity;
    }
    return null;
}

function getMapItemByMapIDInInventory(bot, mpID) {
    return bot.inventory.slots.find(item => item?.nbt?.value?.map?.value == mpID);
}

async function pickMapItem(bot, mpID, mcData) {
    let timeout = false;
    let to = setTimeout(() => { timeout = true; }, 15000);
    while (true) {
        if (timeout) break;
        let ck = getMapItemByMapIDInInventory(bot, mpID);
        if (ck) break;
        let et = bot.entities;
        for (let i in et) {
            if (et[i]?.name == 'item' && et[i]?.metadata[8]?.itemId == mcData.itemsByName['filled_map'].id && et[i]?.metadata[8].nbtData?.value?.map?.value == mpID) {
                const pos = et[i].onGround ? et[i].position.offset(-0.5, -1, -0.5) : et[i].position.offset(-0.5, 0, -0.5);
                await pathfinder.astarfly(bot, new Vec3(Math.round(pos.x), Math.round(pos.y), Math.round(pos.z)), null, null, null, true);
            }
        }
        await sleep(10);
    }
    if (timeout) throw new Error("撿起地圖畫超時");
    try { clearTimeout(to); } catch (e) { }
}

function getMpDirections() {
    return {
        "north": { "inc_dx": -1, "inc_dy": -1, "inc_dz": 0 },
        "south": { "inc_dx": 1, "inc_dy": -1, "inc_dz": 0 },
        "west": { "inc_dx": 0, "inc_dy": -1, "inc_dz": 1 },
        "east": { "inc_dx": 0, "inc_dy": -1, "inc_dz": -1 },
    };
}
