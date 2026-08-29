import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveEnabledWorkerProviders, WorkerCoordinator } from '../src/worker-coordinator.js'
import { AntigravityWorkerAdapter, cleanEnvironment } from '../src/antigravity-worker.js'
import { GeminiWorkerAdapter } from '../src/gemini-worker.js'
import { SubPiWorkerAdapter } from '../src/sub-pi-worker.js'
import { WorkerRulesService } from '../src/worker-rules.js'
import { GitService } from '../src/git-service.js'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('resolveEnabledWorkerProviders: default desktop mode returns undefined allowedIds', () => {
  const origK = process.env.K_SERVICE
  const origFoci = process.env.FOCI_AGENT_PROVIDER
  const origPi = process.env.PI_DASHBOARD_AGENT_PROVIDER
  const origWorkers = process.env.FOCI_ENABLED_WORKERS
  delete process.env.K_SERVICE
  delete process.env.FOCI_AGENT_PROVIDER
  delete process.env.PI_DASHBOARD_AGENT_PROVIDER
  delete process.env.FOCI_ENABLED_WORKERS

  try {
    const res = resolveEnabledWorkerProviders()
    assert.equal(res.isCloudMode, false)
    assert.equal(res.allowedIds, undefined)
  } finally {
    if (origK) process.env.K_SERVICE = origK
    if (origFoci) process.env.FOCI_AGENT_PROVIDER = origFoci
    if (origPi) process.env.PI_DASHBOARD_AGENT_PROVIDER = origPi
    if (origWorkers) process.env.FOCI_ENABLED_WORKERS = origWorkers
  }
})

test('resolveEnabledWorkerProviders: Cloud Run K_SERVICE or FOCI_AGENT_PROVIDER=gemini returns gemini-worker and antigravity-cli', () => {
  const origK = process.env.K_SERVICE
  const origFoci = process.env.FOCI_AGENT_PROVIDER
  const origWorkers = process.env.FOCI_ENABLED_WORKERS
  delete process.env.FOCI_ENABLED_WORKERS

  try {
    process.env.K_SERVICE = 'foci-dashboard'
    delete process.env.FOCI_AGENT_PROVIDER
    let res = resolveEnabledWorkerProviders()
    assert.equal(res.isCloudMode, true)
    assert.deepEqual(res.allowedIds, ['gemini-worker', 'antigravity-cli'])

    delete process.env.K_SERVICE
    process.env.FOCI_AGENT_PROVIDER = 'gemini'
    res = resolveEnabledWorkerProviders()
    assert.equal(res.isCloudMode, true)
    assert.deepEqual(res.allowedIds, ['gemini-worker', 'antigravity-cli'])
  } finally {
    if (origK) process.env.K_SERVICE = origK; else delete process.env.K_SERVICE
    if (origFoci) process.env.FOCI_AGENT_PROVIDER = origFoci; else delete process.env.FOCI_AGENT_PROVIDER
    if (origWorkers) process.env.FOCI_ENABLED_WORKERS = origWorkers
  }
})

test('resolveEnabledWorkerProviders: explicit FOCI_ENABLED_WORKERS overrides defaults', () => {
  const origWorkers = process.env.FOCI_ENABLED_WORKERS
  const origK = process.env.K_SERVICE
  try {
    process.env.K_SERVICE = 'foci-dashboard'
    process.env.FOCI_ENABLED_WORKERS = 'antigravity-cli,gemini-worker'
    let res = resolveEnabledWorkerProviders()
    assert.equal(res.isCloudMode, true)
    assert.deepEqual(res.allowedIds, ['antigravity-cli', 'gemini-worker'])

    process.env.FOCI_ENABLED_WORKERS = 'all'
    res = resolveEnabledWorkerProviders()
    assert.equal(res.isCloudMode, false)
    assert.equal(res.allowedIds, undefined)
  } finally {
    if (origWorkers) process.env.FOCI_ENABLED_WORKERS = origWorkers; else delete process.env.FOCI_ENABLED_WORKERS
    if (origK) process.env.K_SERVICE = origK; else delete process.env.K_SERVICE
  }
})

