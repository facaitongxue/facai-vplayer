// 独立视频播放器 —— 主进程
// 安装后与视频文件关联：双击视频文件即用本程序打开；
// 播放窗口沿用原「短视频管理系统」双击播放的窗口逻辑（按视频尺寸自适应、记住窗口大小、ESC 关闭），
// 并新增左侧边栏：默认列出当前视频所在文件夹内的所有视频，点击即播放。

const { app, BrowserWindow, Menu, ipcMain, dialog, shell, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const net = require('net');
const os = require('os');
const { spawn } = require('child_process');

const APP_TITLE = '视频播放器';

// 参与文件关联的视频格式（与安装包 fileAssociations 保持一致）
const VIDEO_EXTS = [
  '.mp4', '.m4v', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm',
  '.mpg', '.mpeg', '.ts', '.m2ts', '.mts', '.3gp', '.3g2', '.rmvb',
  '.rm', '.vob', '.ogv', '.ogm', '.asf', '.f4v', '.divx', '.mxf'
];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

const SIDEBAR_WIDTH = 240; // 与 renderer/style.css 中侧边栏宽度保持一致

let mainWindow = null;
let pendingOpenPath = null;   // 启动参数里待打开的文件
let lastFitAt = 0;            // 最近一次「按视频尺寸自适应」的时间，避免把自动调整当成用户尺寸保存
let saveBoundsTimer = null;
let userSized = false;        // 用户手动调整过窗口尺寸（只有这种情况才记住尺寸）

// ============ 配置（窗口尺寸记忆） ============
function settingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
  } catch (error) {
    return {};
  }
}

function saveSettings(settings) {
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存设置失败:', error);
  }
}

// ============ 文件工具 ============
function isExistingFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

function isVideoFile(filePath) {
  return VIDEO_EXTS.includes(path.extname(filePath || '').toLowerCase());
}

function isImageFile(filePath) {
  return IMAGE_EXTS.includes(path.extname(filePath || '').toLowerCase());
}

// 列出文件夹内所有视频（按名称自然排序）
function listVideos(folder) {
  try {
    return fs.readdirSync(folder, { withFileTypes: true })
      .filter(entry => entry.isFile() && isVideoFile(entry.name))
      .map(entry => {
        const fullPath = path.join(folder, entry.name);
        let stats = null;
        try {
          stats = fs.statSync(fullPath);
        } catch (error) {
          return null;
        }
        return {
          name: entry.name,
          path: fullPath,
          size: stats.size,
          modified: stats.mtimeMs
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }));
  } catch (error) {
    console.error('读取文件夹视频列表失败:', error);
    return [];
  }
}

// 描述一个待播放文件：文件本身 + 同文件夹视频
function describeFile(filePath) {
  const folder = path.dirname(filePath);
  return {
    filePath,
    folder,
    folderName: path.basename(folder),
    isVideo: isVideoFile(filePath),
    isImage: isImageFile(filePath),
    videos: listVideos(folder)
  };
}

// 从启动参数中找出要打开的文件
function findOpenArgument(argv) {
  const args = Array.isArray(argv) ? argv.slice(process.defaultApp ? 2 : 1) : [];
  for (const raw of args) {
    if (!raw || raw.startsWith('--')) continue;
    const candidate = raw.replace(/^"(.*)"$/, '$1');
    if (isExistingFile(candidate)) return path.resolve(candidate);
  }
  return null;
}

// 读取并清除启动时的待打开文件
function takePendingPath() {
  const filePath = pendingOpenPath;
  pendingOpenPath = null;
  if (filePath && isExistingFile(filePath)) return filePath;
  return null;
}

// ============ 窗口 ============
function clampBoundsToWorkArea(bounds) {
  if (!bounds || !bounds.width || !bounds.height) return null;
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  const width = Math.min(Math.max(bounds.width, 720), area.width);
  const height = Math.min(Math.max(bounds.height, 420), area.height);
  const x = Math.min(Math.max(bounds.x ?? area.x, area.x), area.x + area.width - width);
  const y = Math.min(Math.max(bounds.y ?? area.y, area.y), area.y + area.height - height);
  return { x, y, width, height };
}

function rememberWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // 自动按视频尺寸调整后的一小段时间内不保存，避免下次启动被固定成自适应尺寸
  if (Date.now() - lastFitAt < 1200) return;
  const settings = readSettings();
  settings.bounds = mainWindow.getBounds();
  saveSettings(settings);
}

