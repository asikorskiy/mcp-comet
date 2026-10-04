#!/usr/bin/env node
/**
 * Live isolated stdio E2E: restart provenance for the pending-question binding.
 *
 * Spawns server process A, submits a public-only probe question in an owned
 * target, verifies the durable binding record, kills A, spawns process B, and
 * asserts:
 *   1. B's comet_poll on the same owned tab rebinds with validation
 *      (binding:"rebound", restart provenance, exact target/URL).
 *   2. The probe question is not re-asked (marker counts unchanged).
 *   3. An unrelated owned tab stays unbound (priorBinding only, no fail-closed).
 *   4. A corrupted recorded URL fails closed (binding:"restart_lost",
 *      status:"binding_lost", response suppressed) without attribution.
 *   5. Restoring the record re-enables validated rebinding.
 *
 * Run: node scripts/e2e-restart-provenance.mjs   (requires npm run build first)
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const MARKER = 'QA-RESTART-1007'
const EXPECT = 'OK-1007'
const QUESTION =
  MARKER +
  ' restart provenance probe: reply with exactly ' +
  EXPECT +
  ' and nothing else. Do not research anything.'
const stateDir = mkdtempSync(join(tmpdir(), 'comet-restart-e2e-'))

let failures = 0
function check(name, condition, detail) {
  const ok = Boolean(condition)
  if (!ok) failures += 1
  console.info((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''))
  return ok
}

function childOf(transport) {
  return transport._process || transport._childProcess || null
}

async function startServer() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(repoRoot, 'dist', 'cli.js'), 'start'],
    env: { ...process.env, MCP_COMET_STATE_DIR: stateDir, COMET_LOG_LEVEL: 'error' },
  })
  const client = new Client({ name: 'comet-restart-e2e', version: '1.0.0' })
  await client.connect(transport)
  return { transport, client, child: childOf(transport) }
}

async function stopServer(handle, force) {
  try {
    await handle.client.close()
  } catch {}
  const child = handle.child
  if (child && child.exitCode === null) {
    child.kill(force ? 'SIGKILL' : 'SIGTERM')
    await new Promise((r) => setTimeout(r, 700))
    if (child.exitCode === null) child.kill('SIGKILL')
  }
}

async function call(client, name, args) {
  const res = await client.callTool({ name, arguments: args || {} })
  if (res.isError) throw new Error(name + ' failed: ' + JSON.stringify(res.content))
  return (res.content || []).map((c) => c.text || '').join('\n')
}

async function pollJson(client) {
  return JSON.parse(await call(client, 'comet_poll'))
}

function stateFile() {
  const files = readdirSync(stateDir).filter((f) => f.startsWith('pending-'))
  return files.length ? join(stateDir, files[0]) : null
}

function readRecord() {
  const file = stateFile()
  if (!file) return null
  try {
    return JSON.parse(readFileSync(file, 'utf-8'))
  } catch {
    return null
  }
}

function epochPid(epoch) {
  return Number.parseInt(String(epoch || '').split('-')[0], 10) || null
}

function countOf(text, needle) {
  return text.split(needle).length - 1
}

let targetId = null
let target2 = null
let pidA = null
let pidB = null
let recordA = null
try {
  console.info('state dir: ' + stateDir)

  // --- Process A -----------------------------------------------------------
  const a = await startServer()
  pidA = a.child ? a.child.pid : null
  console.info('server A pid: ' + pidA)
  await call(a.client, 'comet_list_tabs')
  const owned1 = await call(a.client, 'comet_create_owned_target')
  targetId = (owned1.match(/created and bound: (\S+)/) || [])[1] || null
  check('owned target created', Boolean(targetId), owned1.split('\n')[0])
  let askOut = await call(a.client, 'comet_ask', { prompt: QUESTION, newChat: true })
  if (askOut.includes('Prompt not submitted')) {
    console.info('retry ask without newChat: ' + askOut.trim())
    askOut = await call(a.client, 'comet_ask', { prompt: QUESTION })
  }
  check('probe question submitted', askOut.includes('Prompt submitted successfully'), askOut.trim())
  const waited = await call(a.client, 'comet_wait', { timeout: 150000 })
  check(
    'response present before restart',
    waited.includes(EXPECT),
    waited.slice(0, 140).replace(/\s+/g, ' '),
  )
  recordA = readRecord()
  check('binding record persisted', Boolean(recordA), JSON.stringify(recordA || {}).slice(0, 220))
  check(
    'record epoch belongs to process A',
    Boolean(recordA) && epochPid(recordA.epoch) === pidA,
    'epoch=' + (recordA ? recordA.epoch : 'none') + ' pidA=' + pidA,
  )
  check(
    'record target matches owned target',
    Boolean(recordA) && recordA.targetId === targetId,
    recordA ? String(recordA.targetId) : 'none',
  )
  const recordedUrl = recordA ? recordA.url || '' : ''
  check('record URL captured', recordedUrl.indexOf('https://www.perplexity.ai') === 0, recordedUrl)
  const contentBefore = await call(a.client, 'comet_get_page_content', { maxLength: 6000 })
  // Count in the page body only: the document title repeats the question text.
  const bodyBefore = contentBefore.slice(contentBefore.indexOf('\n\n') + 2)
  const markerBefore = countOf(bodyBefore, MARKER)
  const expectBefore = countOf(bodyBefore, EXPECT)
  check('probe question appears once in body', markerBefore === 1, 'count=' + markerBefore)
  check('probe answer visible in body', expectBefore >= 1, 'count=' + expectBefore)
  await stopServer(a, false)

  // --- Process B (restart) -------------------------------------------------
  const b = await startServer()
  pidB = b.child ? b.child.pid : null
  console.info('server B pid: ' + pidB)
  check(
    'restart produced a new process',
    Boolean(pidB) && pidB !== pidA,
    'pidA=' + pidA + ' pidB=' + pidB,
  )
  await call(b.client, 'comet_list_tabs')
  await call(b.client, 'comet_switch_tab', { tabId: targetId })
  const poll1 = await pollJson(b.client)
  check(
    'post-restart poll rebinds with validation',
    poll1.binding === 'rebound',
    'binding=' + poll1.binding,
  )
  check(
    'restart provenance present',
    Boolean(poll1.restart) && poll1.restart.previousEpoch === recordA.epoch,
    JSON.stringify(poll1.restart || {}),
  )
  check(
    'rebound answer attributed',
    poll1.status === 'completed' && String(poll1.response).includes(EXPECT),
    'status=' + poll1.status,
  )
  check('rebound has no bindingError', !poll1.bindingError, String(poll1.bindingError || ''))
  check(
    'current epoch belongs to process B',
    epochPid(poll1.restart && poll1.restart.currentEpoch) === pidB,
    'currentEpoch=' + (poll1.restart ? poll1.restart.currentEpoch : 'none'),
  )
  const contentAfter = await call(b.client, 'comet_get_page_content', { maxLength: 6000 })
  const bodyAfter = contentAfter.slice(contentAfter.indexOf('\n\n') + 2)
  check(
    'no duplicate ask after restart',
    countOf(bodyAfter, MARKER) === markerBefore,
    'before=' + markerBefore + ' after=' + countOf(bodyAfter, MARKER),
  )
  check(
    'answer count unchanged after restart',
    countOf(bodyAfter, EXPECT) === expectBefore,
    'before=' + expectBefore + ' after=' + countOf(bodyAfter, EXPECT),
  )

  // --- Unrelated owned tab --------------------------------------------------
  const owned2 = await call(b.client, 'comet_create_owned_target')
  target2 = (owned2.match(/created and bound: (\S+)/) || [])[1] || null
  check('second owned target created', Boolean(target2), String(target2))
  const poll2 = await pollJson(b.client)
  check('unrelated tab stays unbound', poll2.binding === 'unbound', 'binding=' + poll2.binding)
  check(
    'unrelated tab not failed closed',
    poll2.status !== 'binding_lost',
    'status=' + poll2.status,
  )
  check(
    'priorBinding provenance exposed',
    Boolean(poll2.priorBinding) && poll2.priorBinding.recordedTargetId === targetId,
    JSON.stringify(poll2.priorBinding || {}),
  )
  check(
    'unrelated tab response not suppressed',
    poll2.response === '' && !poll2.bindingError,
    JSON.stringify({ response: poll2.response, bindingError: poll2.bindingError }),
  )

  // --- Fail closed on URL mismatch -----------------------------------------
  await call(b.client, 'comet_switch_tab', { tabId: targetId })
  const poll3 = await pollJson(b.client)
  check(
    'rebind works again on the bound tab',
    poll3.binding === 'rebound',
    'binding=' + poll3.binding,
  )
  const recordB = readRecord()
  const file = stateFile()
  writeFileSync(
    file,
    JSON.stringify({ ...recordB, url: 'https://www.perplexity.ai/search/corrupted' }),
  )
  const poll4 = await pollJson(b.client)
  check(
    'corrupted URL fails closed',
    poll4.binding === 'restart_lost' && poll4.status === 'binding_lost',
    'binding=' + poll4.binding + ' status=' + poll4.status,
  )
  check(
    'response suppressed on fail closed',
    poll4.response === '',
    'response=' + JSON.stringify(poll4.response).slice(0, 60),
  )
  check(
    'fail closed keeps restart provenance',
    Boolean(poll4.restart) && poll4.restart.previousEpoch === recordA.epoch,
    'restart present',
  )
  writeFileSync(file, JSON.stringify(recordB))
  const poll5 = await pollJson(b.client)
  check(
    'restored record rebinds again',
    poll5.binding === 'rebound' && String(poll5.response).includes(EXPECT),
    'binding=' + poll5.binding,
  )

  rmSync(stateDir, { recursive: true, force: true })
  await stopServer(b, true)
  console.info('owned tabs left open (by design): ' + targetId + ', ' + target2)
} catch (err) {
  failures += 1
  console.info('ERROR ' + (err && err.message))
  rmSync(stateDir, { recursive: true, force: true })
}

if (failures > 0) {
  console.info('E2E-RESTART-PROVENANCE: FAIL (' + failures + ' failed checks)')
  process.exit(1)
}
console.info(
  'E2E-RESTART-PROVENANCE: PASS (pidA=' +
    pidA +
    ' pidB=' +
    pidB +
    ' url=' +
    (recordA ? recordA.url : 'none') +
    ')',
)
