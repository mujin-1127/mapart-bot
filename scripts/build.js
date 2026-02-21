const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const configPath = path.join(__dirname, '..', 'config.json');
const dataJsPath = path.join(__dirname, '..', 'node_modules', 'minecraft-data', 'data.js');
const dataJsBackupPath = dataJsPath + '.bak';

// Load config to get target version
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const targetVersion = config.version;

console.log(`[Build] Target Minecraft version: ${targetVersion}`);

if (!fs.existsSync(dataJsPath)) {
  console.error('[Error] node_modules/minecraft-data/data.js not found!');
  process.exit(1);
}

// Backup original data.js
if (!fs.existsSync(dataJsBackupPath)) {
  console.log('[Build] Backing up original data.js...');
  fs.copyFileSync(dataJsPath, dataJsBackupPath);
}

const originalDataJs = fs.readFileSync(dataJsBackupPath, 'utf8');

/**
 * 提取指定版本及其遞迴依賴的版本
 */
function extractRequiredVersions(content, version, type = 'pc') {
  const versionsToKeep = new Set();
  const versionsToProcess = [version];
  
  // 強制加入一些常見版本，確保伺服器切換時不會因為缺少協定資料而斷線
  const essentialVersions = ['1.8.9', '1.12.2', '1.16.5', '1.18.2', '1.19.4', '1.20', '1.20.1', '1.20.2', '1.20.4', '1.21'];
  essentialVersions.forEach(v => versionsToProcess.push(v));
  
  while (versionsToProcess.length > 0) {
    const currentVer = versionsToProcess.shift();
    if (versionsToKeep.has(currentVer)) continue;
    
    // 尋找該版本的區塊內容。
    // 使用非貪婪模式匹配到該版本結尾的縮進 (4 個空格或更大縮進接 } )
    const escapedVer = currentVer.replace(/\./g, '\\.');
    const verBlockRegex = new RegExp(`'${escapedVer}': \\{([\\s\\S]*?)\\n\\s{4}\\}`, 'g');
    const match = verBlockRegex.exec(content);
    
    if (match) {
      versionsToKeep.add(currentVer);
      const blockContent = match[1];
      // 尋找區塊內所有的 require("./minecraft-data/data/pc/xxx/...")
      const depRegex = /require\("\.\/minecraft-data\/data\/(pc|bedrock)\/([\d\w.-]+)\//g;
      let depMatch;
      while ((depMatch = depRegex.exec(blockContent)) !== null) {
        const depType = depMatch[1];
        const depVer = depMatch[2];
        if (depType === 'pc') {
          versionsToProcess.push(depVer);
        }
      }
    } else {
      console.warn(`[Warning] Version ${currentVer} not found in data.js`);
    }
  }
  
  return versionsToKeep;
}

try {
  // 構造新的 data.js
  // 我們保留模組結構，但過濾 pc 和 bedrock 下的物件屬性
  let prunedContent = originalDataJs;

  // 1. 處理 PC 版本
  const pcStartIndex = prunedContent.indexOf("'pc': {");
  // 尋找 PC 區塊的結尾 (縮進為 2 個空格的 }, )
  const pcEndIndex = prunedContent.indexOf("\n  },", pcStartIndex); 
  
  if (pcStartIndex !== -1 && pcEndIndex !== -1) {
    const requiredPcVersions = extractRequiredVersions(originalDataJs, targetVersion, 'pc');
    console.log(`[Build] Required PC versions: ${Array.from(requiredPcVersions).join(', ')}`);

    const prunedPcEntries = [];
    for (const ver of requiredPcVersions) {
      const escapedVer = ver.replace(/\./g, '\\.');
      // 這裡的正則要精確匹配到版本物件的結束
      const verBlockRegex = new RegExp(`'${escapedVer}': \\{([\\s\\S]*?)\\n\\s{4}\\}`, 'g');
      const match = verBlockRegex.exec(originalDataJs);
      if (match) {
        prunedPcEntries.push(`'${ver}': {${match[1]}\n    },`);
      }
    }

    prunedContent = prunedContent.substring(0, pcStartIndex + 7) + 
                    '\n    ' + prunedPcEntries.join('\n    ') + 
                    '\n  ' + prunedContent.substring(pcEndIndex);
  }

  // 2. 清空 Bedrock 版本
  const bedrockStartIndex = prunedContent.indexOf("'bedrock': {");
  const bedrockEndIndex = prunedContent.lastIndexOf("\n  }"); 
  if (bedrockStartIndex !== -1 && bedrockEndIndex !== -1 && bedrockEndIndex > bedrockStartIndex) {
    prunedContent = prunedContent.substring(0, bedrockStartIndex + 12) + 
                    '\n  ' + prunedContent.substring(bedrockEndIndex);
  }

  console.log('[Build] Writing pruned data.js...');
  fs.writeFileSync(dataJsPath, prunedContent);

  // 執行 pkg
  console.log('[Build] Running pkg with GZip compression...');
  // 這裡我們直接執行 pkg 指令，對應 package.json 裡的 build
  execSync('npx pkg . --targets node18-win-x64 --compress GZip --output dist/bot.exe', { stdio: 'inherit' });

  console.log('[Build] Build successful!');

} catch (err) {
  console.error('[Build] Error occurred during build:', err);
} finally {
  // 還原備份
  if (fs.existsSync(dataJsBackupPath)) {
    console.log('[Build] Restoring original data.js...');
    fs.copyFileSync(dataJsBackupPath, dataJsPath);
    fs.unlinkSync(dataJsBackupPath);
  }
}
