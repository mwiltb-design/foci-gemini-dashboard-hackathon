import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GeminiAgentProcess } from '../src/gemini-agent.js'
import { SessionCatalog } from '../src/session-catalog.js'

test('GeminiAgentProcess creates and preserves catalog-visible sessions', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'gemini-session-test-'))
  const workspace = join(tempDir, 'workspace')
  const sessionDir = join(tempDir, 'sessions')
  const agent = new GeminiAgentProcess({ cwd: workspace, sessionDir })
  const catalog = new SessionCatalog(sessionDir, workspace)

  try {
    await agent.start()
    let sessions = await catalog.list()
    assert.equal(sessions.length, 1)
    const firstId = sessions[0].id
    assert.match(firstId, /^gemini-/)

    const firstDetail = await catalog.get(firstId)
    assert.ok(firstDetail)
    assert.equal(firstDetail.summary.name, 'Gemini Cloud Session')

    const response = await agent.request({ type: 'new_session' })
    assert.equal(response.success, true)
    const nextState = response.data as Record<string, unknown>
    assert.notEqual(nextState.sessionId, firstId)

    sessions = await catalog.list()
    assert.equal(sessions.length, 2)
    assert.ok(sessions.some((session) => session.id === firstId))
    assert.ok(sessions.some((session) => session.id === nextState.sessionId))
  } finally {
    await agent.stop()
    rmSync(tempDir, { recursive: true, force: true })
  }
})
