// 预加载脚本：向播放页暴露受控的 IPC 接口
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('playerAPI', {
  // 初始化：拿到启动参数里的文件与同文件夹视频
  init: () => ipcRenderer.invoke('player:init'),
  // 切换到指定文件（侧边栏点击 / 拖入文件）
  switchTo: (filePath) => ipcRenderer.invoke('player:switch', filePath),
  // 重新读取文件夹视频列表
  listVideos: (folder) => ipcRenderer.invoke('player:list', folder),
  // 打开文件选择框
  pickFile: () => ipcRenderer.invoke('player:pick'),
  // 拖入文件时取本地路径（新版 Electron 不再在 File 对象上暴露 path）
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file) || '';
    } catch (error) {
      return '';
    }
  },
  // 按视频尺寸自适应窗口
  fitSize: (width, height) => ipcRenderer.send('player:fit-size', width, height),
  // 在资源管理器中定位
  showInFolder: (filePath) => ipcRenderer.invoke('player:show-in-folder', filePath),
  // 用其他播放器打开（弹出 Windows「打开方式」对话框）
  openWith: (filePath) => ipcRenderer.invoke('player:open-with', filePath),
  // 打开 Windows 默认应用设置
  openDefaultApps: () => ipcRenderer.send('player:default-apps'),
  // 关闭窗口
  close: () => ipcRenderer.send('player:close'),
  // 主进程要求打开新文件（第二次双击视频 / 菜单打开）
  onOpenFile: (callback) => {
    ipcRenderer.on('player:open-file', (event, filePath) => callback(filePath));
  },
  // 主进程要求刷新侧边栏
  onRefresh: (callback) => {
    ipcRenderer.on('player:refresh', () => callback());
  }
});
