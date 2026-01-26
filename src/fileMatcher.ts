import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { minimatch } from 'minimatch';

export class FileMatcher {
	private patterns: string[] = [];

	updatePatterns(patterns: string[]) {
		this.patterns = patterns;
	}

	isSopsFile(filePath: string): boolean {
		const fileName = path.basename(filePath);
		const relativePath = vscode.workspace.asRelativePath(filePath, false);

		// 首先檢查檔案名稱模式
		const matchesPattern = this.patterns.some(pattern => {
			// 支援 glob 模式匹配
			return minimatch(fileName, pattern) || minimatch(relativePath, pattern);
		});

		if (matchesPattern) {
			return true;
		}

		// 如果模式不匹配，檢查檔案內容是否包含 SOPS 標記
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, 'utf8');
				// 檢查是否包含 SOPS 加密標記
				// 1. 檢查是否有 sops: 區塊（支援 YAML 和 JSON 格式）
				const hasSopsKey = content.includes('sops:') || /"sops"\s*:/.test(content);
				// 2. 檢查是否有 ENC[...] 格式的加密內容（使用更準確的正則表達式）
				const hasEncMarker = /ENC\[(AES256_GCM|AES128_GCM|PGP)/.test(content);
				if (hasSopsKey || hasEncMarker) {
					return true;
				}
			}
		} catch (error) {
			// 如果讀取檔案失敗，忽略錯誤，只依賴模式匹配
		}

		return false;
	}

	getPatterns(): string[] {
		return [...this.patterns];
	}
}
