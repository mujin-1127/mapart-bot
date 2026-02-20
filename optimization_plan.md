# Mineflayer Bot 優化計畫

此計畫旨在提升機器人的效能、維護性與擴展性。我們將嚴格遵守「對擴展開放，對修改封閉」(Open-Closed Principle, OCP) 的原則進行重構。

## 第一階段：基礎設施與工具化 (Infrastructure) [已完成]

### 1. 建立 `lib/utils.js` [DONE]
- **目的**：消除代碼重複，統一工具函式。
- **內容**：包含 `sleep`, `readConfig`, `saveConfig`, `vector3Helper` 等。
- **OCP 實踐**：提供穩定的 API 供各模組使用，不直接在各模組內重複實作。

### 2. 建立統一 Logger [DONE]
- **目的**：集中管理日誌輸出，支援多重輸出端（Console, Discord, File）。
- **OCP 實踐**：日誌系統應能透過插件方式增加新的輸出端，而不需要修改核心 Logger 邏輯。

---

## 第二階段：重構核心邏輯以符合 OCP (OCP Refactoring) [進行中]

### 3. 指令分發重構 (Command Strategy Pattern) [已建立框架，部分遷移]
- **目的**：將 `src/mapart.js` 中龐大的 `mapart.cmd` 與相關函式（`mp_build`, `mp_set` 等）拆分。
- **實踐**：每個指令變為獨立的物件或類別。新增指令只需增加新的檔案/定義，不需修改主分發器。
- **進度**：已建立 `CommandManager.js` 並遷移 `set` 指令。

### 4. 建築模式插件化 (Building Model Plugins) [待處理]
- **目的**：`litematicPrinter.js` 中的模式 (mapart, redstone, building) 目前使用 `switch` 分支。
- **實踐**：將建築模式改為策略模式 (Strategy Pattern)，允許開發者在不修改 `litematicPrinter.js` 核心的情況下，注入新的建築模式。

---

## 第三階段：效能深度優化 (Performance Hotspots) [已完成]

### 5. Item Frame 空間索引 [DONE]
- **目的**：將 $O(N)$ 的實體搜尋優化為 $O(1)$。
- **實踐**：在 `bot` 初始化或進入新區域時，為 `Item Frame` 建立座標索引。
- **實作**：使用 `lib/entityIndexer.js` 管理索引。

### 6. 搜尋演算法優化 [DONE]
- **目的**：優化 `litematicPrinter` 在尋找下一個可放置方塊時的搜尋速度。
- **實踐**：對方塊進行空間預處理，或使用更高效的搜尋結構（如排序後的陣列或空間分區）。
- **實作**：改用順序掃描預過濾列表，大幅降低計算量。

---

## 第四階段：穩健性與清理 (Robustness & Cleanup)

### 7. 錯誤處理與重試機制
- **目的**：增加對網路波動、伺服器延遲的容錯能力。
- **實踐**：為開啟箱子、移動等關鍵動作增加統一的重試與逾時處理邏輯。

### 8. 代碼清理
- **目的**：移除過時的註解、不再使用的變數，並統一名稱規範。

---

## 優化準則
- **模組化**：功能應儘可能解耦。
- **接口化**：模組間透過定義好的介面通訊，而非直接存取內部變數。
- **可測試性**：重構後的代碼應更容易進行單元測試。
