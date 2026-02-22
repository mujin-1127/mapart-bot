const BasePrinter = require('./BasePrinter');
const { sleep, readConfig, saveConfig, v, hashConfig } = require('../utils');
const { Vec3 } = require('vec3');
const fs = require('fs');
const pathfinder = require('../pathfinder');
const schematic = require('../schematic');
const station = require('../station');
const globalLogger = require('../logger');

class BuildingPrinter extends BasePrinter {
    constructor() {
        super();
        this.name = 'building';
        this.BLOCK_SKIP_LIST = ["red_mushroom","spore_blossom","amethyst_cluster","medium_amethyst_bud","large_amethyst_bud","twisting_vines"];
        this.building_check_cooldown = 5000;
    }

    log(bot, showInConsole, level, msg) {
        const logger = globalLogger.module('Printer-Building');
        logger.log(showInConsole, level, msg);
    }

    async build(task, bot, cfg, project, sharedState) {
        const Item = require('prismarine-item')(bot.version);
        const mcData = require('minecraft-data')(bot.version);
        const debug_enable = bot.debugMode || true;
        
        const crt_cfg_hash = hashConfig({ 
            schematic: cfg.schematic, 
            workRegion: cfg.workRegion 
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
            stationConfig = await readConfig(`${process.cwd()}/config/global/${cfg.station}`);
        }

        let targetSch = project || await schematic.loadFromFile(cfg.schematic.filename);

        targetSch.toMineflayerID(); // 必須在材質替換與計算前執行，將 minecraft: 前綴去除

        // 先執行材質替換，確保後續依賴 palette Name 的邏輯正確
        if (cfg.replaceMaterials) {
            for (const i in cfg.replaceMaterials) {
                targetSch.changeMaterial(cfg.replaceMaterials[i][0], cfg.replaceMaterials[i][1]);
            }
        }

        let totalRegionBlocks = 0;
        let IgnoreAirArray = []; // 用於分工計算
        for (let i = 0; i < targetSch.Metadata.TotalVolume; i++) {
            if (targetSch.getBlockPIDByIndex(i) === 0) continue;
            
            const rel = targetSch.vec3(i);
            // 1. 檢查是否在總區域內
            if (cfg.workRegion) {
                if (rel.x < cfg.workRegion.minX || rel.x > cfg.workRegion.maxX ||
                    rel.z < cfg.workRegion.minZ || rel.z > cfg.workRegion.maxZ) {
                    continue;
                }
            }
            
            totalRegionBlocks++; // 全域總數

            // 2. 檢查是否屬於此 worker 的分工長條
            if (cfg.worker_count > 1) {
                const totalZ = cfg.workRegion.maxZ - cfg.workRegion.minZ + 1;
                const stripHeight = Math.ceil(totalZ / cfg.worker_count);
                const myMinZ = cfg.workRegion.minZ + (cfg.worker_id * stripHeight);
                const myMaxZ = Math.min(cfg.workRegion.maxZ, myMinZ + stripHeight - 1);

                if (rel.z < myMinZ || rel.z > myMaxZ) continue;
            }
            
            IgnoreAirArray.push(i);
        }

        if (build_cache.hash !== crt_cfg_hash) {
            // 計算屬於此 worker 的總方塊數 (改為區域分工)
            let workerBlocks = 0;
            if (cfg.worker_count > 1) {
                const totalZ = cfg.workRegion.maxZ - cfg.workRegion.minZ + 1;
                const stripHeight = Math.ceil(totalZ / cfg.worker_count);
                const myMinZ = cfg.workRegion.minZ + (cfg.worker_id * stripHeight);
                const myMaxZ = Math.min(cfg.workRegion.maxZ, myMinZ + stripHeight - 1);

                for (let i = 0; i < IgnoreAirArray.length; i++) {
                    const rel = targetSch.vec3(IgnoreAirArray[i]);
                    if (rel.z >= myMinZ && rel.z <= myMaxZ) workerBlocks++;
                }
            } else {
                workerBlocks = totalRegionBlocks;
            }

            Object.assign(build_cache, {
                hash: crt_cfg_hash,
                placedBlock: 0,
                totalBlocks: workerBlocks,
                regionTotalBlocks: totalRegionBlocks, // 紀錄整張圖的總數
                worker_id: cfg.worker_id,
                worker_count: cfg.worker_count,
                totalLayer: targetSch.Metadata.EnclosingSize.y,
                currentLayer: 0,
                currentPalette: 0,
                startTime: Date.now(),
                activeTime: 0, // 新增：累計活躍建造時間 (ms)
                lastUpdateTimestamp: Date.now(), // 新增：上次計算時間戳
                endTime: -1,
                useTime: -1,
                origin: new Vec3(0, 0, 0),
                destination: new Vec3(0, 0, 0).plus(targetSch.Metadata.EnclosingSize).offset(-1, -1, -1),
                placement_origin: new Vec3(cfg.schematic.placementPoint_x, cfg.schematic.placementPoint_y, cfg.schematic.placementPoint_z),
                debug: { discconnectCount: 0, findNextTotalCounter: 0, restock_count: 0, restock_takeTime: 0, placeCount: 0, temp: 0 }
            });
            build_cache.placement_destination = build_cache.placement_origin.plus(build_cache.destination);
        } else {
            ['origin', 'destination', 'placement_origin', 'placement_destination'].forEach(k => build_cache[k] = v(build_cache[k]));
            
            // 即使是恢復任務，也同步更新所有統計欄位
            build_cache.regionTotalBlocks = totalRegionBlocks;
            build_cache.worker_id = cfg.worker_id;
            build_cache.worker_count = cfg.worker_count;
            build_cache.lastUpdateTimestamp = Date.now(); // 恢復時重置時間戳
            
            let workerBlocks = 0;
            if (cfg.worker_count > 1) {
                for (let i = 0; i < IgnoreAirArray.length; i++) {
                    if (i % cfg.worker_count === cfg.worker_id) workerBlocks++;
                }
            } else {
                workerBlocks = totalRegionBlocks;
            }
            build_cache.totalBlocks = workerBlocks;
        }

        // 建立索引映射，方便快速檢查某個 blockIndex 是 IgnoreAirArray 中的第幾個
        const globalToIgnoreAirIndex = new Map();
        for (let i = 0; i < IgnoreAirArray.length; i++) {
            globalToIgnoreAirIndex.set(IgnoreAirArray[i], i);
        }

        let wheatherGetLayerPalette = false;
        let wheatherGetPalette = false;
        let layerPaletteBlocksByIndex = {};
        let layerPaletteCountByIndex = {};
        let currentPaletteBlocksState = [];
        let sch_palette_order = [];
        let selectBlockIndex = 0;
        let currentPaletteIndexLowerBound = 0;
        let currentPalette;
        let blockInCD = [];
        let removeTimerID = [];
        let changeCD = false;

        const updateCheck = (oldBlock, newBlock) => {
            // ... update logic
        };

        bot.on('blockUpdate', updateCheck);

        try {
            while (build_cache.currentLayer < build_cache.totalLayer) {
                if (sharedState.stop) break;
                
                const now = Date.now();
                if (sharedState.pause) { 
                    build_cache.lastUpdateTimestamp = now;
                    await sleep(500); 
                    continue; 
                }

                // 累加活跃時間
                build_cache.activeTime += (now - build_cache.lastUpdateTimestamp);
                build_cache.lastUpdateTimestamp = now;

                if (!wheatherGetLayerPalette) {
                    const startIndex = build_cache.currentLayer * targetSch.Metadata.EnclosingSize.x * targetSch.Metadata.EnclosingSize.z;
                    const endIndex = (build_cache.currentLayer + 1) * targetSch.Metadata.EnclosingSize.x * targetSch.Metadata.EnclosingSize.z - 1;
                    
                    layerPaletteCountByIndex = {};
                    layerPaletteBlocksByIndex = {};
                    for (let i = 0; i < targetSch.palette.length; i++) {
                        layerPaletteCountByIndex[i] = 0;
                        layerPaletteBlocksByIndex[i] = [];
                    }

                    for (let i = startIndex; i <= endIndex; i++) {
                        let p_id = targetSch.getBlockPIDByIndex(i);
                        if (p_id === 0) continue;

                        // 分工邏輯：區域分工判定
                        if (cfg.worker_count > 1) {
                            const totalZ = cfg.workRegion.maxZ - cfg.workRegion.minZ + 1;
                            const stripHeight = Math.ceil(totalZ / cfg.worker_count);
                            const myMinZ = cfg.workRegion.minZ + (cfg.worker_id * stripHeight);
                            const myMaxZ = Math.min(cfg.workRegion.maxZ, myMinZ + stripHeight - 1);

                            const rel = targetSch.vec3(i);
                            if (rel.z < myMinZ || rel.z > myMaxZ) continue;
                        }

                        // 如果有區域限制，檢查方塊是否在區域內 (使用相對座標，以免絕對座標過大而失效)
                        if (cfg.workRegion) {
                            const rel = targetSch.vec3(i);
                            if (rel.x < cfg.workRegion.minX || rel.x > cfg.workRegion.maxX ||
                                rel.z < cfg.workRegion.minZ || rel.z > cfg.workRegion.maxZ) {
                                continue;
                            }
                        }

                        layerPaletteCountByIndex[p_id]++;
                        layerPaletteBlocksByIndex[p_id].push(i);
                    }

                    sch_palette_order = [];
                    for (let i in layerPaletteCountByIndex) {
                        if (layerPaletteCountByIndex[i] > 0) {
                            let p = targetSch.palette[i];
                            p.index = i;
                            sch_palette_order.push(p);
                        }
                    }
                    
                    sch_palette_order.sort((a, b) => {
                        const aIsWall = a.Properties?.face === 'wall';
                        const bIsWall = b.Properties?.face === 'wall';
                        if (aIsWall && !bIsWall) return 1;
                        if (!aIsWall && bIsWall) return -1;
                        if (a.Properties && !b.Properties) return 1;
                        if (!a.Properties && b.Properties) return -1;
                        return a.Name.localeCompare(b.Name);
                    });
                    sch_palette_order = sch_palette_order.map(p => parseInt(p.index));

                    if (sch_palette_order.length === 0) {
                        build_cache.currentLayer++;
                        continue;
                    }
                    wheatherGetLayerPalette = true;
                    wheatherGetPalette = false;
                }

                if (build_cache.currentPalette >= sch_palette_order.length) {
                    build_cache.currentPalette = 0;
                    build_cache.currentLayer++;
                    wheatherGetLayerPalette = false;
                    continue;
                }

                if (!wheatherGetPalette) {
                    const pid = sch_palette_order[build_cache.currentPalette];
                    currentPalette = targetSch.palette[pid];
                    currentPaletteBlocksState = new Array(layerPaletteCountByIndex[pid]).fill(0);
                    selectBlockIndex = 0;
                    currentPaletteIndexLowerBound = 0;
                    wheatherGetPalette = true;
                }

                const blocks = layerPaletteBlocksByIndex[sch_palette_order[build_cache.currentPalette]];
                let selectBlockRealIndex = blocks[selectBlockIndex];
                let selectBlockRelativePos = targetSch.vec3(selectBlockRealIndex);
                let selectBlockAbsolutePos = build_cache.placement_origin.plus(selectBlockRelativePos);
                let selectBlockBotStandPos = selectBlockAbsolutePos.offset(0, 2, 0);

                await pathfinder.astarfly(bot, selectBlockBotStandPos, null, null, null, !debug_enable);
                
                let botEyePosition = bot.entity.position.plus(new Vec3(0, 1.6, 0));
                for (let cP_dz = -4; cP_dz <= 4; cP_dz++) {
                    for (let cP_dx = -4; cP_dx <= 4; cP_dx++) {
                        if (sharedState.pause || sharedState.stop) break;
                        
                        let dAbsolutePos = selectBlockAbsolutePos.offset(cP_dx, 0, cP_dz);
                        let dRelativePos = selectBlockRelativePos.offset(cP_dx, 0, cP_dz);
                        
                        if (!this.pos_in_box(dRelativePos, build_cache.origin, build_cache.destination)) continue;
                        
                        if (botEyePosition.distanceTo(dAbsolutePos.plus(new Vec3(0.5, 0.5, 0.5))) > 6) continue;
                        
                        let currentPosIndex = targetSch.index(dRelativePos.x, dRelativePos.y, dRelativePos.z);
                        if (targetSch.getBlockPIDByIndex(currentPosIndex) != sch_palette_order[build_cache.currentPalette]) continue;
                        
                        // 分工邏輯：區域分工判定
                        if (cfg.worker_count > 1) {
                            const totalZ = cfg.workRegion.maxZ - cfg.workRegion.minZ + 1;
                            const stripHeight = Math.ceil(totalZ / cfg.worker_count);
                            const myMinZ = cfg.workRegion.minZ + (cfg.worker_id * stripHeight);
                            const myMaxZ = Math.min(cfg.workRegion.maxZ, myMinZ + stripHeight - 1);

                            if (dRelativePos.z < myMinZ || dRelativePos.z > myMaxZ) continue;
                        }

                        let dBlocksIndex = blocks.indexOf(currentPosIndex);
                        if (blockInCD.indexOf(dBlocksIndex) == -1 && this.checkBlock(bot.blockAt(dAbsolutePos), currentPalette) == 1) {
                            currentPaletteBlocksState[dBlocksIndex] = 1;
                        } else {
                            if (currentPaletteBlocksState[dBlocksIndex] == 0 && blockInCD.indexOf(dBlocksIndex) == -1) {
                                if (bot.blockAt(dAbsolutePos) == null) continue;
                                if (this.checkBlock(bot.blockAt(dAbsolutePos), currentPalette) == 1) {
                                    currentPaletteBlocksState[dBlocksIndex] = 1;
                                } else {
                                    // 物品檢查與放置 (簡化，同 Mapart 但呼叫 placeWithProperties)
                                    let hold = bot.heldItem;
                                    if (hold?.name != currentPalette.Name) {
                                        // ... switch item logic
                                    }
                                    
                                    await sleep(32);
                                    await this.placeWithProperties(bot, currentPalette, dAbsolutePos, Item);
                                    
                                    blockInCD.push(dBlocksIndex);
                                    const timerID = setTimeout(() => {
                                        blockInCD.shift();
                                        removeTimerID.shift();
                                    }, this.building_check_cooldown);
                                    removeTimerID.push(timerID);
                                }
                            }
                        }
                    }
                }

                // Find Next
                selectBlockIndex = -1;
                for (let i = currentPaletteIndexLowerBound; i < blocks.length; i++) {
                    if (currentPaletteBlocksState[i] === 0 && blockInCD.indexOf(i) === -1) {
                        selectBlockIndex = i;
                        currentPaletteIndexLowerBound = i;
                        break;
                    }
                }

                if (selectBlockIndex === -1) {
                    build_cache.currentPalette++;
                    wheatherGetPalette = false;
                }
            }

            // --- 最終檢查階段 ---
            this.log(bot, true, "INFO", "主要建造完成，等待伺服器同步資料...");
            await sleep(1500); // 確保最後幾塊方塊已正確同步
            
            this.log(bot, true, "INFO", "開始進行最後校對...");
            
            let retryCount = 0;
            let missingIndices = [];
            const totalVolume = targetSch.Metadata.TotalVolume;
            
            // 計算分工邊界 (同步使用前面的計算方式)
            const totalZ = cfg.workRegion.maxZ - cfg.workRegion.minZ + 1;
            const stripHeight = Math.ceil(totalZ / cfg.worker_count);
            const myMinZ = cfg.workRegion.minZ + (cfg.worker_id * stripHeight);
            const myMaxZ = Math.min(cfg.workRegion.maxZ, myMinZ + stripHeight - 1);

            do {
                missingIndices = [];
                for (let i = 0; i < totalVolume; i++) {
                    const pId = targetSch.getBlockPIDByIndex(i);
                    if (pId === 0) continue; // 空氣

                    const rel = targetSch.vec3(i);
                    // 1. 區域限制檢查
                    if (cfg.workRegion) {
                        if (rel.x < cfg.workRegion.minX || rel.x > cfg.workRegion.maxX ||
                            rel.z < cfg.workRegion.minZ || rel.z > cfg.workRegion.maxZ) continue;
                    }
                    // 2. 分工檢查
                    if (cfg.worker_count > 1 && (rel.z < myMinZ || rel.z > myMaxZ)) continue;

                    const absPos = build_cache.placement_origin.plus(rel);
                    const palette = targetSch.palette[pId];
                    
                    const block = bot.blockAt(absPos);
                    // 若 block 為 null (區塊未加載) 或名字不對，先記錄下來
                    if (!block || this.checkBlock(block, palette) !== 1) {
                        missingIndices.push(i);
                    }
                }

                if (missingIndices.length > 0) {
                    if (retryCount === 0) {
                        this.log(bot, true, "WARN", `校對完畢：初步發現 ${missingIndices.length} 個未加載或錯誤方塊，正在前往補救...`);
                    } else {
                        this.log(bot, true, "WARN", `再次校對：還有 ${missingIndices.length} 個方塊，繼續補救... (第 ${retryCount} 次重試)`);
                    }

                    // 按調色盤分組補救以減少切換次數
                    missingIndices.sort((a, b) => targetSch.getBlockPIDByIndex(a) - targetSch.getBlockPIDByIndex(b));

                    for (const bIdx of missingIndices) {
                        if (sharedState.stop) break;
                        const rel = targetSch.vec3(bIdx);
                        const absPos = build_cache.placement_origin.plus(rel);
                        const palette = targetSch.palette[targetSch.getBlockPIDByIndex(bIdx)];

                        await pathfinder.astarfly(bot, absPos.offset(0, 2, 0), null, null, null, true);
                        
                        // 等待區塊載入
                        await sleep(300);
                        
                        // 抵達後重新檢查一次
                        const currentBlock = bot.blockAt(absPos);
                        if (currentBlock && this.checkBlock(currentBlock, palette) === 1) {
                            continue; // 其實已經蓋好了，跳過
                        }
                        
                        let hold = bot.heldItem;
                        if (!hold || hold.name !== palette.Name) {
                            const invItem = bot.inventory.items().find(item => item.name === palette.Name);
                            if (invItem) {
                                await bot.simpleClick.leftMouse(invItem.slot);
                                await bot.simpleClick.leftMouse(44);
                                await bot.simpleClick.leftMouse(invItem.slot);
                                await sleep(100);
                            } else {
                                await station.restock(bot, stationConfig, [{ name: palette.Name, count: 64 }]);
                                await pathfinder.astarfly(bot, absPos.offset(0, 2, 0), null, null, null, true);
                            }
                        }

                        if (bot.heldItem && bot.heldItem.name === palette.Name) {
                            let attempt = 0;
                            while (attempt < 3) {
                                await this.placeWithProperties(bot, palette, absPos, Item);
                                await sleep(300);
                                const checkBlock = bot.blockAt(absPos);
                                if (checkBlock && this.checkBlock(checkBlock, palette) === 1) {
                                    break; // 成功放置
                                }
                                attempt++;
                            }
                        }
                    }
                    retryCount++;
                }
            } while (missingIndices.length > 0 && retryCount < 3 && !sharedState.stop);

            if (missingIndices.length === 0) {
                this.log(bot, true, "INFO", "校對完畢：無漏蓋或錯誤方塊。");
            } else if (!sharedState.stop) {
                this.log(bot, true, "WARN", `放棄補救：仍有 ${missingIndices.length} 個方塊無法成功放置或區塊始終無法加載。`);
            }
        } finally {
            bot.off('blockUpdate', updateCheck);
        }

        return 'finish';
    }
}

module.exports = BuildingPrinter;
