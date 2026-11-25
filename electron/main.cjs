// デスクトップ版（Electron）の起動ファイル。
// - 開発中（npm run electron:dev）：環境変数 VITE_DEV_SERVER_URL の vite 開発サーバーを開く
// - 配る版（npm run electron:build）：vite --mode electron でビルドした dist-electron/index.html を file:// で開く
// 窓の大きさ・位置は覚えない。メニューは最小限（表示・開発者ツール・終了）。
// 保存は localStorage のまま（Electron の userData フォルダに残る）。
const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('node:path');

const devUrl = process.env.VITE_DEV_SERVER_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1d2a33',
    title: '生き物を呼ぶ箱庭',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // 外へのリンクはアプリの中で開かず、ふだんのブラウザで開く
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist-electron', 'index.html'));
}

const menu = Menu.buildFromTemplate([
  {
    label: '表示',
    submenu: [
      { role: 'reload', label: '再読み込み' },
      { role: 'togglefullscreen', label: '全画面' },
      { role: 'toggleDevTools', label: '開発者ツール' },
      { type: 'separator' },
      { role: 'quit', label: '終了' },
    ],
  },
]);

app.whenReady().then(() => {
  Menu.setApplicationMenu(menu);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
