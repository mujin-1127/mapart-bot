// --- 初始化音效 ---
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
let audioUnlocked = false;

// 需要使用者互動才能解鎖 Web Audio API
function unlockAudio() {
    if (!audioUnlocked) {
        audioCtx.resume().then(() => {
            audioUnlocked = true;
            document.removeEventListener('click', unlockAudio);
        });
    }
}
document.addEventListener('click', unlockAudio);

let lastSoundTime = 0;
function playFinishSound() {
    try {
        if (Date.now() - lastSoundTime < 1000) return; // 1秒內不重複播放
        lastSoundTime = Date.now();

        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        const volInput = document.getElementById('sound-volume');
        const maxVol = volInput ? parseFloat(volInput.value) : 0.2;
        
        function playSingleDing(delayTime) {
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();
            
            const startTime = audioCtx.currentTime + delayTime;
            
            // 使用正弦波產生清脆純淨的鈴聲
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(1046.50, startTime); // C6 音高，不作滑音
            
            // 柔和的音量包絡 ( Envelope )
            gainNode.gain.setValueAtTime(0, startTime);
            gainNode.gain.linearRampToValueAtTime(maxVol, startTime + 0.01); // 快速且輕柔的起音
            gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 0.6); // 自然的餘音衰減
            
            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);
            
            oscillator.start(startTime);
            oscillator.stop(startTime + 0.6);
        }

        // 播放三聲叮，間隔 0.25 秒讓節奏輕快不黏糊
        playSingleDing(0);
        playSingleDing(0.25);
        playSingleDing(0.5);
    } catch (e) {
        console.log("Audio not supported or disabled");
    }
}

let taskWasFinished = true; // 用來追蹤任務完成狀態，避免重複發出音效

function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.whiteSpace = 'pre-line'; // 讓 \n 換行生效
    toast.innerText = message;
    container.appendChild(toast);
    
    // Trigger animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Remove after duration
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

let currentBotId = localStorage.getItem('activeBotId') || "";

// 載入音效與音量設定
const savedSoundEnabled = localStorage.getItem('soundEnabled');
if (savedSoundEnabled !== null) {
    const soundToggle = document.getElementById('sound-toggle');
    if (soundToggle) {
        soundToggle.checked = savedSoundEnabled === 'true';
        document.getElementById('sound-icon').innerText = soundToggle.checked ? '🔊' : '🔇';
    }
}
const savedVolume = localStorage.getItem('soundVolume');
if (savedVolume !== null) {
    const volInput = document.getElementById('sound-volume');
    if (volInput) volInput.value = savedVolume;
}
document.getElementById('sound-volume').addEventListener('input', (e) => {
    localStorage.setItem('soundVolume', e.target.value);
});

let allStatus = {};
let currentBrowserPath = "";
window.allAccounts = [];

// 核心邏輯
refreshBotList();
loadTaskConfigs(); // 頁面載入時先讀取一次設定，確保 window.lastTask 有資料

const socket = io({ transports: ['websocket', 'polling'] });

socket.on('connect', () => {
    document.getElementById('socket-status').innerText = "已連線";
    document.getElementById('socket-status').style.color = "#2ecc71";
    refreshBotList();
});

socket.on('all_status', (data) => {
    allStatus = data;
    updateUI();
    updateSidebarStatus();
    updateFloatingTaskList(); // 同步更新浮動清單
});

socket.on('msa_code', (data) => {
    if (data.botId === currentBotId) {
        document.getElementById('msa-section').style.display = 'block';
        document.getElementById('msa-url').href = data.verification_uri;
        document.getElementById('msa-url').innerText = data.verification_uri;
        document.getElementById('msa-code').innerText = data.user_code;
    }
});

socket.on('task_finished', (data) => {
    showToast(`${data.taskName}: ${data.message}`, 'success', 8000);
});

// 所有任務完成
socket.on('all_tasks_finished', (data) => {
    if (document.getElementById('sound-toggle').checked) {
        playFinishSound();
    }
    showToast(`🎉 ${data.message}`, 'success', 10000);
});

// 任務被中斷
socket.on('task_interrupted', (data) => {
    if (document.getElementById('sound-toggle').checked) {
        playFinishSound();
    }
    showToast(`⚠️ ${data.message}`, 'warning', 8000);
});

// --- 新增：監聽設定更新訊號 ---
socket.on('config_updated', (data) => {
    if (data.type === 'mapart') {
        console.log("檢測到任務佇列更新，正在同步...");
        loadTaskConfigs();
    }
});

