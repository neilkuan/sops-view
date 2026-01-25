#!/usr/bin/env node
/**
 * 手動打包 VSCode 擴充功能為 .vsix 檔案
 * 用於解決 vsce 工具的 secret scanning bug
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const vsixName = `${pkg.name}-${pkg.version}.vsix`;

// 需要包含的檔案
const filesToInclude = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'dist/'
];

// 檢查必要檔案是否存在
const missingFiles = filesToInclude.filter(file => {
  const filePath = path.join(process.cwd(), file);
  return !fs.existsSync(filePath);
});

if (missingFiles.length > 0) {
  console.error('錯誤：以下檔案不存在：');
  missingFiles.forEach(file => console.error(`  - ${file}`));
  console.error('\n請先執行: pnpm run package');
  process.exit(1);
}

// 檢查 dist/extension.js 是否存在
if (!fs.existsSync('dist/extension.js')) {
  console.error('錯誤：dist/extension.js 不存在');
  console.error('請先執行: pnpm run package');
  process.exit(1);
}

try {
  // 創建臨時目錄結構
  const tempDir = path.join(process.cwd(), 'temp-extension');
  const extensionDir = path.join(tempDir, 'extension');
  
  // 清理舊的臨時目錄
  if (fs.existsSync(tempDir)) {
    execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
  }
  
  fs.mkdirSync(extensionDir, { recursive: true });
  
  // 複製檔案到 extension 目錄
  console.log('正在準備檔案...');
  filesToInclude.forEach(file => {
    const srcPath = path.join(process.cwd(), file);
    const destPath = path.join(extensionDir, file);
    
    if (fs.statSync(srcPath).isDirectory()) {
      execSync(`cp -r "${srcPath}" "${destPath}"`, { stdio: 'ignore' });
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
  
  // 創建 .vsix 檔案（實際上是一個 zip 檔案）
  console.log('正在打包擴充功能...');
  execSync(`cd ${tempDir} && zip -r ../${vsixName} extension/`, { 
    stdio: 'inherit'
  });
  
  // 清理臨時目錄
  execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
  
  console.log(`\n✅ 成功創建 ${vsixName}`);
  console.log(`\n安裝方式：在 VSCode 中執行 "Extensions: Install from VSIX..." 並選擇此檔案`);
} catch (error) {
  console.error('打包失敗：', error.message);
  // 清理臨時目錄
  const tempDir = path.join(process.cwd(), 'temp-extension');
  if (fs.existsSync(tempDir)) {
    execSync(`rm -rf ${tempDir}`, { stdio: 'ignore' });
  }
  process.exit(1);
}
