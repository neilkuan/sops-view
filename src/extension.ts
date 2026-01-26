// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { SopsDocumentContentProvider } from './sopsProvider';
import { FileMatcher } from './fileMatcher';

let sopsProvider: SopsDocumentContentProvider;
let fileMatcher: FileMatcher;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('SOPS View extension is now active!');

	// 初始化 SOPS Provider
	sopsProvider = new SopsDocumentContentProvider();
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

	// 監聽檔案開啟事件 - 當用戶點擊 SOPS 檔案時自動開啟解密版本
	const fileWatcher = vscode.workspace.onDidOpenTextDocument(async (document) => {
		if (document.uri.scheme === 'file' && fileMatcher.isSopsFile(document.uri.fsPath)) {
			// 延遲一下，避免與 VSCode 的預設行為衝突
			setTimeout(async () => {
				// 開啟解密版本
				await openDecryptedFile(document.uri, context);
			}, 200);
		}
	});


	// 註冊命令：手動開啟解密檔案
	const openDecryptedCommand = vscode.commands.registerCommand(
		'sops-view.openDecrypted',
		async (uri?: vscode.Uri) => {
			if (!uri) {
				const activeEditor = vscode.window.activeTextEditor;
				if (activeEditor) {
					uri = activeEditor.document.uri;
				} else {
					vscode.window.showErrorMessage('請先選擇一個檔案');
					return;
				}
			}

			if (uri.scheme === 'file' && fileMatcher.isSopsFile(uri.fsPath)) {
				await openDecryptedFile(uri, context);
			} else {
				vscode.window.showWarningMessage('此檔案不是 SOPS 加密檔案');
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
				vscode.window.showInformationMessage('請先開啟一個解密檔案');
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
	
	try {
		const filePath = uri.fsPath;
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
		const fallbackRoot = path.dirname(filePath);

		if (!sopsProvider.isSopsEncryptedFile(filePath)) {
			vscode.window.showWarningMessage(`此檔案不是 SOPS 加密檔案, ${filePath}`);
			return;
		}

		// 使用 sops edit 的方式：
		// 設置 EDITOR 環境變數為當前編輯器，然後執行 sops edit
		// sops 會自動處理解密、編輯和加密
		
		// 尋找 .sops.yaml/.sops.yml 配置（由檔案位置向上尋找）
		const { config: sopsConfig, configDir } = await sopsProvider.findSopsConfig(filePath);
		
		// 解析 KMS ARN 並確定 AWS Profile
		const awsProfile = await sopsProvider.determineAwsProfile(
			filePath,
			sopsConfig,
			configDir || workspaceFolder?.uri.fsPath || fallbackRoot
		);

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
		
		console.log('EDITOR command:', editorCommand);

		// 設置環境變數
		const env = { ...process.env };
		env.EDITOR = editorCommand;
		if (awsProfile) {
			env.AWS_PROFILE = awsProfile;
		}

		// 執行 sops edit
		const config = vscode.workspace.getConfiguration('sopsView');
		const sopsPath = config.get<string>('sopsExecutablePath', 'sops');

		// 顯示相對於工作區的路徑
		const workspaceRelativePath = workspaceFolder 
			? path.relative(workspaceFolder.uri.fsPath, filePath)
			: path.basename(filePath);
		vscode.window.showInformationMessage(`sops edit: ${awsProfile} ${workspaceRelativePath}`);

		// 使用 shell: true 來正確處理 EDITOR 環境變數
		// 並且收集 stderr 以便顯示錯誤訊息
		let stderr = '';
		const child = spawn(sopsPath, ['edit', filePath], {
			env,
			cwd: path.dirname(filePath),
			stdio: ['inherit', 'inherit', 'pipe'],
			shell: true
		});

		child.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		child.on('close', (code: number) => {
			if (code === 0) {
				vscode.window.showInformationMessage('檔案已成功編輯並加密儲存');
				// 清除快取
				sopsProvider.clearCache(uri);
				return;
			}

			if (code === 200) {
				vscode.window.showInformationMessage('檔案未變更，未重新加密');
				return;
			}

			if (stderr.toLowerCase().includes('metadata not found')) {
				vscode.window.showWarningMessage('此檔案未包含 SOPS metadata');
				return;
			}

			const errorMsg = stderr ? `: ${stderr}` : '';
			vscode.window.showErrorMessage(`sops edit 失敗 (exit code ${code})${errorMsg}`);
			console.error('sops edit error:', stderr);
		});

		child.on('error', (error: Error) => {
			vscode.window.showErrorMessage(`無法執行 sops edit: ${error.message}`);
		});

	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		vscode.window.showErrorMessage(`無法開啟解密檔案: ${errorMessage}`);
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
}