// 刷新左側機器人列表
async function refreshBotList() {
    try {
        const accRes = await fetch('/api/accounts');
        window.allAccounts = await accRes.json();
        
        const res = await fetch('/api/bots');
        const activeBotIds = await res.json();

        const sidebar = document.getElementById('bot-sidebar');
        sidebar.innerHTML = '';
        
        // 遍歷所有帳號，而不只是啟動中的機器人
        window.allAccounts.forEach(acc => {
            const id = acc.id;
            const status = allStatus[id] || { status: 'offline' };
            const div = document.createElement('div');
            div.className = `bot-item ${id === currentBotId ? 'active' : ''}`;
            div.setAttribute('data-id', id);
            
            let statusClass = status.status || 'offline';
            
            const bc = status.build_cache;
            let taskName = "無任務";
            if (bc && bc.schematic && bc.schematic.filename) {
                const parts = bc.schematic.filename.split(/[\\/]/);
                taskName = parts[parts.length - 1];
            } else if (bc && bc.taskName) {
                taskName = bc.taskName;
            }

            div.innerHTML = `
                <div class="bot-status-dot ${statusClass}" onclick="changeActiveBot('${id}')"></div>
                <div class="bot-info" onclick="changeActiveBot('${id}')">
                    <span class="bot-id">${acc.username || id}</span>
                    <span class="bot-task-hint">${taskName}</span>
                </div>
                <div class="sidebar-actions">
                    <button class="sidebar-btn start-stop-btn" onclick="event.stopPropagation(); ${statusClass === 'offline' ? `startBot(false, '${id}')` : `stopBot('${id}')`}" title="${statusClass === 'offline' ? '啟動連線' : '中斷連線'}" style="color: ${statusClass === 'offline' ? '#2ecc71' : '#e74c3c'};">
                        <div class="${statusClass === 'offline' ? 'icon-play' : 'icon-stop'}"></div>
                    </button>
                    <button class="sidebar-btn" onclick="event.stopPropagation(); openAccountModal('${id}')" title="編輯">⚙️</button>
                    <button class="sidebar-btn" onclick="event.stopPropagation(); deleteBotAccount('${id}')" title="刪除">🗑️</button>
                </div>
            `;
            sidebar.appendChild(div);
        });

        if (!currentBotId && window.allAccounts.length > 0) changeActiveBot(window.allAccounts[0].id);
        updateTaskBotList(window.allAccounts.map(a => a.id));
    } catch (e) { console.error("刷新列表失敗:", e); }
}

function updateSidebarStatus() {
    document.querySelectorAll('.bot-item').forEach(item => {
        const id = item.getAttribute('data-id');
        const status = allStatus[id] || { status: 'offline' };

        const statusClass = status.status || 'offline';
        const dot = item.querySelector('.bot-status-dot');
        if (dot) dot.className = 'bot-status-dot ' + statusClass;

        // 更新啟動/中斷按鈕
        const btn = item.querySelector('.start-stop-btn');
        if (btn) {
            btn.innerHTML = `<div class="${statusClass === 'offline' ? 'icon-play' : 'icon-stop'}"></div>`;
            btn.title = statusClass === 'offline' ? '啟動連線' : '中斷連線';
            btn.style.color = statusClass === 'offline' ? '#2ecc71' : '#e74c3c';
            btn.onclick = (e) => { e.stopPropagation(); if (statusClass === 'offline') startBot(false, id); else stopBot(id); };
        }

        const hint = item.querySelector('.bot-task-hint');
        if (hint) {
            const bc = status.build_cache;
            let taskName = "無任務";
            if (bc && bc.schematic && bc.schematic.filename) {
                const parts = bc.schematic.filename.split(/[\\/]/);
                taskName = parts[parts.length - 1];
            } else if (bc && bc.taskName) {
                taskName = bc.taskName;
            }
            hint.innerText = taskName;
        }
    });
}

function changeActiveBot(id) {
    currentBotId = id;
    localStorage.setItem('activeBotId', id);
    document.getElementById('msa-section').style.display = 'none';
    document.querySelectorAll('.bot-item').forEach(el => {
        el.classList.toggle('active', el.getAttribute('data-id') === id);
    });
    updateUI();
}

