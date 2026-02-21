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

class MinHeap {
    constructor(compare) {
        this.data = [];
        this.compare = compare || ((a, b) => a - b);
    }
    push(val) {
        this.data.push(val);
        this._up(this.data.length - 1);
    }
    pop() {
        if (this.data.length === 0) return null;
        const top = this.data[0];
        const bottom = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = bottom;
            this._down(0);
        }
        return top;
    }
    _up(i) {
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (this.compare(this.data[i], this.data[p]) < 0) {
                const tmp = this.data[i]; this.data[i] = this.data[p]; this.data[p] = tmp;
                i = p;
            } else {
                break;
            }
        }
    }
    _down(i) {
        const len = this.data.length;
        while (true) {
            let left = 2 * i + 1;
            let right = 2 * i + 2;
            let best = i;
            if (left < len && this.compare(this.data[left], this.data[best]) < 0) best = left;
            if (right < len && this.compare(this.data[right], this.data[best]) < 0) best = right;
            if (best !== i) {
                const tmp = this.data[i]; this.data[i] = this.data[best]; this.data[best] = tmp;
                i = best;
            } else {
                break;
            }
        }
    }
    get length() { return this.data.length; }
}

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
        let OPEN = new MinHeap((a, b) => a.f - b.f);
        let openSet = new Map(); // key: string, value: node (含 g, f, step 等資訊)
        let closeSet = new Set();
        
        let nodeStart = start.clone();
        nodeStart.g = 0;
        nodeStart.h = nodeStart.distanceTo(target);
        nodeStart.f = nodeStart.g + nodeStart.h;
        nodeStart.step = 0;
        nodeStart.parent = null; // 改用節點參照
        
        OPEN.push(nodeStart);
        openSet.set(nodeStart.toString(), nodeStart);

        let endNode = null;
        let bestNode = nodeStart; // 記錄最近點，防止超時時沒有有效節點
        
        let iterations = 0;
        const dirs = [
            new Vec3(0, 1, 0), new Vec3(0, -1, 0),
            new Vec3(0, 0, -1), new Vec3(0, 0, 1),
            new Vec3(-1, 0, 0), new Vec3(1, 0, 0)
        ];

        while (OPEN.length > 0) {
            iterations++;
            // 每 100 次迭代讓出 CPU，避免長時間阻塞事件循環
            if (iterations % 100 === 0) await wait();
            
            // 單步超時保護 (1.5s)
            if (Date.now() - astar_start_time > 1500) {
                endNode = bestNode;
                break;
            }

            // 找 F 最小的節點
            let current = OPEN.pop();
            const currentStr = current.toString();
            
            openSet.delete(currentStr);
            closeSet.add(currentStr);

            // 更新最近點
            if (current.h < bestNode.h) bestNode = current;

            // 到達或步數限制
            if (current.h < 1 || current.step >= 12) {
                endNode = current;
                break;
            }

            // 展開鄰居
            for (const d of dirs) {
                const neighbor = current.plus(d);
                const neighborStr = neighbor.toString();
                
                if (closeSet.has(neighborStr)) continue;
                
                const block = bot.blockAt(neighbor);
                const blockAbove = bot.blockAt(neighbor.offset(0, 1, 0));
                
                if (block && blockAbove && legitimate_block.includes(block.name) && legitimate_block.includes(blockAbove.name)) {
                    const g = current.g + 1;
                    const h = neighbor.distanceTo(target);
                    const f = g + h;
                    
                    const existingOpen = openSet.get(neighborStr);
                    if (existingOpen && existingOpen.g <= g) continue;

                    neighbor.g = g;
                    neighbor.h = h;
                    neighbor.f = f;
                    neighbor.step = current.step + 1;
                    neighbor.parent = current;
                    
                    if (!existingOpen) {
                        OPEN.push(neighbor);
                        openSet.set(neighborStr, neighbor);
                    }
                }
            }
        }

        // 重建路徑並移動
        if (!endNode) return;
        
        let path = [];
        let curr = endNode;
        while (curr.parent) {
            path.unshift(curr.offset(0.5, 0.1, 0.5));
            curr = curr.parent;
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