function createWindow() {
  const settings = readSettings();
  const savedBounds = clampBoundsToWorkArea(settings.bounds);
  userSized = Boolean(savedBounds);
  const width = savedBounds ? savedBounds.width : 1180;
  const height = savedBounds ? savedBounds.height : 680;

  mainWindow = new BrowserWindow({
    width,
    height,
    ...(savedBounds ? { x: savedBounds.x, y: savedBounds.y } : {}),
    minWidth: 720,
    minHeight: 420,
    title: APP_TITLE,
    icon: path.join(__dirname, '../build/icon.ico'),
    autoHideMenuBar: true,
    backgroundColor: '#0e1014',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // 本地页面需要直接引用磁盘上的视频文件，沿用原播放窗口的口径
      webSecurity: false,
      spellcheck: false
    }
  });

  const pagePath = path.join(__dirname, '../renderer/index.html');
  const filePath = takePendingPath();
  if (filePath) {
    mainWindow.loadFile(pagePath, { query: { path: filePath } });
  } else {
    mainWindow.loadFile(pagePath);
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
  });

  mainWindow.on('resize', () => {
    if (Date.now() - lastFitAt > 1200) userSized = true;
    clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      if (userSized) rememberWindowBounds();
    }, 400);
  });

  mainWindow.on('close', () => {
    clearTimeout(saveBoundsTimer);
    if (userSized) rememberWindowBounds();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  createMenu();
}

function openFileFromExternal(filePath) {
  if (!filePath || !isExistingFile(filePath)) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    pendingOpenPath = filePath;
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send('player:open-file', filePath);
}

async function pickAndOpen() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开视频',
    properties: ['openFile'],
    filters: [
      { name: '视频文件', extensions: VIDEO_EXTS.map(ext => ext.slice(1)) },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths[0]) {
    openFileFromExternal(result.filePaths[0]);
  }
}

function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开视频…',
          accelerator: 'CmdOrCtrl+O',
          click: () => pickAndOpen()
        },
        {
          label: '刷新侧边栏',
          accelerator: 'F5',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('player:refresh');
            }
          }
        },
        { type: 'separator' },
        { label: '退出', accelerator: 'Alt+F4', click: () => app.quit() }
      ]
    },
    {
      label: '播放',
      submenu: [
        {
          label: '全屏',
          accelerator: 'F11',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setFullScreen(!mainWindow.isFullScreen());
            }
          }
        }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于视频播放器',
          click: () => {
            const options = {
              type: 'info',
              title: '关于视频播放器',
              message: APP_TITLE,
              detail: `版本：${app.getVersion()}\n\n双击视频文件即可播放；\n左侧边栏会列出当前视频所在文件夹里的全部视频，点击即可切换。`,
              buttons: ['确定']
            };
            if (mainWindow && !mainWindow.isDestroyed()) {
              dialog.showMessageBox(mainWindow, options);
            } else {
              dialog.showMessageBox(options);
            }
          }
        }
      ]
    }
  ];

  if (!app.isPackaged) {
    template.push({ label: '开发', submenu: [{ role: 'toggleDevTools' }, { role: 'reload' }] });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============ 单实例：第二次双击视频时复用已打开的窗口 ============
// 不用 Electron 的 requestSingleInstanceLock（在部分受限环境下会因锁文件权限失败而直接退出），
// 改用命名管道：第一个实例监听，后续实例把文件路径发过去后自行退出。
const SINGLE_INSTANCE_PIPE = `\\\\.\\pipe\\shipin-video-player-${(os.userInfo().username || 'user')
  .toLowerCase()
  .replace(/[^a-z0-9._-]/g, '_')}`;

let launchFilePath = null; // 本次启动要打开的文件（供单实例管道兜底使用）

function probeRunningInstance(filePath) {
  return new Promise(resolve => {
    let settled = false;
    const socket = net.connect(SINGLE_INSTANCE_PIPE);
    const finish = (running) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket.destroy();
      } catch (error) {
        // 忽略
      }
      resolve(running);
    };
    const timer = setTimeout(() => finish(false), 800);

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      try {
        socket.write(JSON.stringify({ filePath: filePath || null }) + '\n');
      } catch (error) {
        finish(false);
      }
    });
    socket.on('data', () => finish(true));
    socket.on('close', () => finish(true));
    socket.on('error', () => finish(false));
  });
}

