const { app, BrowserWindow, shell } = require('electron')
const path = require('node:path')
const { spawn, execSync } = require('node:child_process')
const http = require('node:http')
const net = require('node:net')

let mainWindow = null
let backendProcess = null
let frontendProcess = null

const DEFAULT_UI_PORT = Number(process.env.UI_PORT || process.env.PI_DASHBOARD_PORT || 5173)
const DEFAULT_BACKEND_PORT = Number(process.env.BACKEND_PORT || 4317)
const ROOT_DIR = path.resolve(__dirname, '..')

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findAvailablePort(startPort, excludePorts = []) {
  let port = startPort
  while (excludePorts.includes(port) || await isPortInUse(port)) {
    port += 1
  }
  return port
}

function killChild(child) {
  if (!child || !child.pid) return
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {}
}

async function startServices() {
  const isWindows = process.platform === 'win32'
  const npxCmd = isWindows ? 'npx.cmd' : 'npx'

  // Resolve distinct available ports
  const backendPort = await findAvailablePort(DEFAULT_BACKEND_PORT)
  const uiPort = await findAvailablePort(DEFAULT_UI_PORT, [backendPort])

  console.log(`[Pi Dashboard] Launching on UI Port: ${uiPort} | Backend Port: ${backendPort}`)

  const workspacePath = process.env.PI_WORKSPACE || process.env.PI_DASHBOARD_WORKSPACE || path.resolve(require('node:os').homedir(), 'Documents', 'PiWorkspace')

  const env = {
    ...process.env,
    PORT: String(backendPort),
    HOST: '127.0.0.1',
    PI_DASHBOARD_WORKSPACE: workspacePath,
    PI_DASHBOARD_ALLOWED_ORIGINS: `http://localhost:${uiPort},http://127.0.0.1:${uiPort}`,
    DASHBOARD_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
  }
  // Clear any inherited token from previous terminal sessions for a password-free start
  delete env.PI_DASHBOARD_AUTH_TOKEN

  // Start Backend
  backendProcess = spawn(npxCmd, ['tsx', 'src/index.ts'], {
    cwd: path.join(ROOT_DIR, 'server'),
    env,
    stdio: 'ignore',
    windowsHide: true,
    shell: isWindows,
  })

  // Start Frontend
  frontendProcess = spawn(npxCmd, ['vite', '--port', String(uiPort), '--host', '127.0.0.1'], {
    cwd: path.join(ROOT_DIR, 'ui'),
    env: { ...env, VITE_BACKEND_PORT: String(backendPort) },
    stdio: 'ignore',
    windowsHide: true,
    shell: isWindows,
  })

  return { uiPort, backendPort }
}

async function waitForServer(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(url, (res) => {
          if (res.statusCode >= 200 && res.statusCode < 500) resolve(true)
          else reject(new Error(`Status ${res.statusCode}`))
        })
        req.on('error', reject)
        req.setTimeout(1000, () => req.destroy())
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 400))
    }
  }
  return false
}

async function createWindow(uiPort, backendPort) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: '#0a0d10',
    title: 'Pi-Dashboard',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const backendUrl = `http://127.0.0.1:${backendPort}/api/auth/status`
  const targetUrl = `http://127.0.0.1:${uiPort}`

  // Wait for backend API and Frontend Vite to be fully ready
  await waitForServer(backendUrl, 20000)
  await waitForServer(targetUrl, 20000)

  mainWindow.loadURL(targetUrl)

  mainWindow.on('closed', () => {
    mainWindow = null
    killChild(backendProcess)
    killChild(frontendProcess)
  })
}

app.whenReady().then(async () => {
  const { uiPort, backendPort } = await startServices()
  await createWindow(uiPort, backendPort)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(uiPort, backendPort)
  })

  app.on('will-quit', () => {
    killChild(backendProcess)
    killChild(frontendProcess)
  })
})

app.on('window-all-closed', () => {
  killChild(backendProcess)
  killChild(frontendProcess)
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
