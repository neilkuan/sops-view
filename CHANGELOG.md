# Change Log

All notable changes to the "sops-view" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

## [0.1.2]

### Fixed
- 自動偵測編輯器改用 `vscode.env.appRoot/bin/` 內建 CLI wrapper。修正在 Kiro 中 `kiro --wait` 會誤呼叫 `kiro-cli`、或執行 Electron 主程式導致 `bad option: --wait` / `SyntaxError` 的問題

## [0.1.1]

### Added
- `sopsView.editorCommand` 支援相對於工作區根目錄的可執行檔路徑，例如 `./bin/kiro --wait`
- 預設 `filePatterns`、Explorer 右鍵選單與 `.sops-view.yaml` 自訂命令支援 `.json` 檔案

### Added
- 新增 `sopsView.editorCommand` 設定項，允許使用者自訂 EDITOR 環境變數，覆蓋自動偵測的值
- 新增 Kiro IDE 支援，自動偵測 Kiro 並設定 `EDITOR=kiro --wait`

### Changed
- 升級 GitHub Actions 至最新版本（Node.js 24 runtime）：
  - `pnpm/action-setup` v4（v4.4.0, Node.js 24）
  - `actions/setup-node` v4 → v6
  - `softprops/action-gh-release` v2 → v3

## [0.0.9]

- Initial release