function updateUI() {
    const status = allStatus[currentBotId];
    const nameDisplay = document.getElementById('display-bot-name');
    const statusBadge = document.getElementById('bot-status-badge');
    
    if (!status) {
        nameDisplay.innerText = "請選擇機器人";
        statusBadge.className = 'status-badge badge-offline';
        statusBadge.innerText = '未知';
        document.getElementById('display-task-file').innerText = '無';
        return;
    }
    
    nameDisplay.innerText = `${status.username || currentBotId}`;
    
    // 更新狀態徽章
    const statusMap = { 
        'online': { text: '在線', class: 'badge-online' }, 
        'connecting': { text: '連線中', class: 'badge-connecting' }, 
        'offline': { text: '離線', class: 'badge-offline' } 
    };
    const s = statusMap[status.status] || { text: status.status, class: 'badge-offline' };
    statusBadge.innerText = s.text;
    statusBadge.className = `status-badge ${s.class}`;

    if (status.status === 'online') document.getElementById('msa-section').style.display = 'none';

    // --- 任務總覽邏輯 (聚合所有機器人) ---
    let taskPlaced = 0;
    let taskTotal = 0; 
    let taskStart = -1;
    let taskEnd = -1;
    let totalActiveMs = 0; // 改用累計活躍時間
    let hasTask = false;
    let taskFile = "無";

    let refBC = status.build_cache;
    if (!refBC) {
        const someBotWithTask = Object.values(allStatus).find(b => b.build_cache && b.build_cache.placement_origin);
        if (someBotWithTask) refBC = someBotWithTask.build_cache;
    }

    const overviewSection = document.getElementById('task-overview-section');
    const placeholder = document.getElementById('no-task-placeholder');

    if (refBC && (refBC.placement_origin || refBC.schematic)) {
        const origin = refBC.placement_origin || (refBC.schematic ? { x: refBC.schematic.placementPoint_x, y: refBC.schematic.placementPoint_y, z: refBC.schematic.placementPoint_z } : null);
        
        if (refBC.schematic && refBC.schematic.filename) {
            const parts = refBC.schematic.filename.split(/[\\/]/);
            taskFile = parts[parts.length - 1];
        } else if (refBC.taskName) {
            taskFile = refBC.taskName;
        } else {
            taskFile = "載入中...";
        }
        
        const participants = Object.values(allStatus).filter(botStatus => {
            const bc = botStatus.build_cache;
            if (!bc || !botStatus.isAssigned || !origin) return false;
            
            // 優先用 placement_origin 匹配，其次用 schematic 座標
            const p = bc.placement_origin || (bc.schematic ? { x: bc.schematic.placementPoint_x, y: bc.schematic.placementPoint_y, z: bc.schematic.placementPoint_z } : null);
            return p && p.x === origin.x && p.y === origin.y && p.z === origin.z;
        });

        if (participants.length > 0) {
            hasTask = true;
            let maxRegionTotal = 0;
            let extrapolatedTotal = 0;
            let maxActiveTime = 0;
            let anyNotFinished = false;
            let maxEndTime = -1;
            let anyStarted = false;

            participants.forEach(p => {
                const bc = p.build_cache;
                taskPlaced += (bc.placedBlock || 0);
                if (bc.startTime !== -1) anyStarted = true;
                
                if (bc.regionTotalBlocks && bc.regionTotalBlocks > maxRegionTotal) {
                    maxRegionTotal = bc.regionTotalBlocks;
                }
                
                if (bc.totalBlocks && bc.worker_count && bc.worker_count > 0) {
                    const est = bc.totalBlocks * bc.worker_count;
                    if (est > extrapolatedTotal) extrapolatedTotal = est;
                }

                if (bc.activeTime > maxActiveTime) maxActiveTime = bc.activeTime;
                
                if (bc.startTime && bc.startTime !== -1) {
                    if (taskStart === -1 || bc.startTime < taskStart) taskStart = bc.startTime;
                }
                if (bc.endTime === -1) {
                    anyNotFinished = true;
                } else {
                    maxEndTime = Math.max(maxEndTime, bc.endTime);
                }
            });

            taskEnd = anyNotFinished ? -1 : maxEndTime;
            taskTotal = maxRegionTotal || extrapolatedTotal || 1;
            totalActiveMs = maxActiveTime;

            overviewSection.style.display = 'block';
            placeholder.style.display = 'none';

            // 修正：只有當真的有人開始蓋且不是全員結束狀態，才計算真實百分比
            const isFinished = participants.every(p => p.build_cache.endTime !== -1);
            const percent = (isFinished && taskTotal > 1) ? "100.0" : (!anyStarted ? "0.0" : (((taskPlaced || 0) / taskTotal) * 100).toFixed(1));
            
            document.getElementById('progress-fill').style.width = percent + "%";
            document.getElementById('progress-text').innerText = percent + "%";
            document.getElementById('placed-blocks').innerText = (isFinished) ? taskTotal : taskPlaced;
            document.getElementById('total-blocks').innerText = taskTotal;
            document.getElementById('display-task-file').innerText = taskFile;

            // 使用活躍時間顯示
            const displaySeconds = Math.floor(totalActiveMs / 1000);
            document.getElementById('build-time-text').innerText = formatTime(displaySeconds);

            // ETA 計算 (基於活躍時間的速度)
            if (taskEnd === -1 && taskPlaced > 0 && displaySeconds > 0) {
                const speed = taskPlaced / displaySeconds; 
                const remaining = taskTotal - taskPlaced;
                if (speed > 0 && remaining > 0) {
                    const etaSeconds = Math.floor(remaining / speed);
                    document.getElementById('eta-text').innerText = formatTime(etaSeconds);
                } else {
                    document.getElementById('eta-text').innerText = "完成中...";
                }
                taskWasFinished = false;
            } else if (taskEnd !== -1) {
                document.getElementById('eta-text').innerText = "已完成";
                if (!taskWasFinished) {
                    showToast(`任務 ${taskFile} 已完成！`, 'success', 5000);
                    taskWasFinished = true;
                }
            }
        }
    }

    if (!hasTask) {
        overviewSection.style.display = 'none';
        placeholder.style.display = 'block';
    }

    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    // --- 背包內容 ---
    const invContainer = document.getElementById('inventory');
    invContainer.innerHTML = '';
    if (status.inventory) {
        const summary = {};
        status.inventory.forEach(item => summary[item.name] = (summary[item.name] || 0) + item.count);
        Object.entries(summary).sort().forEach(([name, count]) => {
            const div = document.createElement('div');
            div.className = 'inventory-item';
            div.innerHTML = `<span class="item-name" title="${name}">${name}</span><span class="item-count">x${count}</span>`;
            invContainer.appendChild(div);
        });
    }
}

