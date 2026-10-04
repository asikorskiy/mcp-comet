/**
 * Durable pending-question binding with restart provenance.
 *
 * comet_ask binds the submitted question to the connected tab in server
 * memory only. When the MCP server process restarts (client reconnect or
 * crash), that memory is gone. Without durable state a post-restart
 * comet_poll would observe the tab's latest answer and return it as
 * `completed` with an empty bindingError — silently attributing content
 * this process never asked for.
 *
 * Contract (docs/tools.md "Restart provenance and rebinding"):
 * - On confirmed submit the server persists a minimal binding record
 *   (epoch, targetId, tab URL, <=64-char normalized question anchor) to a
 *   local state file. The full prompt text is never persisted.
 * - Every server process owns a unique epoch. When comet_poll/comet_wait
 *   sees a record written by a different epoch, a restart happened:
 *   - Same target AND same URL: run the standard anchor validation.
 *     Success -> binding:"rebound" (validated attribution).
 *     Failure -> binding:"restart_lost", status:"binding_lost", response
 *     suppressed (fail closed, no false attribution).
 *   - Different tab: the poll stays a plain unbound observation
 *     (binding:"unbound") and carries priorBinding provenance only.
 * - Nothing is ever re-asked automatically.
 */

import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const PENDING_BINDING_SCHEMA = 1

/**
 * Unique per server process. A record written by a different epoch proves
 * the server restarted since the question was submitted.
 */
export const SERVER_EPOCH = `${process.pid}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`

export interface PendingBindingRecord {
  schema: number
  epoch: string
  targetId: string
  /** Tab URL recorded at submit time; null when it could not be captured. */
  url: string | null
  /** Normalized <=64-char prefix of the submitted prompt; never the full text. */
  questionAnchor: string
  submittedAt: number
  promptLength: number
}

export type BindingOrigin = 'memory' | 'rebound' | 'unbound' | 'restart_lost'

export interface RestartProvenance {
  previousEpoch: string
  currentEpoch: string
  submittedAt: number
  recordedTargetId: string
  recordedUrl: string | null
}

export interface BindingContext {
  origin: BindingOrigin
  /** Question anchor to hand to the browser status script, if any. */
  question: string | null
  /** Present when a prior-epoch record applies to this poll. */
  restart?: RestartProvenance
  /** Present when a restart record exists but belongs to a different tab. */
  priorBinding?: RestartProvenance
  restartReason?: 'url_mismatch' | 'url_unavailable' | 'anchor_validation_failed'
}

export interface SaveResult {
  ok: boolean
  error?: string
}

export interface LoadResult {
  record: PendingBindingRecord | null
  error?: string
}

export function stateDir(): string {
  return process.env.MCP_COMET_STATE_DIR || join(homedir(), '.mcp-comet')
}

export function pendingStateFilePath(port: number): string {
  return join(stateDir(), `pending-${port}.json`)
}

/** Persisted anchor: normalized prompt prefix, bounded to 64 chars. */
export function questionAnchor(normalizedPrompt: string): string {
  return normalizedPrompt.slice(0, 64)
}

function sanitizeRecord(raw: unknown): PendingBindingRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.schema !== PENDING_BINDING_SCHEMA) return null
  if (typeof r.epoch !== 'string' || !r.epoch) return null
  if (typeof r.targetId !== 'string' || !r.targetId) return null
  if (r.url !== null && typeof r.url !== 'string') return null
  if (typeof r.questionAnchor !== 'string' || !r.questionAnchor) return null
  if (typeof r.submittedAt !== 'number' || !Number.isFinite(r.submittedAt)) return null
  if (typeof r.promptLength !== 'number' || !Number.isFinite(r.promptLength)) return null
  return {
    schema: PENDING_BINDING_SCHEMA,
    epoch: r.epoch,
    targetId: r.targetId,
    url: r.url,
    questionAnchor: r.questionAnchor,
    submittedAt: r.submittedAt,
    promptLength: r.promptLength,
  }
}

export function savePendingBinding(record: PendingBindingRecord, port: number): SaveResult {
  try {
    mkdirSync(stateDir(), { recursive: true })
    writeFileSync(pendingStateFilePath(port), `${JSON.stringify(record, null, 2)}\n`)
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function loadPendingBinding(port: number): LoadResult {
  try {
    const raw = readFileSync(pendingStateFilePath(port), 'utf-8')
    const record = sanitizeRecord(JSON.parse(raw))
    if (!record) return { record: null, error: 'Corrupt or unsupported pending binding record' }
    return { record }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { record: null }
    }
    return { record: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export function clearPendingBinding(port: number): SaveResult {
  try {
    rmSync(pendingStateFilePath(port), { force: true })
    return { ok: true }
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Pure restart-provenance decision for one comet_poll/comet_wait call.
 * `url` is the connected tab URL, or null when it could not be captured.
 */
export function resolveBindingContext(input: {
  pendingQuestion: string | null
  record: PendingBindingRecord | null
  targetId: string | null
  url: string | null
}): BindingContext {
  const { pendingQuestion, record, targetId, url } = input
  if (!record) {
    if (pendingQuestion) return { origin: 'memory', question: pendingQuestion }
    return { origin: 'unbound', question: null }
  }
  if (record.epoch === SERVER_EPOCH) {
    // Same process: in-memory binding and record are written together.
    if (pendingQuestion) return { origin: 'memory', question: pendingQuestion }
    return { origin: 'unbound', question: null }
  }
  // The record was written by another server process: restart provenance.
  const restart: RestartProvenance = {
    previousEpoch: record.epoch,
    currentEpoch: SERVER_EPOCH,
    submittedAt: record.submittedAt,
    recordedTargetId: record.targetId,
    recordedUrl: record.url,
  }
  if (targetId !== record.targetId) {
    // Different tab: this poll is a plain unbound observation; unrelated
    // tabs must keep working and must not fail closed.
    return { origin: 'unbound', question: null, priorBinding: restart }
  }
  if (!record.url || !url) {
    return { origin: 'restart_lost', question: null, restart, restartReason: 'url_unavailable' }
  }
  if (record.url !== url) {
    return { origin: 'restart_lost', question: null, restart, restartReason: 'url_mismatch' }
  }
  // Same tab and same URL: candidate for validated rebinding. The caller
  // must still run the standard anchor validation and downgrade to
  // restart_lost (anchor_validation_failed) when the script reports an error.
  return { origin: 'rebound', question: record.questionAnchor, restart }
}