function startSingleInstanceServer() {
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;

      const line = buffer.slice(0, newline);
      try {
        const message = JSON.parse(line || '{}');
        if (message.filePath) {
          openFileFromExternal(message.filePath);
        } else if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
        }
      } catch (error) {
        // 无效消息直接忽略
      }

      try {
        socket.write('ok\n');
        socket.end();
      } catch (error) {
        // 忽略
      }
    });

    socket.on('error', () => { /* 忽略连接错误 */ });
  });

  server.on('error', async (error) => {
    // 两个实例几乎同时启动时，后启动的会拿到 EADDRINUSE：再探测一次，把文件交给先启动的实例
    if (error.code === 'EADDRINUSE') {
      const running = await probeRunningInstance(launchFilePath);
      if (running) app.quit();
    }
  });

  server.listen(SINGLE_INSTANCE_PIPE);
  return server;
}

// macOS 通过 Finder 打开文件（打包仅 Windows，保留兼容）
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    openFileFromExternal(filePath);
  } else {
    pendingOpenPath = filePath;
  }
});

app.whenReady().then(async () => {
  app.setAppUserModelId('com.shipin.videoplayer');

  launchFilePath = findOpenArgument(process.argv) || pendingOpenPath;
  const alreadyRunning = await probeRunningInstance(launchFilePath);
  if (alreadyRunning) {
    app.quit();
    return;
  }

  startSingleInstanceServer();
  pendingOpenPath = launchFilePath;
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============ IPC ============

// 页面初始化：返回启动参数里的文件 + 同文件夹视频
ipcMain.handle('player:init', () => {
  const filePath = takePendingPath();
  if (!filePath) {
    return { filePath: null, folder: null, folderName: '', isVideo: false, isImage: false, videos: [] };
  }
  return describeFile(filePath);
});

// 切换到另一个文件（侧边栏点击 / 拖入文件）
ipcMain.handle('player:switch', (event, filePath) => {
  if (!filePath || !isExistingFile(filePath)) {
    return { error: '文件不存在或已被移动' };
  }
  return describeFile(filePath);
});

// 重新读取某个文件夹的视频列表
ipcMain.handle('player:list', (event, folder) => {
  if (!folder || !fs.existsSync(folder)) return { videos: [] };
  return { videos: listVideos(folder), folder, folderName: path.basename(folder) };
});

// 打开文件选择框
ipcMain.handle('player:pick', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '打开视频',
    properties: ['openFile'],
    filters: [
      { name: '视频文件', extensions: VIDEO_EXTS.map(ext => ext.slice(1)) },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

// 按视频实际尺寸调整窗口（仅当用户还没保存过窗口尺寸时；侧边栏宽度计入窗口宽度）
ipcMain.on('player:fit-size', (event, videoWidth, videoHeight) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    if (!videoWidth || !videoHeight) return;

    const settings = readSettings();
    if (settings.bounds && settings.bounds.width) return; // 用户已有固定尺寸，不再自动调整

    const area = screen.getDisplayNearestPoint(win.getBounds()).workArea;
    const maxWidth = Math.round(area.width * 0.9);
    const maxHeight = Math.round(area.height * 0.9);

    let width = Math.round(videoWidth + SIDEBAR_WIDTH);
    let height = Math.round(videoHeight);
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    lastFitAt = Date.now();
    win.setContentSize(Math.max(760, width), Math.max(430, height), false);
  } catch (error) {
    console.error('调整播放窗口尺寸失败:', error);
  }
});

// 在资源管理器中定位文件
ipcMain.handle('player:show-in-folder', (event, filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath);
      return true;
    }
  } catch (error) {
    console.error('定位文件失败:', error);
  }
  return false;
});

// 用其他播放器打开：弹出 Windows「打开方式」对话框
// （不能用 shell.openPath——如果本程序恰好是该格式的默认应用，会把文件又丢回自己）
ipcMain.handle('player:open-with', (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, error: '文件不存在' };
  }
  try {
    const child = spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', filePath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    child.on('error', error => {
      console.error('打开「打开方式」对话框失败:', error);
    });
    child.unref();
    return { ok: true };
  } catch (error) {
    console.error('打开「打开方式」对话框失败:', error);
    return { ok: false, error: error.message };
  }
});

// 打开 Windows「默认应用」设置页，方便把本播放器设为视频默认打开方式
ipcMain.on('player:default-apps', () => {
  shell.openExternal('ms-settings:defaultapps').catch(error => {
    console.error('打开默认应用设置失败:', error);
  });
});

// 关闭窗口
ipcMain.on('player:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});
