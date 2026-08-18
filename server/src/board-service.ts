import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const BOARD_STATUSES = ['ideas', 'in-progress', 'done'] as const
export type BoardStatus = typeof BOARD_STATUSES[number]
export const PI_CARD_STATUSES = ['unassigned', 'queued', 'planning', 'working', 'plan-ready', 'awaiting-approval', 'paused', 'blocked', 'failed', 'completed'] as const
export type PiCardStatus = typeof PI_CARD_STATUSES[number]
export const BOARD_RUN_MODES = ['execute', 'plan-approval', 'user-plan'] as const
export type BoardRunMode = typeof BOARD_RUN_MODES[number]
export const MANUAL_CARD_ACTIONS = ['needs-approval', 'paused', 'blocked', 'completed', 'reopen'] as const
export type ManualCardAction = typeof MANUAL_CARD_ACTIONS[number]

export interface BoardCard {
  id: string
  title: string
  description: string
  tags: string[]
  status: BoardStatus
  assignedToPi: boolean
  planApprovalRequired: boolean
  userPlanRequested: boolean
  piStatus: PiCardStatus
  piSessionId: string | null
  piMessage: string
  piTurnCount: number
  piUpdatedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface BoardSnapshot {
  version: 3
  workspace: string
  updatedAt: string
  cards: BoardCard[]
}

export interface BoardCardInput {
  title?: unknown
  description?: unknown
  tags?: unknown
  status?: unknown
  assignedToPi?: unknown
  planApprovalRequired?: unknown
  userPlanRequested?: unknown
}

export interface PiStateInput {
  status: PiCardStatus
  sessionId?: string | null
  message?: string
  turnCount?: number
}

export class BoardError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function cleanText(value: unknown, field: string, maximum: number, required = false): string {
  if (value === undefined && !required) return ''
  if (typeof value !== 'string') throw new BoardError(`${field} must be text`)
  const result = value.trim()
  if (required && !result) throw new BoardError(`${field} is required`)
  if (result.length > maximum) throw new BoardError(`${field} must be ${maximum} characters or fewer`)
  return result
}

function cleanBoolean(value: unknown, field: string, fallback = false): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new BoardError(`${field} must be true or false`)
  return value
}

function cleanStatus(value: unknown, fallback?: BoardStatus): BoardStatus {
  if (value === undefined && fallback) return fallback
  if (typeof value !== 'string' || !BOARD_STATUSES.includes(value as BoardStatus)) throw new BoardError('Status must be ideas, in-progress, or done')
  return value as BoardStatus
}

function cleanTags(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((tag) => typeof tag !== 'string')) throw new BoardError('Tags must be a list of text values')
  const tags = Array.from(new Set(value.map((tag) => tag.trim().toLocaleLowerCase()).filter(Boolean)))
  if (tags.length > 5) throw new BoardError('Cards can have at most 5 tags')
  if (tags.some((tag) => tag.length > 30)) throw new BoardError('Tags must be 30 characters or fewer')
  return tags
}

function validateAssignment(assignedToPi: boolean, planApprovalRequired: boolean, userPlanRequested: boolean): void {
  if (assignedToPi && userPlanRequested) throw new BoardError('Choose either Pi implementation or a user-owned plan, not both')
  if (planApprovalRequired && !assignedToPi) throw new BoardError('Plan approval requires Assign to Pi')
}

