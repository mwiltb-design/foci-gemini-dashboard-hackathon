import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RemoteAccessService } from '../src/remote-access-service.js'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('RemoteAccessService: local-only defaults', () => {
  const origToken = process.env.PI_DASHBOARD_AUTH_TOKEN
  const origOrigins = process.env.PI_DASHBOARD_ALLOWED_ORIGINS
  const origHosts = process.env.DASHBOARD_ALLOWED_HOSTS
  delete process.env.PI_DASHBOARD_AUTH_TOKEN
  delete process.env.PI_DASHBOARD_ALLOWED_ORIGINS
  delete process.env.DASHBOARD_ALLOWED_HOSTS

  const tempDir = mkdtempSync(join(tmpdir(), 'remote-test-'))
  try {
    const configPath = join(tempDir, 'remote-access.json')
    const service = new RemoteAccessService(configPath)
    const state = service.get(5173)

    assert.equal(state.enabled, false)
    assert.equal(state.tokenConfigured, false)
    assert.equal(service.getToken(), undefined)
    assert.equal(service.getAllowedOrigin(), undefined)
    assert.equal(service.getTailnetHost(), undefined)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('RemoteAccessService: configure tailnet host and password', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-test-'))
  try {
    const configPath = join(tempDir, 'remote-access.json')
    const service = new RemoteAccessService(configPath)

    const updated = service.update({
      enabled: true,
      tailnetHost: 'my-desktop.tailnet.ts.net',
      httpsPort: 8443,
      password: 'MySecretPassword123!',
    }, 5173)

    assert.equal(updated.enabled, true)
    assert.equal(updated.tokenConfigured, true)
    assert.equal(service.getToken(), 'MySecretPassword123!')
    assert.equal(service.getAllowedOrigin(), 'https://my-desktop.tailnet.ts.net:8443')
    assert.equal(service.getTailnetHost(), 'my-desktop.tailnet.ts.net')
    assert.match(updated.serveCommand, /tailscale serve --bg --https=8443 http:\/\/127\.0\.0\.1:5173/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

test('RemoteAccessService: clean URL input and trim hosts', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'remote-test-'))
  try {
    const configPath = join(tempDir, 'remote-access.json')
    const service = new RemoteAccessService(configPath)

    service.update({
      enabled: true,
      tailnetHost: 'https://My-PC.Tailnet.TS.NET:8443/extra',
      httpsPort: 8443,
      password: '  trimmed-pass  ',
    })

    assert.equal(service.getTailnetHost(), 'my-pc.tailnet.ts.net')
    assert.equal(service.getToken(), 'trimmed-pass')
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