function switchTab(tabId, el) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.container, .settings-container').forEach(c => c.classList.remove('active'));
    if (el) el.classList.add('active');
    document.getElementById(tabId).classList.add('active');
    if (tabId === 'schematic-settings') loadTaskConfigs();
}

// --- 任務佇列與設定邏輯 ---
// 輔助函式：取得簡化顯示路徑 (前兩層目錄 + 檔名)
function getShortPath(fullPath) {
    if (!fullPath) return "未選擇檔案";
    const parts = fullPath.split(/[\\/]/);
    return parts.slice(-3).join('/'); // 取最後三個部分 (例如 dir1/dir2/file.nbt)
}

function addTaskToQueue(fullPath = "") {
    const tbody = document.getElementById('task-queue-body');
    const rowCount = tbody.children.length;
    const tr = document.createElement('tr');
    tr.className = 'queue-row';
    
    const displayName = getShortPath(fullPath);

    tr.innerHTML = `
        <td class="queue-index">${rowCount + 1}</td>
        <td>
            <div style="display: flex; gap: 5px; align-items: center;">
                <span class="q-display-name" title="${fullPath}" style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: default; color: #eee; font-size: 0.9em;">
                    ${displayName}
                </span>
                <input type="hidden" class="q-filename" value="${fullPath}">
                <button class="mini-btn" onclick="browseFileForQueue(this)">更換</button>
            </div>
        </td>
        <td>
            <div style="display: flex; gap: 5px;">
                <button class="mini-btn" onclick="moveQueueRow(this, -1)">↑</button>
                <button class="mini-btn" onclick="moveQueueRow(this, 1)">↓</button>
                <button class="mini-btn btn-danger" onclick="this.closest('tr').remove(); updateQueueIndices();">✕</button>
            </div>
        </td>
    `;
    tbody.appendChild(tr);
}

function browseFileForQueue(btn) {
    // 修正: 更換時要找到隱藏的 input 而非按鈕前面的元素 (現在前面是 span)
    window.targetQueueInput = btn.parentElement.querySelector('.q-filename');
    window.targetDisplayName = btn.parentElement.querySelector('.q-display-name');
    openFileBrowser();
}

function updateQueueIndices() {
    document.querySelectorAll('.queue-index').forEach((td, i) => td.innerText = i + 1);
}

function moveQueueRow(btn, dir) {
    const row = btn.closest('tr');
    if (dir === -1 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
    if (dir === 1 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
    updateQueueIndices();
}

async function loadTaskConfigs() {
    try {
        const res = await fetch(`/api/global/config/mapart`);
        const lastTask = await res.json();
        window.lastTask = lastTask;
        
        // 記憶最後路徑
        if (lastTask && lastTask.lastBrowserPath) {
            currentBrowserPath = lastTask.lastBrowserPath;
        }

        // 載入全域放置點
        if (lastTask && lastTask.schematic) {
            document.getElementById('task-pos-x').value = lastTask.schematic.placementPoint_x || 0;
            document.getElementById('task-pos-y').value = lastTask.schematic.placementPoint_y || 100;
            document.getElementById('task-pos-z').value = lastTask.schematic.placementPoint_z || 0;
        }

        // 載入任務佇列
        const tbody = document.getElementById('task-queue-body');
        tbody.innerHTML = '';
        if (lastTask && lastTask.queue && lastTask.queue.length > 0) {
            lastTask.queue.forEach(q => addTaskToQueue(q.filename));
        } else if (lastTask && lastTask.schematic) {
            addTaskToQueue(lastTask.schematic.filename);
        }

        if (lastTask && lastTask.queue) {
            document.getElementById('auto-next-task').checked = lastTask.autoNext ?? true;
        }

        if (lastTask && lastTask.workRegion) {
            document.getElementById('task-reg-min-x').value = lastTask.workRegion.minX ?? 0;
            document.getElementById('task-reg-min-z').value = lastTask.workRegion.minZ ?? 0;
            document.getElementById('task-reg-max-x').value = lastTask.workRegion.maxX ?? 128;
            document.getElementById('task-reg-max-z').value = lastTask.workRegion.maxZ ?? 128;
        }
        if (lastTask && lastTask.save) {
            document.getElementById('save-warp').value = lastTask.save.warp || "";
            if (lastTask.save.empty_map_chest) {
                const c = lastTask.save.empty_map_chest;
                document.getElementById('save-empty-x').value = c[0]; document.getElementById('save-empty-y').value = c[1]; document.getElementById('save-empty-z').value = c[2];
                document.getElementById('save-empty-f').value = c[3]; document.getElementById('save-empty-bf').value = c[4];
            }
            if (lastTask.save.filled_map_chest) {
                const c = lastTask.save.filled_map_chest;
                document.getElementById('save-filled-x').value = c[0]; document.getElementById('save-filled-y').value = c[1]; document.getElementById('save-filled-z').value = c[2];
                document.getElementById('save-filled-f').value = c[3]; document.getElementById('save-filled-bf').value = c[4];
            }
            if (lastTask.save.cartography_table) {
                const c = lastTask.save.cartography_table;
                document.getElementById('save-carto-x').value = c[0]; document.getElementById('save-carto-y').value = c[1]; document.getElementById('save-carto-z').value = c[2];
                document.getElementById('save-carto-f').value = c[3]; document.getElementById('save-carto-bf').value = c[4];
            }
            if (lastTask.save.glass_pane_chest) {
                const c = lastTask.save.glass_pane_chest;
                document.getElementById('save-glass-x').value = c[0]; document.getElementById('save-glass-y').value = c[1]; document.getElementById('save-glass-z').value = c[2];
                document.getElementById('save-glass-f').value = c[3]; document.getElementById('save-glass-bf').value = c[4];
            }
            document.getElementById('save-offset-x').value = lastTask.save.center_offset_x ?? 64;
            document.getElementById('save-offset-z').value = lastTask.save.center_offset_z ?? 64;
            document.getElementById('auto-save-after-build').checked = !!lastTask.save.autoSaveAfterBuild;
            document.getElementById('auto-clear-after-save').checked = !!lastTask.save.autoClearAfterSave;
        }
        if (lastTask && lastTask.clear) {
            document.getElementById('clear-home-cmd').value = lastTask.clear.home_cmd || "";
            if (lastTask.clear.button) {
                const b = lastTask.clear.button;
                document.getElementById('clear-btn-x').value = b[0]; document.getElementById('clear-btn-y').value = b[1]; document.getElementById('clear-btn-z').value = b[2];
                document.getElementById('clear-btn-f').value = b[3];
            }
            document.getElementById('clear-offset-x').value = lastTask.clear.center_offset_x ?? 64;
            document.getElementById('clear-offset-z').value = lastTask.clear.center_offset_z ?? 64;
        }
        if (lastTask) renderTaskReplaceTable(lastTask.replaceMaterials || []);

        const botsRes = await fetch('/api/bots');
        const bots = await botsRes.json();
        updateTaskBotList(bots);
        const selectedBots = lastTask?.botIds || [];
        for (const id of bots) {
            const chk = document.querySelector(`.task-bot-chk[value="${id}"]`);
            if (chk) chk.checked = selectedBots.includes(id);
        }

        const resS = await fetch(`/api/global/config/station`);
        const stCfg = await resS.json();
        document.getElementById('st-warp').value = stCfg.stationWarp || "";
        renderMaterialsTable(stCfg.materials || []);
        
        updateFloatingTaskList(); // 更新浮動列表
    } catch (e) { console.error("載入任務設定出錯:", e); }
}

async function saveLastPath(path) {
    try {
        const res = await fetch(`/api/global/config/mapart`);
        const fullCfg = await res.json();
        if (fullCfg.lastBrowserPath === path) return;
        fullCfg.lastBrowserPath = path;
        await fetch(`/api/global/config/mapart`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fullCfg)
        });
    } catch (e) { console.error("儲存路徑失敗:", e); }
}

