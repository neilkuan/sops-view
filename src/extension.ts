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
				// 關閉原始加密檔案（如果已開啟）
				const editor = vscode.window.visibleTextEditors.find(
					e => e.document.uri.fsPath === document.uri.fsPath
				);
				if (editor) {
					await vscode.window.showTextDocument(editor.document, { preview: true });
					await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
				}
				// 開啟解密版本
				await openDecryptedFile(document.uri);
			}, 200);
		}
	});

	// 監聽檔案變更事件（當檔案被儲存時加密並寫回原始檔案）
	const saveWatcher = vscode.workspace.onDidSaveTextDocument(async (document) => {
		if (document.uri.scheme === 'sops-view') {
			// 提取原始檔案路徑
			let originalFilePath: string;
			if (process.platform === 'win32' && document.uri.path.startsWith('/')) {
				originalFilePath = document.uri.path.substring(1);
			} else {
				originalFilePath = document.uri.path;
			}

			const originalUri = vscode.Uri.file(originalFilePath);
			const workspaceFolder = vscode.workspace.getWorkspaceFolder(originalUri);
			
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('無法找到工作區資料夾');
				return;
			}

			try {
				// 尋找 .sops.yaml 配置
				const sopsConfig = await sopsProvider.findSopsConfig(workspaceFolder.uri.fsPath);
				
				// 解析 KMS ARN 並確定 AWS Profile
				const awsProfile = await sopsProvider.determineAwsProfile(
					originalFilePath,
					sopsConfig,
					workspaceFolder.uri.fsPath
				);

				// 加密並寫回檔案
				await sopsProvider.encryptFile(originalFilePath, document.getText(), awsProfile);
				
				// 清除快取
				sopsProvider.clearCache(originalUri);
				
				vscode.window.showInformationMessage('檔案已加密並儲存');
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error);
				vscode.window.showErrorMessage(`加密並儲存檔案失敗: ${errorMessage}`);
			}
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
				await openDecryptedFile(uri);
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
		saveWatcher,
		openDecryptedCommand,
		reloadCommand
	);
}

async function openDecryptedFile(uri: vscode.Uri) {
	try {
		// 創建自訂 URI
		// 使用 file:// 前綴來確保路徑正確
		const filePath = uri.fsPath;
		const decryptedUri = vscode.Uri.parse(`sops-view://file${filePath}`);

		// 開啟解密後的檔案
		const document = await vscode.workspace.openTextDocument(decryptedUri);
		await vscode.window.showTextDocument(document, {
			preview: false,
			viewColumn: vscode.ViewColumn.Active
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
		'secrets.yml'
	]);
	fileMatcher.updatePatterns(filePatterns);
}

// This method is called when your extension is deactivated
export function deactivate() {
	sopsProvider?.clearCache();
}
