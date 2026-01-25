# 安裝 SOPS View 擴充功能

本文件說明如何在 VSCode 中安裝和使用 SOPS View 擴充功能。

## 方法一：開發模式（推薦用於測試）

這是最簡單的方式，適合開發和測試擴充功能。

### 步驟：

1. **確保已安裝依賴**
   ```bash
   pnpm install
   ```

2. **編譯擴充功能**
   ```bash
   pnpm run compile
   ```

3. **在 VSCode 中啟動擴充功能**
   - 按 `F5` 鍵，或
   - 點擊左側的「執行和偵錯」圖示，選擇 "Run Extension"，然後按 `F5`

4. **測試擴充功能**
   - 會開啟一個新的 VSCode 視窗（Extension Development Host）
   - 在這個新視窗中，擴充功能已經載入並可以使用
   - 點擊任何符合模式的 SOPS 加密檔案，應該會自動解密顯示

## 方法二：打包成 .vsix 檔案安裝

如果您想要將擴充功能打包成 `.vsix` 檔案，以便在其他 VSCode 實例中安裝：

### 步驟：

1. **安裝 VSCode Extension Manager (vsce)**
   ```bash
   pnpm add -g @vscode/vsce
   ```
   或使用 npm：
   ```bash
   npm install -g @vscode/vsce
   ```

2. **確保已編譯擴充功能**
   ```bash
   pnpm run package
   ```

3. **打包擴充功能**
   
   **推薦方式：使用專案提供的打包腳本**
   ```bash
   pnpm run package:vsix
   ```
   或直接執行：
   ```bash
   node package-vsix.js
   ```
   
   這會自動創建 `.vsix` 檔案，例如 `sops-view-0.0.1.vsix`
   
   **注意**：如果使用 `vsce package` 遇到 `TypeError: Expected concurrency to be an integer` 錯誤，這是 vsce 工具的已知 bug。請使用上述的 `package-vsix.js` 腳本，它會繞過這個問題。

4. **安裝 .vsix 檔案**
   - 在 VSCode 中，按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
   - 輸入 `Extensions: Install from VSIX...`
   - 選擇剛才生成的 `.vsix` 檔案
   - 重新載入 VSCode

## 方法三：從本地資料夾安裝（開發模式）

如果您想要在主要的 VSCode 實例中安裝（而不是 Extension Development Host）：

1. **編譯擴充功能**
   ```bash
   pnpm run package
   ```

2. **建立符號連結或複製到擴充功能目錄**
   
   **macOS/Linux:**
   ```bash
   ln -s $(pwd) ~/.vscode/extensions/sops-view-0.0.1
   ```
   
   **Windows:**
   ```powershell
   # 在 PowerShell 中執行
   New-Item -ItemType SymbolicLink -Path "$env:USERPROFILE\.vscode\extensions\sops-view-0.0.1" -Target (Get-Location)
   ```

3. **重新載入 VSCode**
   - 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
   - 輸入 `Developer: Reload Window`

## 驗證安裝

安裝完成後，您可以透過以下方式驗證：

1. **檢查擴充功能是否已載入**
   - 按 `Cmd+Shift+P` (Mac) 或 `Ctrl+Shift+P` (Windows/Linux)
   - 輸入 `SOPS: 開啟解密檔案`，應該能看到命令

2. **測試功能**
   - 開啟一個包含 SOPS 加密檔案的專案
   - 點擊符合模式的加密檔案（例如 `secrets.yaml`）
   - 應該會自動解密並顯示內容

## 配置擴充功能

安裝後，您可以在 VSCode 設定中配置擴充功能：

1. 按 `Cmd+,` (Mac) 或 `Ctrl+,` (Windows/Linux) 開啟設定
2. 搜尋 "sops view" 或直接編輯 `settings.json`：

```json
{
  "sopsView.filePatterns": [
    "*.encrypted.yaml",
    "*.sops.yaml",
    "secrets.yaml"
  ],
  "sopsView.awsAccountProfileMapping": {
    "123456789012": "prod-profile",
    "987654321098": "dev-profile"
  },
  "sopsView.sopsExecutablePath": "sops"
}
```

## 疑難排解

### 擴充功能無法載入

- 確保已執行 `pnpm run compile` 或 `pnpm run package`
- 檢查 `dist/extension.js` 檔案是否存在
- 查看 VSCode 的「輸出」面板，選擇 "Log (Extension Host)" 查看錯誤訊息

### SOPS 命令找不到

- 確保 SOPS 已安裝並在 PATH 中
- 可以在終端機中執行 `sops --version` 確認
- 或在設定中指定完整路徑：`"sopsView.sopsExecutablePath": "/usr/local/bin/sops"`

### 解密失敗

- 檢查 `.sops.yaml` 配置檔案是否存在且正確
- 如果使用 AWS KMS，確保 AWS Profile 已正確配置
- 檢查 AWS 憑證是否有效

## 更新擴充功能

如果您修改了擴充功能程式碼：

1. **重新編譯**
   ```bash
   pnpm run compile
   ```

2. **重新載入 VSCode**
   - 在 Extension Development Host 中，直接重新載入視窗即可
   - 如果使用 .vsix 安裝，需要重新打包並安裝

## 卸載擴充功能

### 如果是從 .vsix 安裝：

1. 按 `Cmd+Shift+X` (Mac) 或 `Ctrl+Shift+X` (Windows/Linux) 開啟擴充功能面板
2. 搜尋 "sops-view"
3. 點擊齒輪圖示，選擇「卸載」

### 如果是開發模式：

- 關閉 Extension Development Host 視窗即可
- 或刪除符號連結/複製的資料夾
