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

try {
  // 構造新的 data.js
  let prunedContent = originalDataJs;

  // 1. 處理 PC 版本：保留全部，確保伺服器切換正常
  console.log('[Build] Keeping all PC versions for maximum compatibility...');

  // 2. 清空 Bedrock 版本 (佔用 ~276MB，Bot 為 Java 版用不到)
  const bedrockStartIndex = prunedContent.indexOf("'bedrock': {");
  const bedrockEndIndex = prunedContent.lastIndexOf("  }"); 
  if (bedrockStartIndex !== -1 && bedrockEndIndex !== -1 && bedrockEndIndex > bedrockStartIndex) {
    console.log('[Build] Pruning Bedrock versions to save space...');
    prunedContent = prunedContent.substring(0, bedrockStartIndex + 12) + 
                    '\n  ' + prunedContent.substring(bedrockEndIndex);
  }

  console.log('[Build] Writing optimized data.js...');
  fs.writeFileSync(dataJsPath, prunedContent);

  // 執行 pkg
  console.log('[Build] Running pkg with GZip compression...');
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
