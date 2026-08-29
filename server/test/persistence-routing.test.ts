import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProjectService } from '../src/project-service.js'
import { WorkerRulesService } from '../src/worker-rules.js'
import { RemoteAccessService } from '../src/remote-access-service.js'

test('RemoteAccessService: respects PI_DASHBOARD_DATA_DIR environment variable', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'foci-data-dir-test-'))
  const origDataDir = process.env.PI_DASHBOARD_DATA_DIR
  const origFociDataDir = process.env.FOCI_DASHBOARD_DATA_DIR
  try {
    process.env.PI_DASHBOARD_DATA_DIR = tempDir
    delete process.env.FOCI_DASHBOARD_DATA_DIR

    const service = new RemoteAccessService()
    service.update({ enabled: true, tailnetHost: 'cloud-run.tailnet.ts.net', password: 'test-password-123' })

    const expectedConfigPath = join(tempDir, 'remote-access.json')
    assert.equal(existsSync(expectedConfigPath), true)

    const saved = JSON.parse(readFileSync(expectedConfigPath, 'utf8'))
    assert.equal(saved.enabled, true)
    assert.equal(saved.tailnetHost, 'cloud-run.tailnet.ts.net')
    assert.equal(saved.authToken, 'test-password-123')
  } finally {
    if (origDataDir) process.env.PI_DASHBOARD_DATA_DIR = origDataDir
    else delete process.env.PI_DASHBOARD_DATA_DIR
    if (origFociDataDir) process.env.FOCI_DASHBOARD_DATA_DIR = origFociDataDir
    else delete process.env.FOCI_DASHBOARD_DATA_DIR
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('WorkerRulesService: derives rules root from PI_DASHBOARD_DATA_DIR', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'foci-worker-rules-test-'))
  const origDataDir = process.env.PI_DASHBOARD_DATA_DIR
  const origRulesRoot = process.env.PI_DASHBOARD_WORKER_RULES_ROOT
  try {
    process.env.PI_DASHBOARD_DATA_DIR = tempDir
    delete process.env.PI_DASHBOARD_WORKER_RULES_ROOT

    const service = new WorkerRulesService()
    assert.equal(service.rootDir, join(tempDir, 'workers'))

    await service.initialize()
    assert.equal(existsSync(join(tempDir, 'workers', 'config.json')), true)
    assert.equal(existsSync(join(tempDir, 'workers', 'WORKERS.md')), true)
    assert.equal(existsSync(join(tempDir, 'workers', 'rules', 'codex.md')), true)
    assert.equal(existsSync(join(tempDir, 'workers', 'rules', 'gemini-worker.md')), true)
    assert.equal(existsSync(join(tempDir, 'workers', 'rules', 'antigravity.md')), true)
  } finally {
    if (origDataDir) process.env.PI_DASHBOARD_DATA_DIR = origDataDir
    else delete process.env.PI_DASHBOARD_DATA_DIR
    if (origRulesRoot) process.env.PI_DASHBOARD_WORKER_RULES_ROOT = origRulesRoot
    else delete process.env.PI_DASHBOARD_WORKER_RULES_ROOT
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('WorkerRulesService: explicit PI_DASHBOARD_WORKER_RULES_ROOT overrides default data dir', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'foci-rules-override-test-'))
  const customRulesDir = join(tempDir, 'custom-workers')
  const origDataDir = process.env.PI_DASHBOARD_DATA_DIR
  const origRulesRoot = process.env.PI_DASHBOARD_WORKER_RULES_ROOT
  try {
    process.env.PI_DASHBOARD_DATA_DIR = join(tempDir, 'dashboard-data')
    process.env.PI_DASHBOARD_WORKER_RULES_ROOT = customRulesDir

    const service = new WorkerRulesService()
    assert.equal(service.rootDir, customRulesDir)

    await service.initialize()
    assert.equal(existsSync(join(customRulesDir, 'config.json')), true)
  } finally {
    if (origDataDir) process.env.PI_DASHBOARD_DATA_DIR = origDataDir
    else delete process.env.PI_DASHBOARD_DATA_DIR
    if (origRulesRoot) process.env.PI_DASHBOARD_WORKER_RULES_ROOT = origRulesRoot
    else delete process.env.PI_DASHBOARD_WORKER_RULES_ROOT
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('ProjectService: respects PI_PROJECTS_ROOT / PI_DASHBOARD_PROJECTS_ROOT and lists all projects', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'foci-projects-root-test-'))
  const origProjectsRoot = process.env.PI_PROJECTS_ROOT
  const origDashProjectsRoot = process.env.PI_DASHBOARD_PROJECTS_ROOT
  const origFociProjectsRoot = process.env.FOCI_PROJECTS_ROOT
  try {
    process.env.PI_PROJECTS_ROOT = tempDir
    delete process.env.PI_DASHBOARD_PROJECTS_ROOT
    delete process.env.FOCI_PROJECTS_ROOT

    const service = new ProjectService()
    assert.equal(service.rootDir, resolve(tempDir))

    const p1 = service.create('project-alpha')
    const p2 = service.create('project-beta')

    assert.equal(p1.name, 'project-alpha')
    assert.equal(p2.name, 'project-beta')
    assert.equal(existsSync(join(tempDir, 'project-alpha', 'MEMORY.md')), true)
    assert.equal(existsSync(join(tempDir, 'project-alpha', 'Notes.md')), true)

    const list = service.list()
    assert.equal(list.length, 2)
    const names = list.map((p) => p.name).sort()
    assert.deepEqual(names, ['project-alpha', 'project-beta'])
  } finally {
    if (origProjectsRoot) process.env.PI_PROJECTS_ROOT = origProjectsRoot
    else delete process.env.PI_PROJECTS_ROOT
    if (origDashProjectsRoot) process.env.PI_DASHBOARD_PROJECTS_ROOT = origDashProjectsRoot
    else delete process.env.PI_DASHBOARD_PROJECTS_ROOT
    if (origFociProjectsRoot) process.env.FOCI_PROJECTS_ROOT = origFociProjectsRoot
    else delete process.env.FOCI_PROJECTS_ROOT
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('Active workspace persistence and restoration logic', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'foci-active-ws-test-'))
  const dataDir = join(tempDir, 'dashboard-data')
  const projectsRoot = join(tempDir, 'projects')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(projectsRoot, { recursive: true })

  const activeWorkspaceFile = join(dataDir, 'active-workspace.json')

  function loadPersistedActiveWorkspace(): string | undefined {
    try {
      if (existsSync(activeWorkspaceFile)) {
        const parsed = JSON.parse(readFileSync(activeWorkspaceFile, 'utf8')) as unknown
        if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).workspace === 'string') {
          const candidate = resolve(((parsed as Record<string, unknown>).workspace as string).trim())
          if (candidate) return candidate
        }
      }
    } catch {}
    return undefined
  }

  function persistActiveWorkspace(ws: string): void {
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(activeWorkspaceFile, JSON.stringify({ workspace: ws, updatedAt: new Date().toISOString() }, null, 2), 'utf8')
  }

  function resolveInitialWorkspace(explicitEnv?: string): string {
    if (explicitEnv && explicitEnv.trim()) {
      return resolve(explicitEnv.trim())
    }
    const persisted = loadPersistedActiveWorkspace()
    if (persisted) {
      return persisted
    }
    return resolve(projectsRoot, 'Default')
  }

  try {
    // 1. Initial startup: no file, no explicit env -> defaults to projectsRoot/Default
    const initial = resolveInitialWorkspace()
    assert.equal(initial, resolve(projectsRoot, 'Default'))

    // 2. Project switch happens to 'project-custom'
    const customProjectDir = join(projectsRoot, 'project-custom')
    mkdirSync(customProjectDir, { recursive: true })
    persistActiveWorkspace(customProjectDir)

    assert.equal(existsSync(activeWorkspaceFile), true)
    const saved = JSON.parse(readFileSync(activeWorkspaceFile, 'utf8'))
    assert.equal(saved.workspace, customProjectDir)

    // 3. Restart / refresh with no explicit env -> restores 'project-custom'
    const restored = resolveInitialWorkspace()
    assert.equal(restored, customProjectDir)

    // 4. Restart with explicit env override -> explicit env takes precedence
    const overrideDir = join(projectsRoot, 'project-override')
    const overridden = resolveInitialWorkspace(overrideDir)
    assert.equal(overridden, resolve(overrideDir))
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
