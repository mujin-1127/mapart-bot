const sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay));
const wait = () => new Promise(setImmediate);
const { Vec3 } = require('vec3');

/** 相容標準 mineflayer（無 bot.logger 時不輸出 DEBUG） */
function log(bot, showInConsole, level, msg) {
    if (typeof bot.logger === 'function') bot.logger(showInConsole, level, msg);
    else if (showInConsole) console.log(`[Pathfinder][${level}] ${msg}`);
}

let astarCD = false;
const legitimate_block = ['air', 'cave_air', 'light', 'water', 'vine'];

const pathfinder = {
    /**
     * A* Search 並限制可循路區塊 (具備超時與防卡死機制)
     * @param {object} bot - Mineflayer bot
     * @param {Vec3} target - 目標座標
     * @param {Vec3} border1 - 邊界座標1
     * @param {Vec3} border2 - 邊界座標2
     * @param {number} lastFlyTime - 上次飛行時間
     * @param {boolean} mute - 靜音模式
     */
    astarfly: async function (bot, target, border1, border2, lastFlyTime, mute = false) {
        const mcData = require('minecraft-data')(bot.version);
        let distance = bot.entity.position.distanceTo(target);
        
        if (distance < 0.5) return 0;
        if (!mute) console.log(`[Pathfinder] \x1b[32m尋路中\x1b[0m ${bot.entity.position.floored()} -> ${target.floored()}`);
        
        let astarStartT = Date.now();
        let astar_timer = 0;
        let alreadyCheckTargetNoObstacle = false;
        let secondTargetMaxDistance = 4;
        let lastBotPos = bot.entity.position.clone();
        let stuckCount = 0;

        while (astar_timer < 100) { // 防止極限情況卡死死循環
            // 1. 檢查目標是否可達 (排除阻擋)
            if (!alreadyCheckTargetNoObstacle && bot.blockAt(target)) {
                alreadyCheckTargetNoObstacle = true;
                const blockAtTarget = bot.blockAt(target);
                const blockAboveTarget = bot.blockAt(target.offset(0, 1, 0));
                
                if (blockAtTarget && !legitimate_block.includes(blockAtTarget.name)) {
                    log(bot, true, 'WARN', `目標點 ${target.floored()} 被 ${blockAtTarget.name} 阻擋，搜尋替代點位...`);
                    
                    const matchingType = legitimate_block.map(name => mcData.blocksByName[name].id);
                    const secondPos = bot.findBlock({
                        point: target,
                        matching: matchingType,
                        useExtraInfo: b => legitimate_block.includes(bot.blockAt(b.position.offset(0, 1, 0))?.name),
                        maxDistance: secondTargetMaxDistance
                    });
                    
                    if (!secondPos) {
                        secondTargetMaxDistance = Math.min(secondTargetMaxDistance + 1, 8);
                        alreadyCheckTargetNoObstacle = false;
                    } else {
                        target = secondPos.position;
                    }
                }
            }

            // 2. 判斷是否到達
            let locNow = bot.entity.position.floored();
            if (locNow.distanceTo(target.floored()) < 1) break;

            // 3. 檢查是否卡死 (座標沒變動)
            if (lastBotPos.distanceTo(bot.entity.position) < 0.01) {
                stuckCount++;
                if (stuckCount > 10) {
                    log(bot, true, 'ERROR', '尋路卡死，重新嘗試強制移動...');
                    await bot.creative.flyTo(bot.entity.position.offset(0, 0.05, 0));
                    stuckCount = 0;
                }
            } else {
                stuckCount = 0;
            }
            lastBotPos = bot.entity.position.clone();

            // 4. 執行 A* Step
            await this.astarStep(bot, locNow, target, border1, border2);
            astar_timer++;
            
            // 全域超時保護
            if (Date.now() - astarStartT > 8000) {
                log(bot, true, 'WARN', '尋路整體超時 (8s)，目前停止於當前位置');
                break;
            }
        }

        if (!mute) log(bot, false, 'DEBUG', `尋路耗時: ${Date.now() - astarStartT}ms, 距離: ${distance.toFixed(2)}m`);
        return 0;
    },

    /**
     * 單步 A* 路徑計算與移動
     */
    astarStep: async function (bot, start, target, border1, border2) {
        let astar_start_time = Date.now();
        let OPEN = [];
        let CLOSE = [];
        
        let nodeStart = start.clone();
        nodeStart.g = 0;
        nodeStart.h = nodeStart.distanceTo(target);
        nodeStart.f = nodeStart.g + nodeStart.h;
        nodeStart.step = 0;
        nodeStart.parentIndex = -1;
        OPEN.push(nodeStart);

        let endNode = null;
        while (OPEN.length > 0) {
            await wait();
            
            // 單步超時保護
            if (Date.now() - astar_start_time > 1500) {
                endNode = OPEN.reduce((prev, curr) => (prev.h < curr.h ? prev : curr));
                break;
            }

            // 找 F 最小的節點
            let current_id = 0;
            for (let i = 1; i < OPEN.length; i++) {
                if (OPEN[i].f < OPEN[current_id].f) current_id = i;
            }
            let current = OPEN.splice(current_id, 1)[0];
            CLOSE.push(current);

            // 到達或步數限制
            if (current.h < 1 || current.step >= 12) {
                endNode = current;
                break;
            }

            // 展開鄰居 (6 個方向: 上, 下, 北, 南, 西, 東)
            const dirs = [
                new Vec3(0, 1, 0), new Vec3(0, -1, 0),
                new Vec3(0, 0, -1), new Vec3(0, 0, 1),
                new Vec3(-1, 0, 0), new Vec3(1, 0, 0)
            ];

            for (const d of dirs) {
                const neighbor = current.plus(d);
                if (CLOSE.some(n => n.equals(neighbor))) continue;
                
                const block = bot.blockAt(neighbor);
                const blockAbove = bot.blockAt(neighbor.offset(0, 1, 0));
                
                if (block && blockAbove && legitimate_block.includes(block.name) && legitimate_block.includes(blockAbove.name)) {
                    neighbor.g = current.g + 1;
                    neighbor.h = neighbor.distanceTo(target);
                    neighbor.f = neighbor.g + neighbor.h;
                    neighbor.step = current.step + 1;
                    neighbor.parentIndex = CLOSE.length - 1;
                    
                    if (!OPEN.some(n => n.equals(neighbor))) {
                        OPEN.push(neighbor);
                    }
                }
            }
        }

        // 重建路徑並移動
        if (!endNode) return;
        
        let path = [];
        let curr = endNode;
        while (curr.parentIndex !== -1) {
            path.unshift(curr.offset(0.5, 0.1, 0.5));
            curr = CLOSE[curr.parentIndex];
        }

        for (const pos of path) {
            while (astarCD) await sleep(10);
            bot.entity.position = pos;
            astarCD = true;
            setTimeout(() => { astarCD = false; }, 40);
            await sleep(5);
        }
    }
};

module.exports = pathfinder;
