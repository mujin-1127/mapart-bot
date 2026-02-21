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
        this.BLOCK_EXCLUDE_LIST = ["air", "cave_air"];
        this.build_check_cooldown = 2000;
    }

    log(bot, showInConsole, level, msg) {
        const logger = globalLogger.module('Printer-Mapart');
        logger.log(showInConsole, level, msg);
    }

    async build(task, bot, cfg, project, sharedState) {
        const Item = require('prismarine-item')(bot.version);
        const mcData = require('minecraft-data')(bot.version);
        const needFirstBuildList = ['air', 'cobblestone', 'glass'];
        const debug_enable = bot.debugMode;
        
        const crt_cfg_hash = hashConfig({ 
            schematic: cfg.schematic, 
            workRegion: cfg.workRegion,
            replaceMaterials: cfg.replaceMaterials 
        });
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

        let targetSch = project || await schematic.loadFromFile(cfg.schematic.filename);

        let materialListForSch = Array(targetSch.palette.length).fill(0);
        let IgnoreAirArray = [];
        let totalRegionBlocks = 0; // 用於重新計算區域內的總方塊數

        for (let i = 0; i < targetSch.Metadata.TotalVolume; i++) {
            let p = targetSch.getBlockPIDByIndex(i);
            if (p != 0) {
                // 如果有區域限制，檢查方塊是否在區域內
                if (cfg.workRegion) {
                    const pos = targetSch.vec3(i);
                    if (pos.x < cfg.workRegion.minX || pos.x > cfg.workRegion.maxX ||
                        pos.z < cfg.workRegion.minZ || pos.z > cfg.workRegion.maxZ) {
                        continue; // 不在區域內的材料不列入計算
                    }
                }
                
                IgnoreAirArray.push(i);
                materialListForSch[parseInt(p)]++;
                totalRegionBlocks++;
            }
        }

        if (build_cache.hash !== crt_cfg_hash) {
            Object.assign(build_cache, {
                hash: crt_cfg_hash,
                placedBlock: 0,
                totalBlocks: totalRegionBlocks, // 使用過濾後的總數
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
        let spatialHash = new Map();
        let indexMap = new Map();

        const updateVisited = (oldBlock, newBlock) => {
            const updatePos = newBlock.position;
            if (!this.pos_in_box(updatePos, build_cache.placement_origin, build_cache.placement_destination)) return;
            let r_update_pos = updatePos.minus(build_cache.placement_origin);
            let targetIndex = targetSch.index(r_update_pos.x, r_update_pos.y, r_update_pos.z);
            let qindex = indexMap.has(targetIndex) ? indexMap.get(targetIndex) : -1;
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
                    spatialHash.clear();
                    indexMap.clear();
                    currentPaletteName = targetSch.palette[sch_palette_order[build_cache.currentPalette]].Name;
                    
                    this.log(bot, false, 'INFO', `當前材料: ${currentPaletteName} ${build_cache.currentPalette + 1}/${targetSch.palette.length}`);
                    
                    if (this.BLOCK_EXCLUDE_LIST.includes(currentPaletteName)) {
                        build_cache.currentPalette++;
                        continue;
                    }

                    for (let i = 0; i < IgnoreAirArray.length; i++) {
                        if (targetSch.getBlockPIDByIndex(IgnoreAirArray[i]) == sch_palette_order[build_cache.currentPalette]) {
                            let blockIndex = IgnoreAirArray[i];
                            let arrIndex = currentPaletteBlocksIndexs.length;
                            currentPaletteBlocksIndexs.push(blockIndex);
                            currentPaletteBlocksState.push(0);
                            indexMap.set(blockIndex, arrIndex);

                            let blockPos = targetSch.vec3(blockIndex).plus(build_cache.placement_origin);
                            let chunkKey = `${Math.floor(blockPos.x / 16)},${Math.floor(blockPos.y / 16)},${Math.floor(blockPos.z / 16)}`;
                            if (!spatialHash.has(chunkKey)) {
                                spatialHash.set(chunkKey, []);
                            }
                            spatialHash.get(chunkKey).push(arrIndex);
                        }
                    }
                    selectBlockIndex = 0;
                    try {
                        await saveConfig(buildCachePath, build_cache);
                    } catch (e) {
                        this.log(bot, true, 'ERROR', `儲存 build_cache 失敗: ${e.message}`);
                    }
                    wheatherGetPalette = true;
                }

                // 尋找最近的下一個點 (尋路優化) - 透過 Spatial Hash
                let deubg_startFNext = Date.now();
                let minDistance = Infinity;
                let nearestIndex = -1;
                let botPos = bot.entity.position;

                for (let [chunkKey, indices] of spatialHash.entries()) {
                    let activeIndices = [];
                    for (let i = 0; i < indices.length; i++) {
                        let idx = indices[i];
                        if (currentPaletteBlocksState[idx] === 1) continue; // 已放置
                        activeIndices.push(idx);

                        if (Block_In_CD.indexOf(idx) !== -1) continue;
                        
                        let blockPos = targetSch.vec3(currentPaletteBlocksIndexs[idx]).plus(build_cache.placement_origin);
                        if (bot.blockAt(blockPos)?.name === currentPaletteName) {
                            currentPaletteBlocksState[idx] = 1;
                            build_cache.placedBlock++;
                            continue;
                        }

                        let dist = botPos.distanceSquared(blockPos);
                        if (dist < minDistance) {
                            minDistance = dist;
                            nearestIndex = idx;
                        }
                    }
                    spatialHash.set(chunkKey, activeIndices); // 動態移除已放置方塊
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

                try {
                    await pathfinder.astarfly(bot, selectBlockBotStandPos, null, null, null, true);
                } catch (e) {
                    this.log(bot, true, 'ERROR', `尋路失敗: ${e.message}`);
                }
                
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
                            
                            let dBlocksIndex = indexMap.has(currentPosPlace_d_Index) ? indexMap.get(currentPosPlace_d_Index) : -1;
                            if (dBlocksIndex !== -1 && currentPaletteBlocksState[dBlocksIndex] == 0 && Block_In_CD.indexOf(dBlocksIndex) == -1) {
                                if (bot.blockAt(dAbsolutePos)?.name == currentPaletteName) {
                                    currentPaletteBlocksState[dBlocksIndex] = 1;
                                    build_cache.placedBlock++;
                                    continue;
                                }

                                // 修正物品檢查邏輯
                                let hold = bot.heldItem;
                                
                                // 1. 如果手上數量少，嘗試從背包補充到快捷列槽位 44 (Slot 8)
                                if (!changeCD && hold?.name == currentPaletteName && hold?.count < 32) {
                                    const items = bot.inventory.items().filter(item => item.name === currentPaletteName && item.slot !== hold.slot);
                                    if (items.length > 0) {
                                        const findSlot = items[0].slot;
                                        try {
                                            await bot.simpleClick.leftMouse(findSlot);
                                            await bot.simpleClick.leftMouse(44);
                                            await bot.simpleClick.leftMouse(findSlot);
                                        } catch (e) {
                                            this.log(bot, true, 'ERROR', `操作物品欄失敗: ${e.message}`);
                                        }
                                        changeCD = true;
                                        setTimeout(() => changeCD = false, 500);
                                    }
                                }

                                // 2. 如果手上沒有該材料，搜尋整個物品欄（包含副手）
                                if (hold == null || hold.name != currentPaletteName) {
                                    if (bot.currentWindow) {
                                        try {
                                            await bot.closeWindow(bot.currentWindow);
                                        } catch (e) {
                                            this.log(bot, true, 'ERROR', `關閉視窗失敗: ${e.message}`);
                                        }
                                    }
                                    
                                    const allItems = bot.inventory.items().filter(item => item.name === currentPaletteName);
                                    
                                    if (allItems.length === 0) {
                                        // 真的沒有材料了才去補充
                                        build_cache.debug.restock_count++;
                                        let needReStock = [];
                                        let emptySlotCount = bot.inventory.emptySlotCount();
                                        let quantity = 0;
                                        for (let i = 0; i < currentPaletteBlocksState.length; i++) {
                                            if (currentPaletteBlocksState[i] == 0) quantity++;
                                            if (quantity >= 2304) break;
                                        }
                                        needReStock.push({ name: currentPaletteName, count: quantity, p: build_cache.currentPalette });
                                        
                                        // 預先計算後續材料補充
                                        let esc = emptySlotCount - Math.ceil(quantity / 64);
                                        for (let crtRSC = build_cache.currentPalette + 1; crtRSC < targetSch.palette.length; crtRSC++) {
                                            if (esc < 1) break;
                                            let realId = sch_palette_order[crtRSC];
                                            let crtRSCount = materialListForSch[realId];
                                            let crtInv = bot.inventory.countRange(9, 45, mcData.itemsByName[targetSch.palette[realId].Name].id) || 0;
                                            crtRSCount -= crtInv;
                                            if (crtRSCount <= 0) continue;
                                            let count = Math.min(crtRSCount, esc * 64);
                                            needReStock.push({ name: targetSch.palette[realId].Name, count: count, p: crtRSC });
                                            esc -= Math.ceil(count / 64);
                                        }

                                        let sr_start = Date.now();
                                        this.logInventory(bot); // 前往補充站前輸出背包狀態
                                        try {
                                            await station.restock(bot, stationConfig, needReStock);
                                        } catch (e) {
                                            this.log(bot, true, 'ERROR', `物資補充失敗: ${e.message}`);
                                        }
                                        await sleep(5000);
                                        build_cache.debug.restock_takeTime += (Date.now() - sr_start);
                                        continue;
                                    } else {
                                        // 有材料，將其移動到快捷列
                                        const findSlot = allItems[0].slot;
                                        try {
                                            await bot.simpleClick.leftMouse(findSlot);
                                            await bot.simpleClick.leftMouse(44);
                                            await bot.simpleClick.leftMouse(findSlot);
                                        } catch (e) {
                                            this.log(bot, true, 'ERROR', `移動材料到快捷列失敗: ${e.message}`);
                                        }
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
        try {
            await saveConfig(buildCachePath, build_cache);
        } catch (e) {
            this.log(bot, true, 'ERROR', `最後儲存 build_cache 失敗: ${e.message}`);
        }
        return 'finish';
    }
}

module.exports = MapartPrinter;