async function saveAllSettings() {
    try {
        const posX = parseInt(document.getElementById('task-pos-x').value);
        const posY = parseInt(document.getElementById('task-pos-y').value);
        const posZ = parseInt(document.getElementById('task-pos-z').value);

        showToast("正在儲存所有設定...", "warning", 1000);
        await saveGlobalStationConfig(true); 
        const res = await fetch(`/api/global/config/mapart`);
        const fullCfg = await res.json();

        // 讀取佇列並套用全域座標
        const queue = Array.from(document.querySelectorAll('.queue-row')).map(tr => ({
            filename: tr.querySelector('.q-filename').value.trim(),
            x: posX,
            y: posY,
            z: posZ
        })).filter(q => q.filename);

        if (queue.length === 0) return showToast("任務佇列不能為空！", "error");

        fullCfg.queue = queue;
        fullCfg.autoNext = document.getElementById('auto-next-task').checked;
        fullCfg.schematic = {
            filename: queue[0].filename,
            placementPoint_x: posX,
            placementPoint_y: posY,
            placementPoint_z: posZ
        };

        fullCfg.save = {
            warp: document.getElementById('save-warp').value.trim(),
            empty_map_chest: [parseInt(document.getElementById('save-empty-x').value), parseInt(document.getElementById('save-empty-y').value), parseInt(document.getElementById('save-empty-z').value), document.getElementById('save-empty-f').value, document.getElementById('save-empty-bf').value],
            filled_map_chest: [parseInt(document.getElementById('save-filled-x').value), parseInt(document.getElementById('save-filled-y').value), parseInt(document.getElementById('save-filled-z').value), document.getElementById('save-filled-f').value, document.getElementById('save-filled-bf').value],
            cartography_table: [parseInt(document.getElementById('save-carto-x').value), parseInt(document.getElementById('save-carto-y').value), parseInt(document.getElementById('save-carto-z').value), document.getElementById('save-carto-f').value, document.getElementById('save-carto-bf').value],
            glass_pane_chest: [parseInt(document.getElementById('save-glass-x').value), parseInt(document.getElementById('save-glass-y').value), parseInt(document.getElementById('save-glass-z').value), document.getElementById('save-glass-f').value, document.getElementById('save-glass-bf').value],
            center_offset_x: parseInt(document.getElementById('save-offset-x').value),
            center_offset_z: parseInt(document.getElementById('save-offset-z').value),
            autoSaveAfterBuild: document.getElementById('auto-save-after-build').checked,
            autoClearAfterSave: document.getElementById('auto-clear-after-save').checked
        };

        fullCfg.clear = {
            home_cmd: document.getElementById('clear-home-cmd').value.trim(),
            button: [parseInt(document.getElementById('clear-btn-x').value), parseInt(document.getElementById('clear-btn-y').value), parseInt(document.getElementById('clear-btn-z').value), document.getElementById('clear-btn-f').value],
            center_offset_x: parseInt(document.getElementById('clear-offset-x').value),
            center_offset_z: parseInt(document.getElementById('clear-offset-z').value)
        };

        const selectedBots = Array.from(document.querySelectorAll('.task-bot-chk:checked')).map(cb => cb.value);
        if (selectedBots.length === 0) return showToast('請至少選擇一個機器人！', 'error');

        fullCfg.workRegion = {
            minX: parseInt(document.getElementById('task-reg-min-x').value),
            minZ: parseInt(document.getElementById('task-reg-min-z').value),
            maxX: parseInt(document.getElementById('task-reg-max-x').value),
            maxZ: parseInt(document.getElementById('task-reg-max-z').value)
        };
        fullCfg.replaceMaterials = Array.from(document.querySelectorAll('#task-replace-body tr')).map(tr => [tr.querySelector('.rep-from').value.trim(), tr.querySelector('.rep-to').value.trim()]).filter(r => r[0] && r[1]);
        fullCfg.botIds = selectedBots;

        const saveRes = await fetch(`/api/global/config/mapart`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fullCfg) });
        if (saveRes.ok) {
            socket.emit('deploy_task', { filename: fullCfg.schematic.filename, pos: { x: posX, y: posY, z: posZ }, region: fullCfg.workRegion, replaceMaterials: fullCfg.replaceMaterials, botIds: selectedBots });
            showToast('所有設定已成功儲存並同步部署！', 'success', 3000);
            setTimeout(loadTaskConfigs, 300);
        } else {
            showToast('儲存失敗', 'error');
        }
    } catch (e) { console.error(e); showToast('儲存過程中發生錯誤', 'error'); }
}

