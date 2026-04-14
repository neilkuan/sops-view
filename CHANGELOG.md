# Change Log

All notable changes to the "sops-view" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]

### Added
- 新增 `sopsView.editorCommand` 設定項，允許使用者自訂 EDITOR 環境變數，覆蓋自動偵測的值
- 新增 Kiro IDE 支援，自動偵測 Kiro 並設定 `EDITOR=kiro --wait`

### Changed
- 升級 GitHub Actions 至最新版本（Node.js 24 runtime）：
  - `pnpm/action-setup` v4 → v6
  - `actions/setup-node` v4 → v6
  - `softprops/action-gh-release` v2 → v3

## [0.0.9]

- Initial release
