const { app, BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const next = require('next');

const isDev = !app.isPackaged;
let server;
let mainWindow;
let logFilePath;

function log(message, error) {
  const line = [
    new Date().toISOString(),
    message,
    error ? error.stack || error.message || String(error) : ''
  ].filter(Boolean).join(' ') + '\n';

  try {
    if (logFilePath) fs.appendFileSync(logFilePath, line, 'utf8');
  } catch {}
  console.log(line.trim());
}

function parseEnvFile(content) {
  const values = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function loadEnvFile(filePath, options = {}) {
  if (!fs.existsSync(filePath)) return;
  const values = parseEnvFile(fs.readFileSync(filePath, 'utf8'));
  for (const [key, value] of Object.entries(values)) {
    if (options.override || !process.env[key]) process.env[key] = value;
  }
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function getAppRoot() {
  return path.resolve(__dirname, '..');
}

function configureRuntime() {
  const appRoot = getAppRoot();
  const userRoot = app.getPath('userData');
  const dataRoot = process.env.VIDEO_FACTORY_DATA_ROOT || path.join(userRoot, 'data');
  const generatedRoot = process.env.VIDEO_FACTORY_GENERATED_ROOT || path.join(userRoot, 'generated');
  const logsRoot = path.join(userRoot, 'logs');

  ensureDirectory(dataRoot);
  ensureDirectory(generatedRoot);
  ensureDirectory(logsRoot);
  logFilePath = path.join(logsRoot, 'main.log');

  process.env.NODE_ENV = 'production';
  process.env.VIDEO_FACTORY_APP_ROOT = appRoot;
  process.env.VIDEO_FACTORY_DATA_ROOT = dataRoot;
  process.env.VIDEO_FACTORY_GENERATED_ROOT = generatedRoot;
  process.env.VIDEO_FACTORY_LOG_FILE = logFilePath;

  loadEnvFile(path.join(appRoot, '.env.local'));
  loadEnvFile(path.join(process.cwd(), '.env.local'), { override: true });
  if (app.isPackaged) {
    loadEnvFile(path.join(path.dirname(process.execPath), '.env.local'), { override: true });
  }
  loadEnvFile(path.join(dataRoot, '.env.local'), { override: true });
  log(`Runtime configured appRoot=${appRoot} dataRoot=${dataRoot} generatedRoot=${generatedRoot}`);
}

function findFreePort(startPort = 47813) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      const tester = net.createServer();
      tester.once('error', () => tryPort(port + 1));
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port, '127.0.0.1');
    };
    tryPort(startPort);
  });
}

async function startNextServer() {
  const dir = getAppRoot();
  const port = await findFreePort();
  const nextApp = next({ dev: false, dir, hostname: '127.0.0.1', port });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      log(`Request failed ${request.method} ${request.url}`, error);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.end('Internal server error');
      }
    });
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  const url = `http://127.0.0.1:${port}`;
  log(`Next server listening ${url}`);
  return url;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1100,
    minHeight: 720,
    title: 'Video Factory',
    backgroundColor: '#f7f4ee',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.loadURL(url);
  log(`Window loading ${url}`);
}

app.whenReady().then(async () => {
  try {
    configureRuntime();
    const url = await startNextServer();
    createWindow(url);
  } catch (error) {
    log('Video Factory startup failed', error);
    dialog.showErrorBox('Video Factory 启动失败', error instanceof Error ? error.stack || error.message : String(error));
    app.quit();
  }
});

process.on('uncaughtException', (error) => {
  log('Uncaught exception', error);
});

process.on('unhandledRejection', (reason) => {
  log('Unhandled rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && mainWindow) {
    mainWindow.show();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  if (server) server.close();
});