function normalizeCard(value: unknown, version: 1 | 2 | 3): BoardCard | null {
  if (!value || typeof value !== 'object') return null
  const card = value as Partial<BoardCard>
  if (typeof card.id !== 'string' || typeof card.title !== 'string' || typeof card.description !== 'string'
    || !Array.isArray(card.tags) || !card.tags.every((tag) => typeof tag === 'string')
    || !BOARD_STATUSES.includes(card.status as BoardStatus)
    || typeof card.createdAt !== 'string' || typeof card.updatedAt !== 'string') return null
  if (version >= 2 && (typeof card.assignedToPi !== 'boolean' || typeof card.planApprovalRequired !== 'boolean'
    || !PI_CARD_STATUSES.includes(card.piStatus as PiCardStatus)
    || (card.piSessionId !== null && typeof card.piSessionId !== 'string') || typeof card.piMessage !== 'string'
    || typeof card.piTurnCount !== 'number' || !Number.isInteger(card.piTurnCount) || card.piTurnCount < 0
    || (card.piUpdatedAt !== null && typeof card.piUpdatedAt !== 'string'))) return null
  if (version === 3 && (typeof card.userPlanRequested !== 'boolean' || (card.archivedAt !== null && typeof card.archivedAt !== 'string'))) return null
  const assignedToPi = typeof card.assignedToPi === 'boolean' ? card.assignedToPi : false
  const planApprovalRequired = typeof card.planApprovalRequired === 'boolean' ? card.planApprovalRequired : false
  const userPlanRequested = typeof card.userPlanRequested === 'boolean' ? card.userPlanRequested : false
  try { validateAssignment(assignedToPi, planApprovalRequired, userPlanRequested) } catch { return null }
  return {
    id: card.id,
    title: card.title,
    description: card.description,
    tags: card.tags,
    status: card.status as BoardStatus,
    assignedToPi,
    planApprovalRequired,
    userPlanRequested,
    piStatus: PI_CARD_STATUSES.includes(card.piStatus as PiCardStatus) ? card.piStatus as PiCardStatus : 'unassigned',
    piSessionId: typeof card.piSessionId === 'string' ? card.piSessionId : null,
    piMessage: typeof card.piMessage === 'string' ? card.piMessage : '',
    piTurnCount: typeof card.piTurnCount === 'number' && Number.isInteger(card.piTurnCount) && card.piTurnCount >= 0 ? card.piTurnCount : 0,
    piUpdatedAt: typeof card.piUpdatedAt === 'string' ? card.piUpdatedAt : null,
    archivedAt: typeof card.archivedAt === 'string' ? card.archivedAt : null,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
  }
}

export class BoardService {
  private snapshot: BoardSnapshot
  private mutationChain = Promise.resolve()