test('AntigravityWorkerAdapter: does not mark API-key-only auth ready unless explicitly allowed', () => {
  const origGemini = process.env.GEMINI_API_KEY
  const origGoogle = process.env.GOOGLE_API_KEY
  const origAllow = process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  const origPath = process.env.PATH
  const tempDir = mkdtempSync(join(tmpdir(), 'agy-path-test-'))
  const fakeAgy = join(tempDir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
  const fakeHome = join(tempDir, 'gemini-home')
  writeFileSync(fakeAgy, process.platform === 'win32' ? '@echo off\necho agy test\n' : '#!/bin/sh\necho agy test\n')
  if (process.platform !== 'win32') chmodSync(fakeAgy, 0o755)
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  process.env.PATH = `${tempDir}${process.platform === 'win32' ? ';' : ':'}${origPath ?? ''}`

  const git = new GitService(process.cwd())
  const adapter = new AntigravityWorkerAdapter({
    workspace: process.cwd(),
    git,
    enabled: true,
    antigravityHome: fakeHome,
  })

  try {
    process.env.GEMINI_API_KEY = 'test-gemini-key'
    let provider = adapter.provider
    assert.equal(provider.id, 'antigravity-cli')
    assert.equal(provider.status, 'unavailable')
    assert.match(provider.statusLabel, /requires OAuth/)

    process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH = 'true'
    provider = adapter.provider
    assert.equal(provider.status, 'ready')
    assert.match(provider.statusLabel, /Ready \(API Key\)/)
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini; else delete process.env.GEMINI_API_KEY
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle; else delete process.env.GOOGLE_API_KEY
    if (origAllow) process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH = origAllow; else delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
    if (origPath) process.env.PATH = origPath; else delete process.env.PATH
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('AntigravityWorkerAdapter: does not treat directory existence as authenticated and requires concrete token file', () => {
  const origGemini = process.env.GEMINI_API_KEY
  const origGoogle = process.env.GOOGLE_API_KEY
  const origAllow = process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  const origPath = process.env.PATH
  const tempDir = mkdtempSync(join(tmpdir(), 'agy-dir-auth-test-'))
  const fakeAgy = join(tempDir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
  const fakeHome = join(tempDir, 'gemini-home')
  const fakeCliDir = join(fakeHome, 'antigravity-cli')
  mkdirSync(fakeCliDir, { recursive: true })
  writeFileSync(fakeAgy, process.platform === 'win32' ? '@echo off\necho agy test\n' : '#!/bin/sh\necho agy test\n')
  if (process.platform !== 'win32') chmodSync(fakeAgy, 0o755)
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  process.env.PATH = `${tempDir}${process.platform === 'win32' ? ';' : ':'}${origPath ?? ''}`

  const git = new GitService(process.cwd())
  const adapter = new AntigravityWorkerAdapter({
    workspace: process.cwd(),
    git,
    enabled: true,
    antigravityHome: fakeHome,
  })

  try {
    // 1. Directory exists, but no token file present -> not ready
    let provider = adapter.provider
    assert.equal(provider.id, 'antigravity-cli')
    assert.equal(provider.status, 'unavailable')
    assert.match(provider.statusLabel, /select Connect to sign in/)

    // 2. Concrete token file created -> ready
    const tokenFile = join(fakeCliDir, 'antigravity-oauth-token')
    writeFileSync(tokenFile, 'valid-token-data', 'utf8')

    provider = adapter.provider
    assert.equal(provider.status, 'ready')
    assert.equal(provider.statusLabel, 'Installed and ready')
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini; else delete process.env.GEMINI_API_KEY
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle; else delete process.env.GOOGLE_API_KEY
    if (origAllow) process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH = origAllow; else delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
    if (origPath) process.env.PATH = origPath; else delete process.env.PATH
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('AntigravityWorkerAdapter: fast-fails in run() when provider status is not ready', async () => {
  const origGemini = process.env.GEMINI_API_KEY
  const origGoogle = process.env.GOOGLE_API_KEY
  const origAllow = process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  const origPath = process.env.PATH
  const tempDir = mkdtempSync(join(tmpdir(), 'agy-fast-fail-test-'))
  const fakeAgy = join(tempDir, process.platform === 'win32' ? 'agy.cmd' : 'agy')
  const fakeHome = join(tempDir, 'gemini-home')
  writeFileSync(fakeAgy, process.platform === 'win32' ? '@echo off\necho agy test\n' : '#!/bin/sh\necho agy test\n')
  if (process.platform !== 'win32') chmodSync(fakeAgy, 0o755)
  delete process.env.GEMINI_API_KEY
  delete process.env.GOOGLE_API_KEY
  delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
  process.env.PATH = `${tempDir}${process.platform === 'win32' ? ';' : ':'}${origPath ?? ''}`

  const git = new GitService(process.cwd())
  const adapter = new AntigravityWorkerAdapter({
    workspace: process.cwd(),
    git,
    enabled: true,
    antigravityHome: fakeHome,
  })

  try {
    assert.equal(adapter.provider.status, 'unavailable')
    await assert.rejects(
      () => adapter.run({
        taskId: 'test-unready-task',
        providerId: 'antigravity-cli',
        mode: 'research',
        prompt: 'test prompt',
        bounds: { turnLimit: 2, timeoutMs: 10000, resultLimitBytes: 1024 },
      }, {
        onProgress: async () => {},
      }),
      /Antigravity CLI is not ready/,
    )
  } finally {
    if (origGemini) process.env.GEMINI_API_KEY = origGemini; else delete process.env.GEMINI_API_KEY
    if (origGoogle) process.env.GOOGLE_API_KEY = origGoogle; else delete process.env.GOOGLE_API_KEY
    if (origAllow) process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH = origAllow; else delete process.env.FOCI_ANTIGRAVITY_API_KEY_AUTH
    if (origPath) process.env.PATH = origPath; else delete process.env.PATH
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('cleanEnvironment: configures CI and NONINTERACTIVE for background workers', () => {
  const env = cleanEnvironment('/custom/gemini-home')
  assert.equal(env.CI, '1')
  assert.equal(env.NONINTERACTIVE, '1')
  assert.equal(env.ANTIGRAVITY_HOME, '/custom/gemini-home')
  assert.equal(env.PI_DASHBOARD_AUTH_TOKEN, undefined)
  assert.equal(env.PI_DASHBOARD_WORKER_INTERNAL_TOKEN, undefined)
})

test('WorkerCoordinator: filters snapshot and denies disallowed providers in cloud mode', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'worker-coord-test-'))
  const git = new GitService(tempDir)
  const rules = new WorkerRulesService(join(tempDir, 'rules-root'))
  const gemini = new GeminiWorkerAdapter({ workspace: tempDir, enabled: true })
  const subPi = new SubPiWorkerAdapter({ workspace: tempDir, git, enabled: true })
  const antigravity = new AntigravityWorkerAdapter({ workspace: tempDir, git, enabled: true })

  try {
    const coordinator = new WorkerCoordinator({
      storePath: join(tempDir, 'tasks.json'),
      archivePath: join(tempDir, 'tasks-archive.json'),
      adapters: [gemini, subPi, antigravity],
      rulesService: rules,
      bounds: { turnLimit: 8, timeoutMs: 60000, resultLimitBytes: 12288 },
      allowedProviderIds: ['gemini-worker', 'antigravity-cli'],
      primaryDefaults: async () => ({}),
    })

    await coordinator.initialize()
    const snapshot = await coordinator.snapshot()

    assert.equal(snapshot.isFiltered, true)
    assert.equal(snapshot.profileLabel, 'Gemini / Antigravity Cloud Profile')
    assert.equal(snapshot.providers.length, 2)
    assert.deepEqual(snapshot.providers.map((p) => p.id), ['gemini-worker', 'antigravity-cli'])

    assert.equal(coordinator.getAdapter('sub-pi'), undefined)
    assert.notEqual(coordinator.getAdapter('gemini-worker'), undefined)
    assert.notEqual(coordinator.getAdapter('antigravity-cli'), undefined)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

