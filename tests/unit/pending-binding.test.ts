import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearPendingBinding,
  loadPendingBinding,
  PENDING_BINDING_SCHEMA,
  type PendingBindingRecord,
  pendingStateFilePath,
  questionAnchor,
  resolveBindingContext,
  SERVER_EPOCH,
  savePendingBinding,
  stateDir,
} from '../../src/pending-binding.js'

let stateRoot = ''

function record(overrides: Partial<PendingBindingRecord> = {}): PendingBindingRecord {
  return {
    schema: PENDING_BINDING_SCHEMA,
    epoch: 'epoch-A',
    targetId: 'target-1',
    url: 'https://www.perplexity.ai/search/abc',
    questionAnchor: 'QA-RESTART-1005 restart provenance probe',
    submittedAt: 1791100000000,
    promptLength: 42,
    ...overrides,
  }
}

beforeEach(() => {
  stateRoot = mkdtempSync(join(tmpdir(), 'mcp-comet-pending-'))
  process.env.MCP_COMET_STATE_DIR = stateRoot
})

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true })
  delete process.env.MCP_COMET_STATE_DIR
})

describe('pending binding store', () => {
  it('saves, loads, and clears a record round-trip', () => {
    expect(savePendingBinding(record(), 9222).ok).toBe(true)
    expect(loadPendingBinding(9222).record).toEqual(record())
    expect(existsSync(pendingStateFilePath(9222))).toBe(true)
    expect(clearPendingBinding(9222).ok).toBe(true)
    expect(loadPendingBinding(9222).record).toBeNull()
    expect(existsSync(pendingStateFilePath(9222))).toBe(false)
  })

  it('keeps records for different ports separate', () => {
    savePendingBinding(record({ epoch: 'e1' }), 9222)
    savePendingBinding(record({ epoch: 'e2' }), 9223)
    expect(loadPendingBinding(9222).record?.epoch).toBe('e1')
    expect(loadPendingBinding(9223).record?.epoch).toBe('e2')
  })

  it('treats a missing file as no record', () => {
    const result = loadPendingBinding(9222)
    expect(result.record).toBeNull()
    expect(result.error).toBeUndefined()
  })

  it('fails closed on corrupt or unsupported records', () => {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(pendingStateFilePath(9222), 'not-json{{{')
    expect(loadPendingBinding(9222).record).toBeNull()
    expect(loadPendingBinding(9222).error).toBeTruthy()
    writeFileSync(pendingStateFilePath(9222), JSON.stringify({ ...record(), schema: 99 }))
    expect(loadPendingBinding(9222).record).toBeNull()
  })

  it('persists only the <=64-char normalized anchor, never the full prompt', () => {
    const longPrompt = `${'QA-RESTART-1005 public probe. '.repeat(10)}SECRET-TAIL-MARKER-XYZ`
    const anchor = questionAnchor(longPrompt)
    expect(anchor.length).toBe(64)
    savePendingBinding(record({ questionAnchor: anchor, promptLength: longPrompt.length }), 9222)
    const raw = readFileSync(pendingStateFilePath(9222), 'utf-8')
    expect(raw).toContain(anchor)
    expect(raw).not.toContain('SECRET-TAIL-MARKER-XYZ')
  })
})

describe('resolveBindingContext', () => {
  const targetId = 'target-1'
  const url = 'https://www.perplexity.ai/search/abc'

  it('returns unbound when nothing is pending', () => {
    const context = resolveBindingContext({ pendingQuestion: null, record: null, targetId, url })
    expect(context.origin).toBe('unbound')
    expect(context.question).toBeNull()
    expect(context.restart).toBeUndefined()
    expect(context.priorBinding).toBeUndefined()
  })

  it('returns memory binding for a question asked in this process', () => {
    const withPending = resolveBindingContext({
      pendingQuestion: 'QA question',
      record: null,
      targetId,
      url,
    })
    expect(withPending.origin).toBe('memory')
    expect(withPending.question).toBe('QA question')
    const sameEpoch = resolveBindingContext({
      pendingQuestion: 'QA question',
      record: record({ epoch: SERVER_EPOCH }),
      targetId,
      url,
    })
    expect(sameEpoch.origin).toBe('memory')
    const sameEpochNoPending = resolveBindingContext({
      pendingQuestion: null,
      record: record({ epoch: SERVER_EPOCH }),
      targetId,
      url,
    })
    expect(sameEpochNoPending.origin).toBe('unbound')
  })

  it('offers validated rebinding on the same target and URL after restart', () => {
    const context = resolveBindingContext({
      pendingQuestion: null,
      record: record(),
      targetId,
      url,
    })
    expect(context.origin).toBe('rebound')
    expect(context.question).toBe(record().questionAnchor)
    expect(context.restart?.previousEpoch).toBe('epoch-A')
    expect(context.restart?.currentEpoch).toBe(SERVER_EPOCH)
  })

  it('fails closed when the tab URL changed after restart', () => {
    const context = resolveBindingContext({
      pendingQuestion: null,
      record: record(),
      targetId,
      url: 'https://www.perplexity.ai/search/other',
    })
    expect(context.origin).toBe('restart_lost')
    expect(context.restartReason).toBe('url_mismatch')
    expect(context.question).toBeNull()
  })

  it('fails closed when the recorded URL is unavailable', () => {
    const noRecordedUrl = resolveBindingContext({
      pendingQuestion: null,
      record: record({ url: null }),
      targetId,
      url,
    })
    expect(noRecordedUrl.origin).toBe('restart_lost')
    expect(noRecordedUrl.restartReason).toBe('url_unavailable')
    const noCurrentUrl = resolveBindingContext({
      pendingQuestion: null,
      record: record(),
      targetId,
      url: null,
    })
    expect(noCurrentUrl.origin).toBe('restart_lost')
  })

  it('keeps unrelated tabs unbound with priorBinding provenance only', () => {
    const context = resolveBindingContext({
      pendingQuestion: null,
      record: record({ targetId: 'owned-1' }),
      targetId,
      url,
    })
    expect(context.origin).toBe('unbound')
    expect(context.question).toBeNull()
    expect(context.priorBinding?.recordedTargetId).toBe('owned-1')
    expect(context.restart).toBeUndefined()
  })

  it('treats a missing current target as priorBinding, not restart_lost', () => {
    const context = resolveBindingContext({
      pendingQuestion: null,
      record: record(),
      targetId: null,
      url,
    })
    expect(context.origin).toBe('unbound')
    expect(context.priorBinding).toBeTruthy()
  })
})
