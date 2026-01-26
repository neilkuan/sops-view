// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';
import { minimatch } from 'minimatch';
import { SopsDocumentContentProvider } from './sopsProvider';
import { FileMatcher } from './fileMatcher';

let sopsProvider: SopsDocumentContentProvider;
let fileMatcher: FileMatcher;
let outputChannel: vscode.OutputChannel;
// 追蹤正在進行 sops edit 的檔案（避免重複觸發）
const editingFiles = new Set<string>();

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('SOPS View extension is now active!');

	// 創建 Output Channel 用於顯示日誌
	outputChannel = vscode.window.createOutputChannel('SOPS View');
	outputChannel.appendLine('SOPS View extension is now active!');

	// 初始化 SOPS Provider
	sopsProvider = new SopsDocumentContentProvider(outputChannel);
	fileMatcher = new FileMatcher();

	// 註冊自訂 URI scheme
	const providerRegistration = vscode.workspace.registerTextDocumentContentProvider(
		'sops-view',
		sopsProvider
	);

	// 載入配置
	loadConfiguration();

	// 監聽配置變更
	const configWatcher = vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('sopsView')) {
			loadConfiguration();
			sopsProvider.clearCache();
		}
	});

	// 追蹤最近處理的檔案和時間，避免短時間內重複觸發（10秒內）
	const processedFiles = new Map<string, number>();
	const PROCESS_COOLDOWN = 10000; // 10秒冷卻時間
	
	// 處理 SOPS 檔案的函數
	const handleSopsFile = async (uri: vscode.Uri, source: string) => {
		const filePath = uri.fsPath;
		const fileKey = `${uri.scheme}:${filePath}`;
		const now = Date.now();
		
		const config = vscode.workspace.getConfiguration('sopsView');
		const debugMode = config.get<boolean>('debug', false);
		
		const log = (message: string) => {
			if (debugMode) {
				outputChannel.appendLine(`[DEBUG] [${source}] ${message}`);
			}
			console.log(`[${source}] ${message}`);
		};
		
		// 檢查檔案是否正在進行 sops edit
		if (editingFiles.has(fileKey)) {
			log(`檔案正在進行 sops edit，跳過: ${filePath}`);
			return;
		}
		
		// 檢查是否在冷卻期內
		const lastProcessed = processedFiles.get(fileKey);
		if (lastProcessed && (now - lastProcessed) < PROCESS_COOLDOWN) {
			if (debugMode) {
				outputChannel.appendLine(`[DEBUG] [${source}] 檔案在冷卻期內，跳過: ${filePath}`);
			}
			return;
		}
		
		// 跳過 sops-view scheme 的檔案
		if (uri.scheme === 'sops-view') {
			return;
		}
		
		if (uri.scheme !== 'file') {
			return;
		}
		
		log(`開始檢查檔案: ${filePath}`);
		
		// 先檢查檔案名稱模式（快速檢查）
		const matchesPattern = fileMatcher.getPatterns().some(pattern => {
			const fileName = path.basename(filePath);
			const relativePath = vscode.workspace.asRelativePath(filePath, false);
			return minimatch(fileName, pattern) || minimatch(relativePath, pattern);
		});
		
		if (matchesPattern) {
			log(`檔案名稱匹配模式: ${filePath}`);
			// 延遲一下，確保檔案內容已載入
			setTimeout(async () => {
				// 再次確認檔案是 SOPS 加密檔案（使用更可靠的檢查方法）
				if (sopsProvider.isSopsEncryptedFile(filePath)) {
					// 檢查是否正在編輯中
					if (editingFiles.has(fileKey)) {
						log(`檔案正在進行 sops edit，跳過: ${filePath}`);
						return;
					}
					log(`確認是 SOPS 加密檔案，執行 sops edit: ${filePath}`);
					processedFiles.set(fileKey, Date.now());
					await openDecryptedFile(uri, context);
				} else {
					log(`檔案名稱匹配但內容檢查失敗: ${filePath}`);
				}
			}, 300);
			return;
		}
		
		// 如果檔案名稱不匹配，嘗試檢查檔案內容（較慢，但更準確）
		// 使用延遲檢查，避免阻塞
		setTimeout(async () => {
			try {
				if (fileMatcher.isSopsFile(filePath)) {
					log(`檔案內容檢查確認是 SOPS 檔案: ${filePath}`);
					// 再次確認
					if (sopsProvider.isSopsEncryptedFile(filePath)) {
						// 檢查是否正在編輯中
						if (editingFiles.has(fileKey)) {
							log(`檔案正在進行 sops edit，跳過: ${filePath}`);
							return;
						}
						processedFiles.set(fileKey, Date.now());
						await openDecryptedFile(uri, context);
					}
				}
			} catch (error) {
				// 忽略檢查錯誤
				if (debugMode) {
					outputChannel.appendLine(`[DEBUG] [${source}] 檔案檢查錯誤: ${error}`);
				}
			}
		}, 500);
	};
	
	// 監聽檔案開啟事件 - 當用戶點擊 SOPS 檔案時自動開啟解密版本
	// 只監聽新開啟的檔案，不監聽編輯器切換（避免太敏感）
	const fileWatcher = vscode.workspace.onDidOpenTextDocument(async (document) => {
		// 只處理 file scheme 的檔案，並且是剛剛開啟的（不是已經存在的）
		if (document.uri.scheme === 'file') {
			// 增加延遲，避免與 VSCode 的預設行為衝突
			setTimeout(async () => {
				await handleSopsFile(document.uri, 'onDidOpenTextDocument');
			}, 500);
		}
	});
	
	// 定期清理過期的處理記錄（每分鐘清理一次）
	setInterval(() => {
		const now = Date.now();
		for (const [key, timestamp] of processedFiles.entries()) {
			if (now - timestamp > PROCESS_COOLDOWN * 2) {
				processedFiles.delete(key);
			}
		}
	}, 60000);


	// 註冊命令：手動開啟解密檔案
	const openDecryptedCommand = vscode.commands.registerCommand(
		'sops-view.openDecrypted',
		async (uri?: vscode.Uri) => {
			if (!uri) {
				const activeEditor = vscode.window.activeTextEditor;
				if (activeEditor) {
					uri = activeEditor.document.uri;
				} else {
					vscode.window.showErrorMessage('SOPS-View: 請先選擇一個檔案');
					return;
				}
			}

			if (uri.scheme === 'file' && fileMatcher.isSopsFile(uri.fsPath)) {
				await openDecryptedFile(uri, context);
			} else {
				vscode.window.showWarningMessage('SOPS-View: 此檔案不是 SOPS 加密檔案');
			}
		}
	);

	// 註冊命令：重新載入解密檔案
	const reloadCommand = vscode.commands.registerCommand(
		'sops-view.reload',
		async () => {
			const activeEditor = vscode.window.activeTextEditor;
			if (activeEditor && activeEditor.document.uri.scheme === 'sops-view') {
				sopsProvider.clearCache();
				await vscode.commands.executeCommand('workbench.action.reloadWindow');
			} else {
				vscode.window.showInformationMessage('SOPS-View: 請先開啟一個解密檔案');
			}
		}
	);

	context.subscriptions.push(
		providerRegistration,
		configWatcher,
		fileWatcher,
		openDecryptedCommand,
		reloadCommand
	);
}