function toggleTaskPanel() {
    const panel = document.getElementById('floating-task-panel');
    const btn = document.getElementById('show-task-btn');
    if (panel.style.display === 'none') {
        panel.style.display = 'flex';
        btn.style.display = 'none';
    } else {
        panel.style.display = 'none';
        btn.style.display = 'flex';
    }
}

function updateFloatingTaskList() {
    const listDiv = document.getElementById('floating-task-list');
    if (!window.lastTask || !window.lastTask.queue) return;
    
    listDiv.innerHTML = '';
    window.lastTask.queue.forEach((task, i) => {
        const div = document.createElement('div');
        div.className = `floating-item ${i === 0 ? 'active' : ''}`;
        const filename = task.filename.split(/[\\/]/).pop();
        div.innerHTML = `
            <div class="task-name">${i + 1}. ${filename}</div>
            <div class="task-meta">放置點: ${task.x}, ${task.y}, ${task.z}</div>
            ${i === 0 ? '<div class="task-meta" style="color: #3498db;">▶ 目前任務</div>' : ''}
        `;
        listDiv.appendChild(div);
    });
}

function selectFile(p) {
    if (window.targetQueueInput) {
        window.targetQueueInput.value = p;
        if (window.targetDisplayName) {
            window.targetDisplayName.innerText = getShortPath(p);
            window.targetDisplayName.title = p;
        }
        window.targetQueueInput = null;
        window.targetDisplayName = null;
    }
    closeFileModal();
}

async function saveGlobalStationConfig(silent = false) {
    try {
        const oldConfigRes = await fetch(`/api/global/config/station?t=${Date.now()}`, { cache: "no-store" });
        let oldConfig = await oldConfigRes.json();
        const newConfig = {
            ...oldConfig,
            stationWarp: document.getElementById('st-warp').value,
            offset: { "N": [0, 1, -3], "S": [0, 1, 3], "W": [-3, 1, 0], "E": [3, 1, 0], "bN": [0, 1, -2], "bS": [0, 1, 2], "bW": [-2, 1, 0], "bE": [2, 1, 0] },
            materials: Array.from(document.querySelectorAll('#st-materials-body tr')).map(tr => [ tr.querySelector('.mat-name').value, [ parseInt(tr.querySelector('.mat-x').value), parseInt(tr.querySelector('.mat-y').value), parseInt(tr.querySelector('.mat-z').value), tr.querySelector('.mat-f').value, tr.querySelector('.mat-bf').value ] ])
        };
        await fetch(`/api/global/config/station`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newConfig) });
        if (!silent) showToast('材料站設定已儲存 (含自動校正 Offset)');
    } catch (e) {
        console.error(e);
        if (!silent) showToast('儲存失敗', 'error');
        throw e;
    }
}

