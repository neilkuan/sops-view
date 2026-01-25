import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';

export class FileMatcher {
	private patterns: string[] = [];

	updatePatterns(patterns: string[]) {
		this.patterns = patterns;
	}

	isSopsFile(filePath: string): boolean {
		const fileName = path.basename(filePath);
		const relativePath = vscode.workspace.asRelativePath(filePath, false);

		return this.patterns.some(pattern => {
			// 支援 glob 模式匹配
			return minimatch(fileName, pattern) || minimatch(relativePath, pattern);
		});
	}

	getPatterns(): string[] {
		return [...this.patterns];
	}
}
