// Fenêtre de bureau : démarre l'API Express dans le même processus et affiche l'interface dedans.
const { app, BrowserWindow, Menu, shell, dialog } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

app.setName('Job Hunter')
const ROOT = path.resolve(__dirname, '..')
// En développement (npm run app) on travaille dans le dossier du projet ; installée, l'app range
// ses données (config, CV, offres, .env) dans le dossier utilisateur pour ne rien écrire dans l'app.
const DATA = app.isPackaged ? app.getPath('userData') : ROOT
let api = null
let win = null

function seedData() {
  if (DATA === ROOT) return
  fs.mkdirSync(DATA, { recursive: true })
  for (const f of ['config.yaml', 'cv.txt']) {
    const dest = path.join(DATA, f)
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(ROOT, f), dest)
  }
  const env = path.join(DATA, '.env')
  if (!fs.existsSync(env)) fs.writeFileSync(env, 'FT_CLIENT_ID=\nFT_CLIENT_SECRET=\n')
}

// Une app lancée depuis le Finder n'hérite pas de l'env conda : on cherche l'env « jobhunter ».
function findPython() {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN
  const custom = path.join(DATA, 'python-path.txt')
  if (fs.existsSync(custom)) {
    const p = fs.readFileSync(custom, 'utf8').trim()
    if (p) return p
  }
  const h = os.homedir()
  const bases = [
    ...['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge', '.conda'].map((d) => path.join(h, d)),
    '/opt/homebrew/Caskroom/miniconda/base', '/usr/local/Caskroom/miniconda/base', '/opt/miniconda3', '/opt/anaconda3',
  ]
  for (const b of bases) {
    const p = process.platform === 'win32' ? path.join(b, 'envs', 'jobhunter', 'python.exe') : path.join(b, 'envs', 'jobhunter', 'bin', 'python')
    if (fs.existsSync(p)) return p
  }
  return process.platform === 'win32' ? 'python' : 'python3'
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Job Hunter', submenu: [
      { label: 'Ouvrir le dossier de données', click: () => shell.openPath(DATA) },
      { type: 'separator' },
      { role: 'quit', label: 'Quitter' },
    ] },
    { role: 'editMenu' }, // copier/coller dans les champs
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]))
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1180, height: 860, minWidth: 420, minHeight: 600, title: 'Job Hunter',
    backgroundColor: '#F3F5F8', autoHideMenuBar: true, icon: path.join(ROOT, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // Les liens d'offres s'ouvrent dans le navigateur, pas dans la fenêtre de l'app.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (/^https?:/.test(u)) shell.openExternal(u)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(url)) e.preventDefault() })
  win.on('closed', () => { win = null })
  win.loadURL(url)
}

async function start() {
  seedData()
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error("Interface non compilée : lance « npm run build » d'abord.")
  const { startServer } = await import(pathToFileURL(path.join(ROOT, 'server', 'index.js')).href)
  api = await startServer({ root: ROOT, dataDir: DATA, python: findPython(), port: 0 })
  buildMenu()
  createWindow(`http://127.0.0.1:${api.port}`)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
  app.whenReady().then(start).catch((e) => { dialog.showErrorBox('Job Hunter', String(e.message || e)); app.quit() })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', () => api?.stop())
  app.on('activate', () => { if (!win && api) createWindow(`http://127.0.0.1:${api.port}`) })
}
