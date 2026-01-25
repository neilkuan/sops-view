import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import * as yaml from 'js-yaml';

interface SopsConfig {
	creation_rules?: Array<{
		path_regex?: string;
		kms?: string;
		pgp?: string;
		age?: string;
		[key: string]: any;
	}>;
	[key: string]: any;
}

interface AwsAccountProfileMapping {
	[accountId: string]: string;
}

export class SopsDocumentContentProvider implements vscode.TextDocumentContentProvider {
	private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
	private readonly sopsConfigCache = new Map<string, SopsConfig | null>();
	private readonly decryptedContentCache = new Map<string, { content: string; timestamp: number }>();

	readonly onDidChange = this._onDidChange.event;

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		// 從 sops-view:// URI 中提取原始檔案路徑
		// URI 格式: sops-view://file/path/to/file.yaml
		let filePath: string;
		if (uri.scheme === 'sops-view') {
			// 移除 sops-view://file 前綴，取得實際檔案路徑
			filePath = uri.path;
			// 如果是 Windows，可能需要處理路徑格式
			if (process.platform === 'win32' && filePath.startsWith('/')) {
				filePath = filePath.substring(1);
			}
		} else {
			filePath = uri.fsPath;
		}

		const fileUri = vscode.Uri.file(filePath);
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
		
		if (!workspaceFolder) {
			throw new Error('無法找到工作區資料夾');
		}

		// 檢查快取
		const cached = this.decryptedContentCache.get(filePath);
		if (cached && Date.now() - cached.timestamp < 5000) {
			return cached.content;
		}

		try {
			// 讀取加密檔案
			const encryptedContent = fs.readFileSync(filePath, 'utf8');
			
			// 尋找 .sops.yaml 配置
			const sopsConfig = await this.findSopsConfig(workspaceFolder.uri.fsPath);
			
			// 解析 KMS ARN 並確定 AWS Profile
			const awsProfile = await this.determineAwsProfile(filePath, sopsConfig, workspaceFolder.uri.fsPath);
			
			// 解密檔案
			const decryptedContent = await this.decryptFile(filePath, awsProfile);
			
			// 更新快取
			this.decryptedContentCache.set(filePath, {
				content: decryptedContent,
				timestamp: Date.now()
			});
			
			return decryptedContent;
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`解密檔案失敗: ${errorMessage}`);
			throw error;
		}
	}

	public async findSopsConfig(workspaceRoot: string): Promise<SopsConfig | null> {
		// 檢查快取
		if (this.sopsConfigCache.has(workspaceRoot)) {
			return this.sopsConfigCache.get(workspaceRoot) || null;
		}

		let currentDir = workspaceRoot;
		let config: SopsConfig | null = null;

		// 向上搜尋 .sops.yaml
		while (currentDir !== path.dirname(currentDir)) {
			const configPath = path.join(currentDir, '.sops.yaml');
			if (fs.existsSync(configPath)) {
				try {
					const configContent = fs.readFileSync(configPath, 'utf8');
					config = yaml.load(configContent) as SopsConfig;
					break;
				} catch (error) {
					console.error(`讀取 .sops.yaml 失敗: ${configPath}`, error);
				}
			}
			currentDir = path.dirname(currentDir);
		}

		this.sopsConfigCache.set(workspaceRoot, config);
		return config;
	}

	public async determineAwsProfile(
		filePath: string,
		sopsConfig: SopsConfig | null,
		workspaceRoot: string
	): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('sopsView');
		const accountProfileMapping = config.get<AwsAccountProfileMapping>('awsAccountProfileMapping', {});

		if (!sopsConfig || !sopsConfig.creation_rules) {
			return undefined;
		}

		// 尋找匹配的 creation rule
		const relativePath = path.relative(workspaceRoot, filePath);
		let matchedRule = sopsConfig.creation_rules.find(rule => {
			if (rule.path_regex) {
				const regex = new RegExp(rule.path_regex);
				return regex.test(relativePath);
			}
			return true; // 如果沒有 path_regex，使用第一個規則
		});

		if (!matchedRule) {
			matchedRule = sopsConfig.creation_rules[0];
		}

		// 檢查是否有 KMS ARN
		if (matchedRule.kms) {
			const kmsArn = Array.isArray(matchedRule.kms) ? matchedRule.kms[0] : matchedRule.kms;
			
			// 從 KMS ARN 提取 Account ID
			// KMS ARN 格式: arn:aws:kms:region:account-id:key/key-id
			const arnMatch = kmsArn.match(/arn:aws:kms:[^:]+:(\d{12}):/);
			if (arnMatch && arnMatch[1]) {
				const accountId = arnMatch[1];
				const profile = accountProfileMapping[accountId];
				if (profile) {
					return profile;
				}
			}
		}

		return undefined;
	}

	async decryptFile(filePath: string, awsProfile?: string): Promise<string> {
		const config = vscode.workspace.getConfiguration('sopsView');
		const sopsPath = config.get<string>('sopsExecutablePath', 'sops');

		return new Promise((resolve, reject) => {
			const env = { ...process.env };
			// if (awsProfile) {
			// 	env.AWS_PROFILE = awsProfile;
			// }
      console.log(env);
      console.log(sopsPath);
      console.log(filePath);
      console.log(path.dirname(filePath));
			const child = spawn(sopsPath, ['-d', filePath], {
				env,
				cwd: path.dirname(filePath)
			});

			let stdout = '';
			let stderr = '';

			child.stdout.on('data', (data) => {
				stdout += data.toString();
			});

			child.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			child.on('close', (code) => {
				if (code === 0) {
					resolve(stdout);
				} else {
					reject(new Error(`sops 解密失敗 (exit code ${code}): ${stderr || stdout}`));
				}
			});

			child.on('error', (error) => {
				reject(new Error(`無法執行 sops 命令: ${error.message}`));
			});
		});
	}

	async encryptFile(filePath: string, content: string, awsProfile?: string): Promise<void> {
		const config = vscode.workspace.getConfiguration('sopsView');
		const sopsPath = config.get<string>('sopsExecutablePath', 'sops');

		return new Promise((resolve, reject) => {
			const env = { ...process.env };
			if (awsProfile) {
				env.AWS_PROFILE = awsProfile;
			}

			// 使用 stdin 輸入，適用於所有平台
			const child = spawn(sopsPath, ['-e', '-'], {
				env,
				cwd: path.dirname(filePath),
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stderr = '';

			// 寫入內容到 stdin
			child.stdin.write(content, 'utf8');
			child.stdin.end();

			// 收集加密後的內容
			let encryptedContent = '';
			child.stdout.on('data', (data) => {
				encryptedContent += data.toString();
			});

			child.stderr.on('data', (data) => {
				stderr += data.toString();
			});

			child.on('close', (code) => {
				if (code === 0) {
					// 寫回檔案
					fs.writeFileSync(filePath, encryptedContent, 'utf8');
					resolve();
				} else {
					reject(new Error(`sops 加密失敗 (exit code ${code}): ${stderr}`));
				}
			});

			child.on('error', (error) => {
				reject(new Error(`無法執行 sops 命令: ${error.message}`));
			});
		});
	}

	clearCache(uri?: vscode.Uri) {
		if (uri) {
			this.decryptedContentCache.delete(uri.fsPath);
		} else {
			this.decryptedContentCache.clear();
		}
		this._onDidChange.fire(uri || vscode.Uri.parse('sops-view://clear-all'));
	}
}