  constructor(private readonly path: string, workspace: string) {
    this.snapshot = { version: 3, workspace, updatedAt: new Date(0).toISOString(), cards: [] }
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { version?: unknown; workspace?: unknown; updatedAt?: unknown; cards?: unknown }
      if ((parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3) || parsed.workspace !== this.snapshot.workspace || !Array.isArray(parsed.cards)) {
        throw new BoardError('Stored project board data is invalid', 500)
      }
      const version = parsed.version as 1 | 2 | 3
      const cards = parsed.cards.map((card) => normalizeCard(card, version))
      if (cards.some((card) => !card)) throw new BoardError('Stored project board data is invalid', 500)
      this.snapshot = {
        version: 3,
        workspace: parsed.workspace,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
        cards: cards as BoardCard[],
      }
      const interrupted = this.snapshot.cards.filter((card) => card.piStatus === 'working' || card.piStatus === 'planning')
      if (interrupted.length > 0) {
        const now = new Date().toISOString()
        for (const card of interrupted) {
          card.piStatus = 'paused'
          card.piMessage = 'The dashboard restarted during this run. Review the linked session and resume when ready.'
          card.piUpdatedAt = now
          card.updatedAt = this.nextTimestamp(card.updatedAt)
        }
        this.snapshot.updatedAt = now
      }
      if (version < 3 || interrupted.length > 0) await this.persist()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  get(): BoardSnapshot { return structuredClone(this.snapshot) }

  getCard(id: string): BoardCard | undefined {
    const card = this.snapshot.cards.find((candidate) => candidate.id === id)
    return card ? structuredClone(card) : undefined
  }

  create(input: BoardCardInput): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const now = new Date().toISOString()
      const assignedToPi = cleanBoolean(input.assignedToPi, 'Assign to Pi')
      const planApprovalRequired = cleanBoolean(input.planApprovalRequired, 'Plan approval')
      const userPlanRequested = cleanBoolean(input.userPlanRequested, 'User-owned plan')
      validateAssignment(assignedToPi, planApprovalRequired, userPlanRequested)
      const assigned = assignedToPi || userPlanRequested
      this.snapshot.cards.push({
        id: randomUUID(), title: cleanText(input.title, 'Title', 120, true),
        description: cleanText(input.description, 'Description', 2_000), tags: cleanTags(input.tags),
        status: cleanStatus(input.status, 'ideas'), assignedToPi, planApprovalRequired, userPlanRequested,
        piStatus: assigned ? 'queued' : 'unassigned', piSessionId: null,
        piMessage: assigned ? 'Waiting for Pi to start.' : '', piTurnCount: 0,
        piUpdatedAt: assigned ? now : null, archivedAt: null, createdAt: now, updatedAt: now,
      })
    })
  }

  update(id: string, input: BoardCardInput, expectedUpdatedAt: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      this.requireVersion(card, expectedUpdatedAt)
      const active = card.piStatus === 'working' || card.piStatus === 'planning'
      const nextAssigned = input.assignedToPi === undefined ? card.assignedToPi : cleanBoolean(input.assignedToPi, 'Assign to Pi')
      const nextApproval = input.planApprovalRequired === undefined ? card.planApprovalRequired : cleanBoolean(input.planApprovalRequired, 'Plan approval')
      const nextUserPlan = input.userPlanRequested === undefined ? card.userPlanRequested : cleanBoolean(input.userPlanRequested, 'User-owned plan')
      validateAssignment(nextAssigned, nextApproval, nextUserPlan)
      const changesActiveControl = (input.status !== undefined && input.status !== card.status)
        || nextAssigned !== card.assignedToPi || nextApproval !== card.planApprovalRequired || nextUserPlan !== card.userPlanRequested
      if (active && changesActiveControl) throw new BoardError('Stop Pi before changing this card’s assignment or column', 409)
      if (input.title !== undefined) card.title = cleanText(input.title, 'Title', 120, true)
      if (input.description !== undefined) card.description = cleanText(input.description, 'Description', 2_000)
      if (input.tags !== undefined) card.tags = cleanTags(input.tags)
      if (input.status !== undefined) card.status = cleanStatus(input.status)
      card.assignedToPi = nextAssigned
      card.planApprovalRequired = nextApproval
      card.userPlanRequested = nextUserPlan
      const assigned = nextAssigned || nextUserPlan
      if (!assigned && !active) {
        card.piStatus = 'unassigned'
        card.piMessage = ''
      } else if (assigned && card.piStatus === 'unassigned') {
        card.piStatus = 'queued'
        card.piMessage = 'Waiting for Pi to start.'
        card.piUpdatedAt = new Date().toISOString()
      }
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  prepareRun(id: string, expectedUpdatedAt: string, mode: BoardRunMode): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      this.requireVersion(card, expectedUpdatedAt)
      if (!BOARD_RUN_MODES.includes(mode)) throw new BoardError('Project run mode is invalid')
      if (['working', 'planning'].includes(card.piStatus)) throw new BoardError('Pi is already working on this card', 409)
      if (card.piStatus === 'awaiting-approval') throw new BoardError('Approve or revise Pi’s request instead of starting a new session', 409)
      if (card.piSessionId && ['paused', 'blocked', 'failed'].includes(card.piStatus)) throw new BoardError('Resume the linked Pi session instead of starting a new one', 409)
      const now = new Date().toISOString()
      card.assignedToPi = mode !== 'user-plan'
      card.planApprovalRequired = mode === 'plan-approval'
      card.userPlanRequested = mode === 'user-plan'
      card.status = 'in-progress'
      card.piStatus = 'queued'
      card.piMessage = 'Starting a dedicated Pi session…'
      card.piTurnCount = 0
      card.piUpdatedAt = now
      card.archivedAt = null
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  prepareTakeover(id: string, expectedUpdatedAt: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      this.requireVersion(card, expectedUpdatedAt)
      if (!card.piSessionId) throw new BoardError('This card does not have a linked Pi session', 409)
      if (['working', 'planning'].includes(card.piStatus)) throw new BoardError('Pi is already working on this card', 409)
      card.assignedToPi = true
      card.planApprovalRequired = false
      card.userPlanRequested = false
      card.status = 'in-progress'
      card.piStatus = 'queued'
      card.piMessage = 'Handing the existing plan to Pi for implementation…'
      card.piTurnCount = 0
      card.piUpdatedAt = new Date().toISOString()
      card.archivedAt = null
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  setPiState(id: string, input: PiStateInput, expectedSessionId?: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      if (expectedSessionId && card.piSessionId && card.piSessionId !== expectedSessionId) throw new BoardError('This project update came from an unrelated session', 409)
      const now = new Date().toISOString()
      card.piStatus = input.status
      if (input.sessionId !== undefined) card.piSessionId = input.sessionId
      if (input.message !== undefined) card.piMessage = cleanText(input.message, 'Pi status message', 2_000)
      if (input.turnCount !== undefined) card.piTurnCount = Math.max(0, Math.floor(input.turnCount))
      if (input.status === 'completed') card.status = 'done'
      else if (card.status === 'ideas') card.status = 'in-progress'
      card.piUpdatedAt = now
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  setManualStatus(id: string, action: ManualCardAction, expectedUpdatedAt: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      this.requireVersion(card, expectedUpdatedAt)
      if (!MANUAL_CARD_ACTIONS.includes(action)) throw new BoardError('Manual card action is invalid')
      if (['working', 'planning'].includes(card.piStatus)) throw new BoardError('Stop Pi before changing this card manually', 409)
      if (action === 'needs-approval') {
        card.status = 'in-progress'; card.piStatus = 'awaiting-approval'; card.piMessage = 'Marked as needing approval by the user.'
      } else if (action === 'paused') {
        card.status = 'in-progress'; card.piStatus = 'paused'; card.piMessage = 'Stopped by the user.'
      } else if (action === 'blocked') {
        card.status = 'in-progress'; card.piStatus = 'blocked'; card.piMessage = 'Marked as blocked by the user.'
      } else if (action === 'completed') {
        card.status = 'done'; card.piStatus = 'completed'; card.piMessage = 'Marked complete by the user.'
      } else {
        card.status = 'in-progress'; card.piStatus = card.assignedToPi || card.userPlanRequested ? 'paused' : 'unassigned'; card.piMessage = card.piStatus === 'paused' ? 'Reopened by the user.' : ''
        card.archivedAt = null
      }
      card.piUpdatedAt = new Date().toISOString()
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  archive(id: string, archived: boolean, expectedUpdatedAt: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const card = this.requireCard(id)
      this.requireVersion(card, expectedUpdatedAt)
      if (['working', 'planning'].includes(card.piStatus)) throw new BoardError('Stop Pi before archiving this card', 409)
      if (archived && card.status !== 'done') throw new BoardError('Only completed cards can be archived', 409)
      card.archivedAt = archived ? new Date().toISOString() : null
      card.updatedAt = this.nextTimestamp(card.updatedAt)
    })
  }

  remove(id: string, expectedUpdatedAt: string): Promise<BoardSnapshot> {
    return this.mutate(() => {
      const index = this.snapshot.cards.findIndex((card) => card.id === id)
      if (index < 0) throw new BoardError('Card not found', 404)
      this.requireVersion(this.snapshot.cards[index], expectedUpdatedAt)
      if (['working', 'planning'].includes(this.snapshot.cards[index].piStatus)) throw new BoardError('Stop Pi before deleting this card', 409)
      this.snapshot.cards.splice(index, 1)
    })
  }

  private requireCard(id: string): BoardCard {
    const card = this.snapshot.cards.find((candidate) => candidate.id === id)
    if (!card) throw new BoardError('Card not found', 404)
    return card
  }

  private requireVersion(card: BoardCard, expectedUpdatedAt: string): void {
    if (card.updatedAt !== expectedUpdatedAt) throw new BoardError('This card changed in another browser. Refresh and try again.', 409)
  }

  private nextTimestamp(previous: string): string { return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString() }

  private mutate(change: () => void): Promise<BoardSnapshot> {
    const operation = this.mutationChain.then(async () => {
      const previous = this.get()
      try {
        change()
        this.snapshot.updatedAt = new Date().toISOString()
        await this.persist()
        return this.get()
      } catch (error) {
        this.snapshot = previous
        throw error
      }
    })
    this.mutationChain = operation.then(() => undefined, () => undefined)
    return operation
  }

  private async persist(): Promise<void> {
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(this.snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, this.path)
  }
}