function updateTaskBotList(bots) {
    const botListDiv = document.getElementById('task-bot-list');
    if (botListDiv) {
        botListDiv.innerHTML = '';
        bots.forEach(id => {
            const label = document.createElement('label');
            label.className = 'bot-checkbox-item';
            label.innerHTML = `<input type="checkbox" class="task-bot-chk" value="${id}"> ${id}`;
            botListDiv.appendChild(label);
        });
    }
}

function openAccountModal(botId = null) {
    const modal = document.getElementById('account-modal');
    const userInput = document.getElementById('acc-modal-user');
    const authSelect = document.getElementById('acc-modal-auth');
    window.currentEditingBotId = botId;
    if (botId) {
        const acc = window.allAccounts.find(a => a.id === botId);
        userInput.value = (acc && acc.username) || botId;
        authSelect.value = (acc && acc.auth) || "microsoft";
    } else {
        userInput.value = ""; 
        authSelect.value = "microsoft";
    }
    modal.style.display = 'block';
}
function closeAccountModal() { document.getElementById('account-modal').style.display = 'none'; }
async function saveAccountFromModal() {
    const username = document.getElementById('acc-modal-user').value.trim();
    const auth = document.getElementById('acc-modal-auth').value;
    if (!username) return showToast("請填寫帳號！", "error");
    const id = username;
    let newAccounts = [...window.allAccounts];
    if (window.currentEditingBotId) newAccounts = newAccounts.filter(a => a.id !== window.currentEditingBotId);
    if (newAccounts.some(a => a.id === id)) return showToast("此帳號已存在！", "error");
    newAccounts.push({ id, username, auth });
    const res = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAccounts) });
    if (res.ok) { showToast("儲存成功，機器人清單已更新"); closeAccountModal(); refreshBotList(); }
}
async function deleteBotAccount(botId) {
    const newAccounts = window.allAccounts.filter(a => a.id !== botId);
    const res = await fetch('/api/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAccounts) });
    if (res.ok) { showToast(`已刪除機器人「${botId}」`); refreshBotList(); }
}
function startBot(exclusive, botId = null) { 
    const id = botId || currentBotId;
    if (id) socket.emit('start_bot', { botId: id, exclusive }); 
}
function stopBot(botId = null) { 
    const id = botId || currentBotId;
    if (id) socket.emit('stop_bot', { botId: id }); 
}
function sendCommand() { const input = document.getElementById('cmd-input'); if (input.value.trim() && currentBotId) { socket.emit('command', { botId: currentBotId, cmd: input.value.trim() }); input.value = ''; } }
function sendQuickCmd(cmd) { if (currentBotId) socket.emit('command', { botId: currentBotId, cmd }); }
function allBotsCmd(cmd) {
    const onlineBots = Object.keys(allStatus).filter(id => allStatus[id].status === 'online');
    if (onlineBots.length === 0) return showToast('目前無在線機器人', 'warning');
    onlineBots.forEach(botId => socket.emit('command', { botId, cmd }));
    showToast(`已對 ${onlineBots.length} 個在線機器人發送「${cmd}」指令`);
}
function openFileBrowser() {
    const currentFile = ""; // 簡化
    let pathToShow = currentBrowserPath;
    document.getElementById('file-modal').style.display = 'block'; 
    loadFiles(pathToShow); 
}
function closeFileModal() { document.getElementById('file-modal').style.display = 'none'; }

async function loadFiles(path) {
    const res = await fetch(`/api/utils/list-files?path=${encodeURIComponent(path)}`);
    const data = await res.json();
    currentBrowserPath = data.currentDir; 
    document.getElementById('browser-path-input').value = data.currentDir;
    
    // 儲存最後訪問的路徑到伺服器
    saveLastPath(data.currentDir);

    const list = document.getElementById('file-list'); 
    list.innerHTML = '';
    
    // 上一層目錄
    if (data.currentDir !== data.parentDir) { 
        const div = document.createElement('div'); 
        div.className = 'file-item'; 
        div.innerHTML = `<span style="flex: 1;">📁 ..</span>`;
        div.onclick = () => loadFiles(data.parentDir); 
        list.appendChild(div); 
    }
    
    // 檔案與資料夾列表
    data.items.forEach(i => { 
        const div = document.createElement('div'); 
        div.className = 'file-item'; 
        
        if (i.isDirectory) {
            div.innerHTML = `<span style="flex: 1;">📁 ${i.name}</span>`;
            div.onclick = () => loadFiles(i.fullPath);
        } else {
            // 檔案顯示勾選框
            div.innerHTML = `
                <input type="checkbox" class="file-select-chk" value="${i.fullPath}" onclick="event.stopPropagation()">
                <span style="flex: 1; margin-left: 10px;">📄 ${i.name}</span>
            `;
            // 點擊整行也可以切換勾選 (除非點到 checkbox 本身)
            div.onclick = (e) => {
                const chk = div.querySelector('.file-select-chk');
                if (e.target !== chk) chk.checked = !chk.checked;
            };
        }
        list.appendChild(div); 
    });
}

function selectAllFiles() {
    const chks = document.querySelectorAll('.file-select-chk');
    const anyUnchecked = Array.from(chks).some(c => !c.checked);
    chks.forEach(c => c.checked = anyUnchecked);
}

function confirmBatchSelection() {
    const selectedPaths = Array.from(document.querySelectorAll('.file-select-chk:checked')).map(c => c.value);
    
    if (selectedPaths.length === 0) {
        showToast("請先勾選檔案！", "warning");
        return;
    }

    if (window.targetQueueInput) {
        // 如果是更換單一檔案
        window.targetQueueInput.value = selectedPaths[0];
        if (window.targetDisplayName) {
            window.targetDisplayName.innerText = getShortPath(selectedPaths[0]);
            window.targetDisplayName.title = selectedPaths[0];
        }
        
        // 如果同時勾選了多個，則將剩下的新增到後方
        for (let i = 1; i < selectedPaths.length; i++) {
            addTaskToQueue(selectedPaths[i]);
        }
        window.targetQueueInput = null;
        window.targetDisplayName = null;
    } else {
        // 否則全部新增為新行
        selectedPaths.forEach(p => addTaskToQueue(p));
    }
    
    updateQueueIndices();
    closeFileModal();
    showToast(`已批次加入 ${selectedPaths.length} 個檔案`);
}

function renderMaterialsTable(list) { const tbody = document.getElementById('st-materials-body'); tbody.innerHTML = ''; list.forEach(m => { const tr = document.createElement('tr'); tr.innerHTML=`<td><input type="text" class="form-control mat-name" value="${m[0]}"></td><td><input type="number" class="form-control mat-x" style="width:80px" value="${m[1][0]}"></td><td><input type="number" class="form-control mat-y" style="width:80px" value="${m[1][1]}"></td><td><input type="number" class="form-control mat-z" style="width:80px" value="${m[1][2]}"></td><td><input type="text" class="form-control mat-f" style="width:60px" value="${m[1][3]}"></td><td><input type="text" class="form-control mat-bf" style="width:60px" value="${m[1][4]}"></td><td><button class="btn-danger" onclick="this.parentElement.parentElement.remove()">刪除</button></td>`; tbody.appendChild(tr); }); }
function addMaterialRow() { const tr = document.createElement('tr'); tr.innerHTML=`<td><input type="text" class="form-control mat-name" value="new"></td><td><input type="number" class="form-control mat-x" style="width:80px" value="0"></td><td><input type="number" class="form-control mat-y" style="width:80px" value="0"></td><td><input type="number" class="form-control mat-z" style="width:80px" value="0"></td><td><input type="text" class="form-control mat-f" style="width:60px" value="N"></td><td><input type="text" class="form-control mat-bf" style="width:60px" value="bN"></td><td><button class="btn-danger" onclick="this.parentElement.parentElement.remove()">刪除</button></td>`; document.getElementById('st-materials-body').appendChild(tr); }
function applyTaskRegionPreset(preset) {
    const minX = document.getElementById('task-reg-min-x');
    const minZ = document.getElementById('task-reg-min-z');
    const maxX = document.getElementById('task-reg-max-x');
    const maxZ = document.getElementById('task-reg-max-z');
    switch(preset) {
        case 'full':  setReg(0, 0, 128, 128); break;
        case 'h1':    setReg(0, 0, 128, 63); break;
        case 'h2':    setReg(0, 64, 128, 128); break;
        case 'q1':    setReg(0, 0, 128, 31); break;
        case 'q2':    setReg(0, 32, 128, 63); break;
        case 'q3':    setReg(0, 64, 128, 95); break;
        case 'q4':    setReg(0, 96, 128, 128); break;
    }
    function setReg(x1, z1, x2, z2) { minX.value = x1; minZ.value = z1; maxX.value = x2; maxZ.value = z2; }
}
function renderTaskReplaceTable(list) { const tbody = document.getElementById('task-replace-body'); tbody.innerHTML = ''; list.forEach(r => addTaskReplaceRow(r[0], r[1])); }
function addTaskReplaceRow(f="", t="") { const tr = document.createElement('tr'); tr.innerHTML=`<td><input type="text" class="form-control rep-from" value="${f}"></td><td><input type="text" class="form-control rep-to" value="${t}"></td><td><button class="btn-danger" onclick="this.parentElement.parentElement.remove()">刪除</button></td>`; document.getElementById('task-replace-body').appendChild(tr); }
function singleBotSave() {
    const assignedBots = window.lastTask?.botIds || [];
    const onlineBots = Object.keys(allStatus).filter(id => allStatus[id].status === 'online');
    const targetId = assignedBots.find(id => onlineBots.includes(id)) || onlineBots[0];
    if (!targetId) return showToast('目前無在線機器人可執行存圖', 'warning');
    socket.emit('command', { botId: targetId, cmd: 'mp save' });
    showToast(`已指派機器人「${targetId}」執行存圖任務`);
}
function singleBotClear() {
    const assignedBots = window.lastTask?.botIds || [];
    const onlineBots = Object.keys(allStatus).filter(id => allStatus[id].status === 'online');
    const targetId = assignedBots.find(id => onlineBots.includes(id)) || onlineBots[0];
    if (!targetId) return showToast('目前無在線機器人可執行清理', 'warning');
    socket.emit('command', { botId: targetId, cmd: 'mp clear' });
    showToast(`已指派機器人「${targetId}」執行清理任務 (僅第一位機器人有效)`);
}
