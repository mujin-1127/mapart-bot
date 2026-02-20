const BasePrinter = require('./BasePrinter');
const { sleep, readConfig, saveConfig, v, hashConfig } = require('../utils');
const { Vec3 } = require('vec3');
const fs = require('fs');
const pathfinder = require('../pathfinder');
const schematic = require('../schematic');
const station = require('../station');
const globalLogger = require('../logger');

class MapartPrinter extends BasePrinter {
    constructor() {
        super();
        this.name = 'mapart';
        this.BLOCK_EXCLUDE_LIST = ["air", "cave_air", "cobblestone"];
        this.build_check_cooldown = 2000;
    }

    log(bot, showInConsole, level, msg) {
        const logger = globalLogger.module('Printer-Mapart');
        if (showInConsole) logger.log(level, msg);
    }

    async build(task, bot, cfg, project, sharedState) {
        const Item = require('prismarine-item')(bot.version);
        const mcData = require('minecraft-data')(bot.version);
        const needFirstBuildList = ['air', 'cobblestone', 'glass'];
        const debug_enable = bot.debugMode;
        
        const crt_cfg_hash = hashConfig(cfg.schematic);
        const buildCachePath = `${process.cwd()}/config/${cfg.bot_id}/build_cache.json`;
        
        let build_cache = sharedState.build_cache;
        if (!fs.existsSync(buildCachePath)) {
            await saveConfig(buildCachePath, build_cache);
        } else {
            build_cache = await readConfig(buildCachePath);
            sharedState.build_cache = build_cache;
        }

        let stationConfig;
        if (cfg.materialsMode === 'station') {
            this.log(bot, true, "INFO", `加載材料站資訊...`);
            stationConfig = await readConfig(`${process.cwd()}/config/global/${cfg.station}`);
            this.log(bot, true, "INFO", `材料站 ${stationConfig.stationName} 加載成功`);
        }

        let targetSch = project || await schematic.loadFromFile(cfg.schematic.folder + cfg.schematic.filename);

        if (build_cache.hash !== crt_cfg_hash) {
            Object.assign(build_cache, {
                hash: crt_cfg_hash,
                placedBlock: 0,
                totalBlocks: targetSch.Metadata.TotalBlocks,
                currentPalette: 0,
                startTime: Date.now(),
                endTime: -1,
                useTime: -1,
                origin: new Vec3(0, 0, 0),
                destination: new Vec3(0, 0, 0).plus(targetSch.Metadata.EnclosingSize).offset(-1, -1, -1),
                placement_origin: new Vec3(cfg.schematic.placementPoint_x, cfg.schematic.placementPoint_y, cfg.schematic.placementPoint_z),
                debug: { discconnectCount: 0, findNextTotalCounter: 0, restock_count: 0, restock_takeTime: 0, placeCount: 0, temp: 0 }
            });
            build_cache.placement_destination = build_cache.placement_origin.plus(build_cache.destination);
        } else {
            build_cache.debug.discconnectCount++;
            ['origin', 'destination', 'placement_origin', 'placement_destination'].forEach(k => build_cache[k] = v(build_cache[k]));
        }

        if (build_cache.endTime !== -1) return 'finish';

        this.log(bot, true, "INFO", `開始建造 ${targetSch.Metadata.Name}`);
        targetSch.toMineflayerID();

        // 核心邏輯
        for (const i in cfg.replaceMaterials) {
            targetSch.changeMaterial(cfg.replaceMaterials[i][0], cfg.replaceMaterials[i][1]);
        }

        let materialListForSch = Array(targetSch.palette.length).fill(0);
        let IgnoreAirArray = [];
        for (let i = 0; i < targetSch.Metadata.TotalVolume; i++) {
            let p = targetSch.getBlockPIDByIndex(i);
            if (p != 0) {
                IgnoreAirArray.push(i);
                materialListForSch[parseInt(p)]++;
            }
        }

        let sch_palette_order = [];
        let cobblestoneIndex = [];
        for (const i in targetSch.palette) {
            sch_palette_order.push(i);
            if (needFirstBuildList.includes(targetSch.palette[i].Name)) {
                cobblestoneIndex.push(i);
            }
        }
        let f_tmp = [];
        for (let i = cobblestoneIndex.length - 1; i >= 0; i--) {
            let temp = sch_palette_order.splice(cobblestoneIndex[i], 1);
            f_tmp.push(temp[0]);
        }
        for (let i = 0; i < f_tmp.length; i++) {
            sch_palette_order.unshift(f_tmp[i]);
        }

        await saveConfig(buildCachePath, build_cache);
        
        bot._client.write("abilities", { flags: 6, flyingSpeed: 1.0, walkingSpeed: 1.0 });
        await bot.creative.flyTo(bot.entity.position.offset(0, 0.01, 0));
        bot.setQuickBarSlot(8);

        let wheatherGetPalette = false;
        let Block_In_CD = [];
        let removeTimerID = [];
        let currentPaletteBlocksIndexs = [];
        let currentPaletteBlocksState = [];
        let currentPaletteName;
        let selectBlockIndex = 0;
        let changeCD = false;

        const updateVisited = (oldBlock, newBlock) => {
            const updatePos = newBlock.position;
            if (!this.pos_in_box(updatePos, build_cache.placement_origin, build_cache.placement_destination)) return;
            let r_update_pos = updatePos.minus(build_cache.placement_origin);
            let targetIndex = targetSch.index(r_update_pos.x, r_update_pos.y, r_update_pos.z);
            let qindex = currentPaletteBlocksIndexs.indexOf(targetIndex);
            if (qindex !== -1 && currentPaletteName == newBlock.name) {
                if (currentPaletteBlocksState[qindex] == 0) {
                    currentPaletteBlocksState[qindex] = 1;
                    build_cache.placedBlock++;
                }
            }
        };

        bot.on('blockUpdate', updateVisited);

        try {
            while (build_cache.currentPalette < targetSch.palette.length) {
                if (sharedState.stop) return 'stopped';
                if (sharedState.pause) { await sleep(500); continue; }

                if (!wheatherGetPalette) {
                    Block_In_CD = [];
                    removeTimerID.forEach(clearTimeout);
                    removeTimerID = [];
                    currentPaletteBlocksIndexs = [];
                    currentPaletteBlocksState = [];
                    currentPaletteName = targetSch.palette[sch_palette_order[build_cache.currentPalette]].Name;
                    
                    this.log(bot, false, 'INFO', `當前材料: ${currentPaletteName} ${build_cache.currentPalette + 1}/${targetSch.palette.length}`);
                    
                    if (this.BLOCK_EXCLUDE_LIST.includes(currentPaletteName)) {
                        build_cache.currentPalette++;
                        continue;
                    }

                    for (let i = 0; i < IgnoreAirArray.length; i++) {
                        if (targetSch.getBlockPIDByIndex(IgnoreAirArray[i]) == sch_palette_order[build_cache.currentPalette]) {
                            currentPaletteBlocksIndexs.push(IgnoreAirArray[i]);
                            currentPaletteBlocksState.push(0);
                        }
                    }
                    selectBlockIndex = 0;
                    await saveConfig(buildCachePath, build_cache);
                    wheatherGetPalette = true;
                }

                // 尋找最近的下一個點 (尋路優化)
                let deubg_startFNext = Date.now();
                let minDistance = Infinity;
                let nearestIndex = -1;
                let botPos = bot.entity.position;

                // 為了效能，我們只檢查前 1000 個未完成的點，或者做局部搜尋
                // 但地圖畫單種材料通常不多，直接全掃描距離也還可以接受
                for (let i = 0; i < currentPaletteBlocksIndexs.length; i++) {
                    if (currentPaletteBlocksState[i] === 0 && Block_In_CD.indexOf(i) === -1) {
                        let blockPos = targetSch.vec3(currentPaletteBlocksIndexs[i]).plus(build_cache.placement_origin);
                        
                        // 檢查是否已經蓋好了 (可能被身邊連帶蓋到)
                        if (bot.blockAt(blockPos)?.name === currentPaletteName) {
                            currentPaletteBlocksState[i] = 1;
                            build_cache.placedBlock++;
                            continue;
                        }

                        let dist = botPos.distanceSquared(blockPos);
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestIndex = i;
                        }
                        // 如果距離已經很近了 (在身邊)，直接選它
                        if (dist < 16) {
                            nearestIndex = i;
                            break;
                        }
                    }
                }
                build_cache.debug.findNextTotalCounter += (Date.now() - deubg_startFNext);

                if (nearestIndex === -1) {
                    build_cache.currentPalette++;
                    wheatherGetPalette = false;
                    continue;
                }

                selectBlockIndex = nearestIndex;
                let selectBlockRelativePos = targetSch.vec3(currentPaletteBlocksIndexs[selectBlockIndex]);
                let selectBlockAbsolutePos = build_cache.placement_origin.plus(selectBlockRelativePos);
                let selectBlockBotStandPos = selectBlockAbsolutePos.offset(0, 2, 0);

                await pathfinder.astarfly(bot, selectBlockBotStandPos, null, null, null, true);
                
                let botEyePosition = bot.entity.position.plus(new Vec3(0, 1.6, 0));
                for (let cP_dz = -4; cP_dz <= 4; cP_dz++) {
                    for (let cP_dx = -4; cP_dx <= 4; cP_dx++) {
                        for (let cP_dy = 5; cP_dy >= -3; cP_dy--) {
                            if (sharedState.pause || sharedState.stop) break;
                            
                            let dRelativePos = selectBlockRelativePos.offset(cP_dx, cP_dy, cP_dz);
                            let dAbsolutePos = selectBlockAbsolutePos.offset(cP_dx, cP_dy, cP_dz);
                            
                            if (!this.pos_in_box(dRelativePos, build_cache.origin, build_cache.destination)) continue;
                            
                            let blockCenterPos = dAbsolutePos.plus(new Vec3(0.5, 0.5, 0.5));
                            if (botEyePosition.distanceTo(blockCenterPos) > 6) continue;
                            
                            let currentPosPlace_d_Index = targetSch.index(dRelativePos.x, dRelativePos.y, dRelativePos.z);
                            if (targetSch.getBlockPIDByIndex(currentPosPlace_d_Index) != sch_palette_order[build_cache.currentPalette]) continue;
                            
                            let dBlocksIndex = currentPaletteBlocksIndexs.indexOf(currentPosPlace_d_Index);
                            if (dBlocksIndex !== -1 && currentPaletteBlocksState[dBlocksIndex] == 0 && Block_In_CD.indexOf(dBlocksIndex) == -1) {
                                if (bot.blockAt(dAbsolutePos)?.name == currentPaletteName) {
                                    currentPaletteBlocksState[dBlocksIndex] = 1;
                                    build_cache.placedBlock++;
                                    continue;
                                }

                                let hold = bot.heldItem;
                                if (!changeCD && hold?.name == currentPaletteName && hold?.count < 32) {
                                    let findSlot = -1;
                                    for (let idx = 9; idx <= 44; idx++) {
                                        if (idx != hold.slot && bot.inventory.slots[idx]?.name == currentPaletteName) {
                                            findSlot = idx;
                                            break;
                                        }
                                    }
                                    if (findSlot != -1) {
                                        await bot.simpleClick.leftMouse(findSlot);
                                        await bot.simpleClick.leftMouse(44);
                                        await bot.simpleClick.leftMouse(findSlot);
                                        changeCD = true;
                                        setTimeout(() => changeCD = false, 500);
                                    }
                                }

                                if (hold == null || hold.name != currentPaletteName) {
                                    let findSlot = -1;
                                    for (let idx = 9; idx <= 44; idx++) {
                                        if (bot.inventory.slots[idx]?.name == currentPaletteName) {
                                            findSlot = idx;
                                            break;
                                        }
                                    }
                                    if (findSlot == -1) {
                                        build_cache.debug.restock_count++;
                                        let needReStock = [];
                                        let emptySlotCount = bot.inventory.emptySlotCount();
                                        let quantity = 0;
                                        for (let i = 0; i < currentPaletteBlocksState.length; i++) {
                                            if (currentPaletteBlocksState[i] == 0) quantity++;
                                            if (quantity >= 2304) break;
                                        }
                                        needReStock.push({ name: currentPaletteName, count: quantity, p: build_cache.currentPalette });
                                        
                                        // 補充之後的材料
                                        let esc = emptySlotCount - Math.ceil(quantity / 64);
                                        for (let crtRSC = build_cache.currentPalette + 1; crtRSC < targetSch.palette.length; crtRSC++) {
                                            if (esc < 1) break;
                                            let realId = sch_palette_order[crtRSC];
                                            let crtRSCount = materialListForSch[realId];
                                            let crtInv = bot.inventory.countRange(9, 44, mcData.itemsByName[targetSch.palette[realId].Name].id) || 0;
                                            crtRSCount -= crtInv;
                                            if (crtRSCount <= 0) continue;
                                            let count = Math.min(crtRSCount, esc * 64);
                                            needReStock.push({ name: targetSch.palette[realId].Name, count: count, p: crtRSC });
                                            esc -= Math.ceil(count / 64);
                                        }

                                        let sr_start = Date.now();
                                        await station.restock(bot, stationConfig, needReStock);
                                        await sleep(5000);
                                        build_cache.debug.restock_takeTime += (Date.now() - sr_start);
                                        continue;
                                    } else {
                                        await bot.simpleClick.leftMouse(44);
                                        await bot.simpleClick.leftMouse(findSlot);
                                        await bot.simpleClick.leftMouse(44);
                                        await sleep(80);
                                        bot.updateHeldItem();
                                    }
                                }

                                await sleep(32);
                                bot.updateHeldItem();
                                if (!bot.heldItem || bot.heldItem.name !== currentPaletteName) continue;

                                const packet = {
                                    location: dAbsolutePos,
                                    direction: 0,
                                    heldItem: Item.toNotch(bot.heldItem),
                                    cursorX: 0.5, cursorY: 0.5, cursorZ: 0.5
                                };
                                build_cache.debug.placeCount++;
                                bot._client.write('block_place', packet);
                                Block_In_CD.push(dBlocksIndex);
                                const timerID = setTimeout(() => {
                                    Block_In_CD.shift();
                                    removeTimerID.shift();
                                }, this.build_check_cooldown);
                                removeTimerID.push(timerID);
                            }
                        }
                    }
                }
            }
        } finally {
            bot.off('blockUpdate', updateVisited);
        }

        build_cache.endTime = Date.now();
        await saveConfig(buildCachePath, build_cache);
        return 'finish';
    }
}

module.exports = MapartPrinter;