async function openDecryptedFile(uri: vscode.Uri, context: vscode.ExtensionContext) {
	const { spawn } = require('child_process');
	const path = require('path');
	const fs = require('fs');
	
	const config = vscode.workspace.getConfiguration('sopsView');
	const debugMode = config.get<boolean>('debug', false);
	
	const log = (message: string) => {
		if (debugMode) {
			outputChannel.appendLine(`[DEBUG] ${message}`);
		}
		console.log(message);
	};
	
	const logError = (message: string) => {
		outputChannel.appendLine(`[ERROR] ${message}`);
		console.error(message);
	};
	
	try {
		const filePath = uri.fsPath;
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		const fallbackRoot = path.dirname(filePath);

		log(`開始處理檔案: ${filePath}`);

		// 在開始 sops edit 前，記錄要關閉的編輯器
		// 這樣可以確保在 sops edit 完成後正確關閉
		const editorsToCloseBeforeEdit = vscode.window.visibleTextEditors.filter(editor => {
			return editor.document.uri.fsPath === filePath && editor.document.uri.scheme === 'file';
		});

		if (!sopsProvider.isSopsEncryptedFile(filePath)) {
			const msg = `SOPS-View: 此檔案不是 SOPS 加密檔案: ${filePath}`;
			logError(msg);
			vscode.window.showWarningMessage(msg);
			return;
		}

		log('檔案已確認為 SOPS 加密檔案');

		// 標記檔案為正在編輯中
		const fileKey = `file:${filePath}`;
		if (editingFiles.has(fileKey)) {
			log(`檔案正在進行 sops edit，跳過: ${filePath}`);
			return;
		}
		editingFiles.add(fileKey);
		log(`標記檔案為編輯中: ${filePath}`);

		// 使用 sops edit 的方式：
		// 設置 EDITOR 環境變數為當前編輯器，然後執行 sops edit
		// sops 會自動處理解密、編輯和加密
		
		// 尋找 .sops.yaml/.sops.yml 配置（由檔案位置向上尋找）
		log('正在尋找 .sops.yaml 配置...');
		const { config: sopsConfig, configDir } = await sopsProvider.findSopsConfig(filePath);
		log(`找到配置目錄: ${configDir || '未找到'}`);
		
		// 解析 KMS ARN 並確定 AWS Profile
		log('正在確定 AWS Profile...');
		const awsProfile = await sopsProvider.determineAwsProfile(
			filePath,
			sopsConfig,
			configDir || workspaceFolder?.uri.fsPath || fallbackRoot
		);
		log(`AWS Profile: ${awsProfile || '未設定'}`);

		// 檢測當前使用的編輯器命令（cursor 或 code）
		// 使用命令名稱而不是完整路徑，這樣更可靠
		let editorCommand: string;
		
		// 檢查是否是 Cursor（process.execPath 包含 Cursor）
		if (process.execPath.includes('Cursor')) {
			editorCommand = 'cursor --wait';
		} else {
			// 預設使用 code
			editorCommand = 'code --wait';
		}
		
		log(`EDITOR 命令: ${editorCommand}`);
		log(`執行路徑: ${process.execPath}`);

		// 設置環境變數
		const env = { ...process.env };
		env.EDITOR = editorCommand;
		if (awsProfile) {
			env.AWS_PROFILE = awsProfile;
		}
		
		log(`環境變數 EDITOR: ${env.EDITOR}`);
		log(`環境變數 AWS_PROFILE: ${env.AWS_PROFILE || '未設定'}`);

		// 執行 sops edit
		const sopsPath = config.get<string>('sopsExecutablePath', 'sops');
		log(`SOPS 可執行檔路徑: ${sopsPath}`);

		// 顯示相對於工作區的路徑
		const workspaceRelativePath = workspaceFolder 
			? path.relative(workspaceFolder.uri.fsPath, filePath)
			: path.basename(filePath);
		
		const infoMsg = `SOPS-View: sops edit: ${awsProfile || 'default'} ${workspaceRelativePath}`;
		log(`執行命令: ${sopsPath} edit ${filePath}`);
		vscode.window.showInformationMessage(infoMsg);
		
		// 顯示 Output Channel（如果啟用 debug 模式）
		if (debugMode) {
			outputChannel.show(true);
		}

		// 使用 shell: true 來正確處理 EDITOR 環境變數
		// 並且收集 stderr 以便顯示錯誤訊息
		let stdout = '';
		let stderr = '';
		
		log('正在啟動 sops edit 程序...');
		const child = spawn(sopsPath, ['edit', filePath], {
			env,
			cwd: path.dirname(filePath),
			stdio: ['inherit', 'pipe', 'pipe'],
			shell: true
		});

		child.stdout.on('data', (data: Buffer) => {
			const output = data.toString();
			stdout += output;
			log(`[STDOUT] ${output.trim()}`);
		});

		child.stderr.on('data', (data: Buffer) => {
			const output = data.toString();
			stderr += output;
			logError(`[STDERR] ${output.trim()}`);
		});

		child.on('close', async (code: number) => {
			log(`程序結束，退出碼: ${code}`);
			
			// 無論成功或失敗，都要移除編輯中的標記
			editingFiles.delete(fileKey);
			log(`移除檔案編輯中標記: ${filePath}`);
			
			if (code === 0) {
				const msg = 'SOPS-View: 檔案已成功編輯並加密儲存';
				log(msg);
				vscode.window.showInformationMessage(msg);
				// 清除快取
				sopsProvider.clearCache(uri);
				
				// 關閉原始加密檔案的視窗
				// 使用在開始 sops edit 前記錄的編輯器列表
				try {
					if (editorsToCloseBeforeEdit.length > 0) {
						log(`準備關閉 ${editorsToCloseBeforeEdit.length} 個編輯器視窗`);
						
						// 等待一下，確保 sops edit 開啟的新編輯器已經顯示
						await new Promise(resolve => setTimeout(resolve, 300));
						
						// 查找當前仍然開啟的原始檔案編輯器
						const currentEditorsToClose = vscode.window.visibleTextEditors.filter(editor => {
							return editor.document.uri.fsPath === filePath && editor.document.uri.scheme === 'file';
						});
						
						if (currentEditorsToClose.length > 0) {
							log(`找到 ${currentEditorsToClose.length} 個需要關閉的編輯器視窗`);
							
							// 逐一關閉編輯器（避免並行操作導致問題）
							for (const editor of currentEditorsToClose) {
								try {
									// 先切換到該編輯器，然後關閉
									await vscode.window.showTextDocument(editor.document, { 
										preview: false,
										preserveFocus: false 
									});
									await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
									log(`已關閉編輯器: ${path.basename(editor.document.uri.fsPath)}`);
								} catch (error) {
									const errorMsg = error instanceof Error ? error.message : String(error);
									logError(`關閉編輯器失敗: ${errorMsg}`);
								}
							}
							log(`所有編輯器視窗已關閉`);
						} else {
							log(`編輯器視窗已經被關閉或不存在`);
						}
					} else {
						log(`未找到需要關閉的編輯器視窗`);
					}
				} catch (error) {
					const errorMsg = error instanceof Error ? error.message : String(error);
					logError(`關閉編輯器時發生錯誤: ${errorMsg}`);
				}
				return;
			}

			if (code === 200) {
				const msg = 'SOPS-View: 檔案未變更，未重新加密';
				log(msg);
				vscode.window.showInformationMessage(msg);
				return;
			}

			if (stderr.toLowerCase().includes('metadata not found')) {
				const msg = 'SOPS-View: 此檔案未包含 SOPS metadata';
				logError(msg);
				vscode.window.showWarningMessage(msg);
				return;
			}

			const errorMsg = stderr ? `: ${stderr}` : '';
			const fullError = `SOPS-View: sops edit 失敗 (exit code ${code})${errorMsg}`;
			logError(fullError);
			logError(`完整 stdout: ${stdout}`);
			logError(`完整 stderr: ${stderr}`);
			vscode.window.showErrorMessage(fullError);
			
			// 顯示 Output Channel 以便查看詳細錯誤
			outputChannel.show(true);
		});

		child.on('error', (error: Error) => {
			// 移除編輯中的標記
			editingFiles.delete(fileKey);
			log(`移除檔案編輯中標記（錯誤）: ${filePath}`);
			
			const errorMsg = `SOPS-View: 無法執行 sops edit: ${error.message}`;
			logError(errorMsg);
			logError(`錯誤堆疊: ${error.stack || '無'}`);
			vscode.window.showErrorMessage(errorMsg);
			outputChannel.show(true);
		});

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		const fullError = `SOPS-View: 無法開啟解密檔案: ${errorMessage}`;
		logError(fullError);
		if (error instanceof Error && error.stack) {
			logError(`錯誤堆疊: ${error.stack}`);
		}
		vscode.window.showErrorMessage(fullError);
		outputChannel.show(true);
	}
}

function loadConfiguration() {
	const config = vscode.workspace.getConfiguration('sopsView');
	const filePatterns = config.get<string[]>('filePatterns', [
		'*.encrypted.yaml',
		'*.encrypted.yml',
		'*.sops.yaml',
		'*.sops.yml',
		'secrets.yaml',
		'secrets.yml',
		'secrets.*.yaml',
		'secrets.*.yml',
		'secret.yaml',
		'secret.yml',
    'secret.*.yaml',
		'secret.*.yml',
		'*.enc.json',
		'*.enc.yml',
		'*.enc.yaml'
	]);
	fileMatcher.updatePatterns(filePatterns);
}

// This method is called when your extension is deactivated
export function deactivate() {
	sopsProvider?.clearCache();
	outputChannel?.dispose();
}
