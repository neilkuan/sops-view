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
	private readonly sopsConfigCache = new Map<string, { config: SopsConfig | null; configDir?: string }>();
	private readonly decryptedContentCache = new Map<string, { content: string; timestamp: number }>();

	readonly onDidChange = this._onDidChange.event;

	public isSopsEncryptedFile(filePath: string): boolean {
		try {
			if (!fs.existsSync(filePath)) {
				return false;
			}
			const content = fs.readFileSync(filePath, 'utf8');
			const hasSopsKey = content.includes('sops:') || /"sops"\s*:/.test(content);
			const hasEncMarker = /ENC\[(AES256_GCM|AES128_GCM|PGP)/.test(content);
			return hasSopsKey || hasEncMarker;
		} catch (error) {
			return false;
		}
	}

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
		const fallbackRoot = path.dirname(filePath);

		// 檢查快取
		const cached = this.decryptedContentCache.get(filePath);
		if (cached && Date.now() - cached.timestamp < 5000) {
			return cached.content;
		}

		try {
			// 讀取加密檔案
			const encryptedContent = fs.readFileSync(filePath, 'utf8');
			
			// 尋找 .sops.yaml 配置
			const { config: sopsConfig, configDir } = await this.findSopsConfig(filePath);
			
			// 解析 KMS ARN 並確定 AWS Profile
			const awsProfile = await this.determineAwsProfile(
				filePath,
				sopsConfig,
				configDir || workspaceFolder?.uri.fsPath || fallbackRoot
			);
			
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

	public async findSopsConfig(filePath: string): Promise<{ config: SopsConfig | null; configDir?: string }> {
		const startDir = path.dirname(filePath);

		// 檢查快取
		if (this.sopsConfigCache.has(startDir)) {
			return this.sopsConfigCache.get(startDir) || { config: null };
		}

		let currentDir = startDir;
		let configDir: string | undefined;
		let config: SopsConfig | null = null;

		// 從檔案所在資料夾向上搜尋 .sops.yaml/.sops.yml
		while (currentDir !== path.dirname(currentDir)) {
			const yamlPath = path.join(currentDir, '.sops.yaml');
			const ymlPath = path.join(currentDir, '.sops.yml');
			const candidatePath = fs.existsSync(yamlPath) ? yamlPath : (fs.existsSync(ymlPath) ? ymlPath : undefined);

			if (candidatePath) {
				try {
					const configContent = fs.readFileSync(candidatePath, 'utf8');
					config = yaml.load(configContent) as SopsConfig;
					configDir = currentDir;
					break;
				} catch (error) {
					console.error(`讀取 .sops 設定失敗: ${candidatePath}`, error);
				}
			}
			currentDir = path.dirname(currentDir);
		}

		const result = { config, configDir };
		this.sopsConfigCache.set(startDir, result);
		return result;
	}

	public async determineAwsProfile(
		filePath: string,
		sopsConfig: SopsConfig | null,
		configRoot: string
	): Promise<string | undefined> {
		const config = vscode.workspace.getConfiguration('sopsView');
		const accountProfileMapping = config.get<AwsAccountProfileMapping>('awsAccountProfileMapping', {});

		if (!sopsConfig || !sopsConfig.creation_rules) {
			return undefined;
		}

		// 尋找匹配的 creation rule
		const relativePath = path.relative(configRoot, filePath).split(path.sep).join('/');
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

	public async decryptFile(filePath: string, awsProfile?: string): Promise<string> {
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

			// 使用類似 sops edit 的方式：
			// 1. 將解密內容寫入臨時檔案
			// 2. 使用 sops -e 加密臨時檔案（sops -e 會直接修改檔案）
			// 3. 讀取加密後的內容並寫回原始檔案
			const tempFile = path.join(path.dirname(filePath), `.sops-temp-${Date.now()}.yaml`);
			
			try {
				// 寫入臨時檔案
				fs.writeFileSync(tempFile, content, 'utf8');

				// 使用 sops -e 加密臨時檔案（這會直接修改臨時檔案）
				const child = spawn(sopsPath, ['-e', tempFile], {
					env,
					cwd: path.dirname(filePath),
					stdio: ['pipe', 'pipe', 'pipe']
				});

				let stderr = '';

				child.stderr.on('data', (data) => {
					stderr += data.toString();
				});

				child.on('close', (code) => {
					if (code === 0) {
						try {
							// 讀取加密後的臨時檔案內容
							const encryptedContent = fs.readFileSync(tempFile, 'utf8');
							// 寫回原始檔案
							fs.writeFileSync(filePath, encryptedContent, 'utf8');
							
							// 清理臨時檔案
							try {
								if (fs.existsSync(tempFile)) {
									fs.unlinkSync(tempFile);
								}
							} catch (cleanupError) {
								// 忽略清理錯誤
							}
							
							resolve();
						} catch (readError) {
							// 清理臨時檔案
							try {
								if (fs.existsSync(tempFile)) {
									fs.unlinkSync(tempFile);
								}
							} catch (cleanupError) {
								// 忽略清理錯誤
							}
							reject(new Error(`無法讀取加密後的檔案: ${readError instanceof Error ? readError.message : String(readError)}`));
						}
					} else {
						// 清理臨時檔案
						try {
							if (fs.existsSync(tempFile)) {
								fs.unlinkSync(tempFile);
							}
						} catch (cleanupError) {
							// 忽略清理錯誤
						}
						reject(new Error(`sops 加密失敗 (exit code ${code}): ${stderr}`));
					}
				});

				child.on('error', (error) => {
					// 清理臨時檔案
					try {
						if (fs.existsSync(tempFile)) {
							fs.unlinkSync(tempFile);
						}
					} catch (cleanupError) {
						// 忽略清理錯誤
					}
					reject(new Error(`無法執行 sops 命令: ${error.message}`));
				});
			} catch (error) {
				// 清理臨時檔案
				try {
					if (fs.existsSync(tempFile)) {
						fs.unlinkSync(tempFile);
					}
				} catch (cleanupError) {
					// 忽略清理錯誤
				}
				reject(new Error(`無法創建臨時檔案: ${error instanceof Error ? error.message : String(error)}`));
			}
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
