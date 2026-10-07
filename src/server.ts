import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { CDPClient } from './cdp/client.js'
import { loadConfig } from './config.js'
import { EvaluationError, toMcpError } from './errors.js'
import { createLogger } from './logger.js'
import {
  type BindingContext,
  clearPendingBinding,
  loadPendingBinding,
  PENDING_BINDING_SCHEMA,
  type PendingBindingRecord,
  questionAnchor,
  resolveBindingContext,
  type SaveResult,
  SERVER_EPOCH,
  savePendingBinding,
} from './pending-binding.js'
import type { SelectorSet } from './selectors/types.js'
import type { CategorizedTabs, TabInfo } from './types.js'
import { buildListConversationsScript } from './ui/conversations.js'
import {
  buildExpandCollapsedCitationsScript,
  buildExtractPageContentScript,
  buildExtractSourcesScript,
} from './ui/extraction.js'
import { buildTypePromptScript } from './ui/input.js'
import {
  buildModeChipClickScript,
  buildModeChipScript,
  buildModeMenuItemClickScript,
  buildModeMenuItemScript,
  buildModePreflightScript,
  buildReadActiveModeScript,
  buildSubmitPromptScript,
  chipLabelToMode,
} from './ui/navigation.js'
import { SELECTORS } from './ui/selectors.js'
import { buildGetAgentStatusScript } from './ui/status.js'
import { buildStopAgentScript } from './ui/stop.js'
import { isPerplexityDomain } from './utils.js'
import { detectCometVersion } from './version.js'

// ---------------------------------------------------------------------------
// Configuration & singletons
// ---------------------------------------------------------------------------

const config = loadConfig()
const logger = createLogger(config.logLevel)
const client = CDPClient.getInstance(config)

/** Active selector set — updated after each comet_connect to match Comet's Chrome version. */
let activeSelectors: SelectorSet = SELECTORS
let pendingQuestion: string | null = null

/** Ensure the client is connected before using tools. Auto-connects if needed. */
async function ensureConnected(): Promise<void> {
  if (client.state.targetId) return
  logger.info('Auto-connecting to Comet...')
  await client.launchOrConnect()
  // Never close user tabs merely to discover or call this server.
  try {
    const { chromeMajor, selectors } = await detectCometVersion(config.port)
    activeSelectors = selectors
    logger.info(`Auto-connected to Comet Chrome/${chromeMajor}`)
  } catch {
    // Version detection failure is non-fatal
  }
}

// ---------------------------------------------------------------------------
// Tool definitions (exported for testing)
// ---------------------------------------------------------------------------

export interface ToolDef {
  name: string
  description: string
  inputSchema: { type: 'object'; properties: Record<string, unknown>; required?: string[] }
}

/** Recursively unwrap ZodOptional/ZodNullable to get the inner type. */
function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema
  let maxDepth = 5
  while (maxDepth-- > 0 && (current instanceof z.ZodOptional || current instanceof z.ZodNullable)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    // biome-ignore lint/suspicious/noExplicitAny: Zod internal API access
    current = (current as any)._def.innerType as z.ZodTypeAny
  }
  return current
}

/** Check if schema is optional or nullable at any level. */
function isOptionalish(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodOptional || schema instanceof z.ZodNullable
}

/** Build a JSON-schema-shaped object from a zod raw shape for the exported registry. */
function buildInputSchema(shape: Record<string, z.ZodTypeAny>): ToolDef['inputSchema'] {
  const properties: Record<string, unknown> = {}
  const required: string[] = []

  for (const [key, schema] of Object.entries(shape)) {
    const entry: Record<string, unknown> = {}
    const inner = unwrapSchema(schema)

    if (inner instanceof z.ZodString) {
      entry.type = 'string'
    } else if (inner instanceof z.ZodNumber) {
      entry.type = 'number'
    } else if (inner instanceof z.ZodBoolean) {
      entry.type = 'boolean'
    } else if (inner instanceof z.ZodEnum) {
      entry.type = 'string'
      entry.enum = [...inner.options]
    } else {
      entry.type = 'string'
    }

    if (schema.description) {
      entry.description = schema.description
    }

    properties[key] = entry

    if (!isOptionalish(schema)) {
      required.push(key)
    }
  }

  const result: Record<string, unknown> = { type: 'object', properties }
  if (required.length > 0) result.required = required
  return result as ToolDef['inputSchema']
}

// Zod raw shapes for tool parameters
const connectShape = { port: z.number().optional() }
const askShape = {
  prompt: z.string().describe('The question or instruction to send to Perplexity Comet'),
  newChat: z.boolean().optional().describe('Start a fresh chat before sending the prompt'),
  timeout: z.number().optional().describe('Maximum wait time in ms for the agent response'),
}
const screenshotShape = {
  format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
}
const modeShape = {
  mode: z
    .enum(['standard', 'deep-research', 'model-council', 'create', 'learn', 'review', 'computer'])
    .nullable()
    .optional()
    .describe(
      'Mode to switch to via slash command. Omit or null to query current mode. Available: standard (default search), deep-research, model-council, create, learn, review, computer.',
    ),
}
const switchTabShape = {
  tabId: z.string().optional().describe('Exact tab ID to switch to'),
  title: z.string().optional().describe('Substring of the tab title to switch to'),
}
const openConversationShape = { url: z.string().describe('Full URL of the conversation to open') }
const openOwnedConversationShape = {
  targetId: z.string().describe('Exact target ID returned by comet_create_owned_target'),
  url: z.string().describe('Full Perplexity conversation URL to open only in the owned target'),
}
const getPageContentShape = {
  maxLength: z.number().optional().describe('Maximum characters of page text to extract'),
}
const waitShape = {
  timeout: z.number().optional().describe('Maximum wait time in ms (default: 120000)'),
}

export const toolDefinitions: ToolDef[] = [
  {
    name: 'comet_connect',
    description:
      'Connect to or launch the Perplexity Comet browser. Closes extra tabs and navigates to perplexity.ai.',
    inputSchema: buildInputSchema(connectShape),
  },
  {
    name: 'comet_ask',
    description:
      'Send a prompt to Perplexity Comet and return immediately. Supports newChat to start fresh. Use comet_poll or comet_wait to get the response.',
    inputSchema: buildInputSchema(askShape),
  },
  {
    name: 'comet_poll',
    description: 'Poll the current agent status, steps, and response content.',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_stop',
    description: 'Stop the currently running agent by clicking the stop/cancel button.',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_screenshot',
    description: 'Take a screenshot of the current Comet browser tab.',
    inputSchema: buildInputSchema(screenshotShape),
  },
  {
    name: 'comet_mode',
    description:
      'Get or switch the current Comet mode. Modes are accessed via "/" slash command in the input field. Available: standard (default), deep-research, model-council, create, learn, review, computer.',
    inputSchema: buildInputSchema(modeShape),
  },
  {
    name: 'comet_list_tabs',
    description:
      'List all browser tabs categorized by role (main, sidecar, agent-browsing, overlay, other).',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_switch_tab',
    description: 'Switch to a different browser tab by ID or title substring.',
    inputSchema: buildInputSchema(switchTabShape),
  },
  {
    name: 'comet_get_sources',
    description: 'Extract and list the sources/citations from the current Comet response.',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_list_conversations',
    description: 'List recent conversation links visible on the page.',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_create_owned_target',
    description:
      'Create and bind an explicit background MCP-owned tab without navigating, activating, closing, or reusing existing tabs. Fails closed if browser-level CDP ownership verification is unavailable.',
    inputSchema: buildInputSchema({}),
  },
  {
    name: 'comet_open_owned_conversation',
    description:
      'Open a Perplexity conversation only in the exact target returned by comet_create_owned_target. Refuses non-owned, missing, or ambiguous targets.',
    inputSchema: buildInputSchema(openOwnedConversationShape),
  },
  {
    name: 'comet_open_conversation',
    description: 'Navigate to a specific conversation URL.',
    inputSchema: buildInputSchema(openConversationShape),
  },
  {
    name: 'comet_get_page_content',
    description: 'Extract the current page content (title and body text) up to a maximum length.',
    inputSchema: buildInputSchema(getPageContentShape),
  },
  {
    name: 'comet_wait',
    description:
      'Poll until the current agent finishes responding and return the full response. Use after comet_ask times out.',
    inputSchema: buildInputSchema(waitShape),
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textResult(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function extractValue(result: {
  result?: { value?: unknown; description?: string }
  exceptionDetails?: unknown
}): unknown {
  if (result.exceptionDetails) {
    const desc = result.result?.description ?? String(result.exceptionDetails)
    throw new EvaluationError(`Script error: ${desc}`, { expression: '(unknown)' })
  }
  return result.result?.value
}

/** Runtime shape returned by buildGetAgentStatusScript(). */
interface RawAgentStatus {
  status: string
  steps: string[]
  currentStep: string
  response: string
  hasStopButton: boolean
  hasLoadingSpinner?: boolean
  proseCount?: number
  bindingError?: string
}

function parseAgentStatus(raw: unknown): RawAgentStatus {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as RawAgentStatus
    } catch {
      return {
        status: 'idle',
        steps: [],
        currentStep: '',
        response: '',
        hasStopButton: false,
        proseCount: 0,
        bindingError: 'Browser status script returned invalid JSON',
      }
    }
  }
  return raw as RawAgentStatus
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function bindingLostStatus(diagnostic: string): RawAgentStatus {
  return {
    status: 'binding_lost',
    steps: [],
    currentStep: diagnostic,
    response: '',
    hasStopButton: false,
    hasLoadingSpinner: false,
    proseCount: 0,
    bindingError: diagnostic,
  }
}

function restartLostDiagnostic(
  reason: BindingContext['restartReason'],
  record: PendingBindingRecord | null,
): string {
  if (reason === 'url_mismatch') {
    return `Rebind failed after server restart: tab URL changed (expected ${record?.url ?? 'unknown'})`
  }
  return 'Rebind failed after server restart: recorded tab URL unavailable for validation'
}

/** Current URL of the connected tab, or null when it cannot be captured. */
async function currentTargetUrl(): Promise<string | null> {
  try {
    const targets = await client.listTargets()
    const current = targets.find((t) => t.id === client.state.targetId)
    return typeof current?.url === 'string' && current.url ? current.url : null
  } catch {
    return null
  }
}

/**
 * Persist the pending-question binding next to the in-memory one so a later
 * server process can detect the restart and either rebind with validation or
 * fail closed instead of attributing tab content it never asked for.
 */
async function recordQuestionBinding(normalizedPrompt: string): Promise<SaveResult> {
  if (!client.state.targetId) {
    return { ok: false, error: 'No connected target to bind the question to' }
  }
  const record: PendingBindingRecord = {
    schema: PENDING_BINDING_SCHEMA,
    epoch: SERVER_EPOCH,
    targetId: client.state.targetId,
    url: await currentTargetUrl(),
    questionAnchor: questionAnchor(normalizedPrompt),
    submittedAt: Date.now(),
    promptLength: normalizedPrompt.length,
  }
  return savePendingBinding(record, client.state.port)
}

/** Clear both the in-memory binding and its durable record. */
function clearQuestionBinding(): void {
  pendingQuestion = null
  const result = clearPendingBinding(client.state.port)
  if (!result.ok) logger.warn(`Failed to clear pending binding: ${result.error}`)
}

function formatTabs(categorized: CategorizedTabs): string {
  const lines: string[] = []
  const categories = [
    { label: 'Main', tabs: categorized.main },
    { label: 'Sidecar', tabs: categorized.sidecar },
    { label: 'Agent Browsing', tabs: categorized.agentBrowsing },
    { label: 'Overlay', tabs: categorized.overlay },
    { label: 'Other', tabs: categorized.others },
  ]
  for (const cat of categories) {
    if (cat.tabs.length === 0) continue
    lines.push(`=== ${cat.label} (${cat.tabs.length}) ===`)
    for (const tab of cat.tabs) {
      lines.push(`  [${tab.id}] ${tab.title} — ${tab.url}`)
    }
  }
  return lines.length > 0 ? lines.join('\n') : 'No tabs found.'
}

// ---------------------------------------------------------------------------
// Server setup & start
// ---------------------------------------------------------------------------

export async function startServer(): Promise<void> {
  logger.info('Starting MCP Comet server...')

  const server = new McpServer({
    name: 'mcp-comet',
    version: '1.1.5',
  })

  // 1. comet_connect
  server.tool(
    'comet_connect',
    'Connect to or launch the Perplexity Comet browser. Closes extra tabs and navigates to perplexity.ai.',
    connectShape,
    async ({ port }) => {
      try {
        await client.launchOrConnect(port)
        await client.closeExtraTabs()

        // Detect Comet version and load matching selectors
        const effectivePort = port ?? config.port
        const { chromeMajor, selectors } = await detectCometVersion(effectivePort)
        activeSelectors = selectors
        logger.info(`Detected Comet Chrome/${chromeMajor}, loaded selector set`)

        // Navigate to main perplexity.ai page if we landed on sidecar or non-perplexity page
        const targets = await client.listTargets()
        const currentTarget = targets.find((t) => t.id === client.state.targetId)
        const isMainPage =
          currentTarget?.url.includes('perplexity.ai') && !currentTarget?.url.includes('sidecar')
        if (!isMainPage) {
          // Try to find and connect to main page first
          const mainPage = targets.find(
            (t) =>
              t.url.includes('perplexity.ai') && !t.url.includes('sidecar') && t.type === 'page',
          )
          if (mainPage) {
            await client.disconnect()
            await client.connect(mainPage.id)
          } else {
            await client.navigate('https://www.perplexity.ai')
          }
        }
        return textResult(
          `Connected to Comet on port ${client.state.port} (Chrome/${chromeMajor}), target ${client.state.targetId}`,
        )
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 2. comet_ask
  server.tool(
    'comet_ask',
    'Send a prompt to Perplexity Comet and return immediately. Supports newChat to start fresh. Use comet_poll or comet_wait to get the response.',
    askShape,
    async ({ prompt, newChat }) => {
      try {
        await ensureConnected()
        const normalizedPrompt = client.normalizePrompt(prompt)
        const fingerprint = normalizedPrompt.slice(0, 120)
        // Handle newChat or tab management
        if (newChat) {
          // Keep the selected target and other browser tabs intact.
          await client.navigate('https://www.perplexity.ai')
          clearQuestionBinding()
          await sleep(2000)
        }

        const beforeRaw = await client.safeEvaluate(
          `(function() { var text = document.body ? document.body.innerText : ''; var marker = ${JSON.stringify(fingerprint)}; return text.split(marker).length - 1; })()`,
        )
        const beforeCount = Number(extractValue(beforeRaw)) || 0

        // Type prompt
        const typeResult = await client.safeEvaluate(
          buildTypePromptScript(normalizedPrompt, activeSelectors),
        )
        logger.debug('Type result:', extractValue(typeResult))

        // Wait for React to process
        await sleep(500)

        // Submit
        const submitResult = await client.safeEvaluate(buildSubmitPromptScript())
        const submitted = extractValue(submitResult)
        logger.debug('Submit result:', submitted)
        if (submitted !== 'clicked_submit') {
          return textResult(
            `Prompt not submitted: ${String(submitted)}. Inspect the composer before retrying.`,
          )
        }

        const confirmScript = `(function() {
          var marker = ${JSON.stringify(fingerprint)};
          var text = document.body ? document.body.innerText : '';
          var input = document.querySelector('#ask-input') || document.querySelector('[contenteditable="true"]');
          return JSON.stringify({ count: text.split(marker).length - 1, draft: input ? (input.innerText || input.value || '') : '' });
        })()`
        for (let attempt = 0; attempt < 8; attempt++) {
          await sleep(450)
          const confirmRaw = await client.safeEvaluate(confirmScript)
          const state = JSON.parse(String(extractValue(confirmRaw))) as {
            count: number
            draft: string
          }
          if (state.count > beforeCount && !state.draft.includes(fingerprint)) {
            pendingQuestion = normalizedPrompt
            const bindingSaved = await recordQuestionBinding(normalizedPrompt)
            if (!bindingSaved.ok) {
              logger.warn(`Failed to persist pending binding: ${bindingSaved.error}`)
            }
            return textResult(
              'Prompt submitted successfully. Use comet_poll to track status or comet_wait to block until completion.',
            )
          }
        }

        return textResult(
          'Prompt submission unconfirmed. Inspect the conversation before retrying.',
        )
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 3. comet_poll
  server.tool(
    'comet_poll',
    'Poll the current agent status, steps, and response content.',
    {},
    async () => {
      try {
        await ensureConnected()
        const { record, error: loadError } = loadPendingBinding(client.state.port)
        if (loadError) logger.warn(`Pending binding record unreadable: ${loadError}`)
        const url = record && record.epoch !== SERVER_EPOCH ? await currentTargetUrl() : null
        const context = resolveBindingContext({
          pendingQuestion,
          record,
          targetId: client.state.targetId,
          url,
        })

        let binding: BindingContext['origin'] = context.origin
        let status: RawAgentStatus
        if (context.origin === 'restart_lost') {
          status = bindingLostStatus(restartLostDiagnostic(context.restartReason, record))
        } else {
          const raw = await client.safeEvaluate(
            buildGetAgentStatusScript(activeSelectors, context.question ?? undefined),
          )
          status = parseAgentStatus(extractValue(raw))
          if (context.origin === 'rebound') {
            if (status.bindingError) {
              status = bindingLostStatus(
                `Rebind validation failed after server restart: ${status.bindingError}`,
              )
              binding = 'restart_lost'
            } else if (!status.response) {
              status.status = 'working'
              status.currentStep = 'Waiting for the rebound question to receive an answer'
            }
          } else if (context.origin === 'memory' && !status.response) {
            status.status = 'working'
            status.currentStep =
              status.bindingError || 'Waiting for this question to receive an answer'
          }
        }

        const result: Record<string, unknown> = { ...status, binding }
        if (context.restart) result.restart = context.restart
        if (context.priorBinding) result.priorBinding = context.priorBinding
        return textResult(JSON.stringify(result, null, 2))
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 4. comet_stop
  server.tool(
    'comet_stop',
    'Stop the currently running agent by clicking the stop/cancel button.',
    {},
    async () => {
      try {
        await ensureConnected()
        const script = buildStopAgentScript()
        // Retry up to 5 times — agent may not have started yet
        for (let attempt = 0; attempt < 5; attempt++) {
          const raw = await client.safeEvaluate(script)
          const result = extractValue(raw)
          if (result === 'stopped') return textResult('Agent stopped.')
          await sleep(1000)
        }
        return textResult('No stop button found.')
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 5. comet_screenshot
  server.tool(
    'comet_screenshot',
    'Take a screenshot of the current Comet browser tab (supports png and jpeg formats).',
    screenshotShape,
    async ({ format }) => {
      try {
        await ensureConnected()
        const fmt = format ?? config.screenshotFormat
        const data = await client.screenshot(fmt)
        const mimeType = fmt === 'jpeg' ? 'image/jpeg' : 'image/png'
        return {
          content: [{ type: 'image' as const, data, mimeType }],
        }
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 6. comet_mode
  server.tool(
    'comet_mode',
    'Get or switch the current Comet mode. The mode is read from or switched via the composer mode chip dropdown (safe on the blank home composer). Available: standard (default), deep-research, model-council, create, learn, review, computer.',
    modeShape,
    async ({ mode }) => {
      try {
        await ensureConnected()
        if (mode === undefined || mode === null) {
          // 1. Fast URL-based check for computer mode
          const urlRaw = await client.safeEvaluate(buildReadActiveModeScript())
          const urlMode = extractValue(urlRaw)
          if (urlMode !== 'standard') {
            return textResult(`Current mode: ${urlMode}`)
          }
          // 2. Non-invasive read of the composer mode chip label.
          try {
            const chipRaw = extractValue(await client.safeEvaluate(buildModeChipScript()))
            const chip = JSON.parse(String(chipRaw)) as {
              found?: boolean
              label?: string
            }
            if (chip && chip.found && chip.label) {
              const chipMode = chipLabelToMode(chip.label)
              if (chipMode) {
                return textResult(`Current mode: ${chipMode} (composer chip: ${chip.label})`)
              }
            }
          } catch {
            // fall through to the non-invasive unknown response
          }
          // A mode query must not navigate or erase an unsent prompt.
          return textResult('Current mode: unknown (non-invasive read is unavailable)')
        }
        // The chip dropdown switches mode in place, so a blank project composer is as safe as
        // home and keeps the project instructions. Never touch a conversation or erase a draft.
        const preflightRaw = extractValue(await client.safeEvaluate(buildModePreflightScript()))
        let preflight: { url?: string; hasInput?: boolean; hasDraft?: boolean }
        try {
          preflight = JSON.parse(String(preflightRaw))
        } catch {
          return textResult('Mode switch failed closed: browser preflight unavailable')
        }
        const pageUrl = String(preflight.url ?? '')
        const isHome =
          pageUrl === 'https://www.perplexity.ai/' || pageUrl === 'https://www.perplexity.ai'
        const isProjectHome = /^https:\/\/www\.perplexity\.ai\/projects\/[^/?#]+\/?$/.test(pageUrl)
        if (!isHome && !isProjectHome) {
          return textResult(
            'Mode switch failed closed: conversation mode cannot be safely selected without leaving context',
          )
        }
        if (!preflight.hasInput || preflight.hasDraft) {
          return textResult('Mode switch failed closed: composer missing or unsent draft present')
        }
        if (mode === 'standard') {
          return textResult(
            'Mode switch failed closed: standard mode cannot be confirmed by the current UI',
          )
        }
        const MAX_MODE_ATTEMPTS = 3
        let lastReason = 'unknown failure'
        let attemptsTried = 0
        for (let attempt = 1; attempt <= MAX_MODE_ATTEMPTS; attempt++) {
          attemptsTried = attempt
          const chipRaw = extractValue(await client.safeEvaluate(buildModeChipScript()))
          let chip: { found?: boolean; reason?: string; label?: string }
          try {
            chip = JSON.parse(String(chipRaw))
          } catch {
            lastReason = 'mode chip probe unavailable'
            break
          }
          if (!chip.found) {
            // No mode chip in the composer UI: the UI is unknown; fail closed
            // instead of clicking anything else.
            lastReason = `mode chip not found (${chip.reason || 'no candidate'})`
            break
          }
          if (chipLabelToMode(String(chip.label || '')) === mode) {
            return textResult(`Mode already active: ${mode} (composer chip: ${chip.label})`)
          }
          // Radix triggers only react to a full pointer event sequence;
          // plain synthetic clicks and CDP mouse events do not open the menu.
          const openRaw = extractValue(await client.safeEvaluate(buildModeChipClickScript()))
          let opened: { clicked?: boolean; label?: string }
          try {
            opened = JSON.parse(String(openRaw))
          } catch {
            lastReason = 'mode chip click probe unavailable'
            break
          }
          if (!opened.clicked) {
            lastReason = 'mode chip click failed'
            continue
          }
          await sleep(900)
          const itemRaw = extractValue(
            await client.safeEvaluate(buildModeMenuItemClickScript(mode)),
          )
          let item: { clicked?: boolean; label?: string; role?: string; menuOpen?: boolean }
          try {
            item = JSON.parse(String(itemRaw))
          } catch {
            lastReason = 'mode menu click probe unavailable'
            continue
          }
          if (!item.clicked) {
            lastReason = `mode menu did not contain a '${mode}' item`
            if (item.menuOpen) {
              // Toggle the trigger to close the stale menu before retrying.
              await client.safeEvaluate(buildModeChipClickScript())
            }
            await sleep(300)
            continue
          }
          await sleep(1100)
          const confirmRaw = extractValue(await client.safeEvaluate(buildModeChipScript()))
          let confirmChip: { found?: boolean; label?: string }
          try {
            confirmChip = JSON.parse(String(confirmRaw))
          } catch {
            lastReason = 'mode chip confirm probe unavailable'
            continue
          }
          if (confirmChip.found && chipLabelToMode(String(confirmChip.label || '')) === mode) {
            return textResult(
              `Mode switched and confirmed: ${mode} (composer chip: ${confirmChip.label})`,
            )
          }
          lastReason = `chip label after click: ${
            confirmChip.found ? confirmChip.label : 'chip missing'
          }`
        }
        return textResult(
          `Mode switch failed: ${lastReason} (${attemptsTried}/${MAX_MODE_ATTEMPTS} attempts)`,
        )
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 7. comet_list_tabs
  server.tool(
    'comet_list_tabs',
    'List all browser tabs categorized by role (main, sidecar, agent-browsing, overlay, other).',
    {},
    async () => {
      try {
        await ensureConnected()
        const categorized = await client.listTabsCategorized()
        return textResult(formatTabs(categorized))
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 8. comet_switch_tab
  server.tool(
    'comet_switch_tab',
    'Switch to a different browser tab by ID or title substring.',
    switchTabShape,
    async ({ tabId, title }) => {
      try {
        await ensureConnected()
        const targets = await client.listTargets()
        let target: TabInfo | undefined

        if (tabId) {
          target = targets.find((t) => t.id === tabId)
        } else if (title) {
          target = targets.find((t) => t.title.includes(title))
        }

        if (!target) {
          const criteria = tabId ? `ID "${tabId}"` : `title containing "${title}"`
          return textResult(`Tab not found matching ${criteria}`)
        }

        await client.disconnect()
        const newTargetId = await client.connect(target.id)
        return textResult(`Switched to tab [${newTargetId}] ${target.title} — ${target.url}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 9. comet_get_sources
  server.tool(
    'comet_get_sources',
    'Extract and list the sources/citations from the current Comet response.',
    {},
    async () => {
      try {
        await ensureConnected()
        const raw = await client.safeEvaluate(buildExtractSourcesScript())
        let sources = JSON.parse(String(extractValue(raw))) as Array<{
          url: string
          title: string
        }>

        // Second pass: expand collapsed citations (empty URLs) and re-extract
        const collapsedSources = sources.filter((s) => !s.url)
        if (collapsedSources.length > 0) {
          const clickRaw = await client.safeEvaluate(buildExpandCollapsedCitationsScript())
          const clickedCount = extractValue(clickRaw)
          if (typeof clickedCount === 'number' && clickedCount > 0) {
            await sleep(500)
            const raw2 = await client.safeEvaluate(buildExtractSourcesScript())
            const expandedSources = JSON.parse(String(extractValue(raw2))) as Array<{
              url: string
              title: string
            }>
            // Merge: keep original sources with URLs, replace collapsed ones with expanded
            const withUrl = sources.filter((s) => s.url)
            const seenUrls = new Set(withUrl.map((s) => s.url))
            for (const es of expandedSources) {
              if (es.url && !seenUrls.has(es.url)) {
                withUrl.push(es)
                seenUrls.add(es.url)
              }
            }
            sources = withUrl
          }
        }

        if (sources.length === 0) {
          return textResult('No sources found on the current page.')
        }

        const lines = sources.map((s, i) => {
          const entry = `${i + 1}. ${s.title}`
          return s.url ? `${entry}\n   ${s.url}` : entry
        })
        return textResult(`Sources (${sources.length}):\n\n${lines.join('\n\n')}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 10. comet_list_conversations
  server.tool(
    'comet_list_conversations',
    'List recent conversation links visible on the page.',
    {},
    async () => {
      try {
        await ensureConnected()
        const script = buildListConversationsScript()
        const raw = await client.safeEvaluate(script)
        const conversations = JSON.parse(String(extractValue(raw))) as Array<{
          title: string
          url: string
        }>

        if (conversations.length === 0) {
          return textResult('No conversation links found on the current page.')
        }

        const lines = conversations.map((c, i) => `${i + 1}. ${c.title}\n   ${c.url}`)
        return textResult(`Conversations (${conversations.length}):\n\n${lines.join('\n\n')}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 11. comet_create_owned_target
  server.tool(
    'comet_create_owned_target',
    'Create and bind an explicit background MCP-owned tab without modifying existing tabs.',
    {},
    async () => {
      try {
        const result = await client.createOwnedTarget()
        const originals = result.originalTargets
          .map((target) => `${target.id} ${target.url}`)
          .join('\n')
        return textResult(
          'Owned target created and bound: ' +
            result.targetId +
            ' (background=true). Existing target URLs verified unchanged:\n' +
            originals,
        )
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 12. comet_open_owned_conversation
  server.tool(
    'comet_open_owned_conversation',
    'Open a Perplexity conversation only in the exact target returned by comet_create_owned_target.',
    openOwnedConversationShape,
    async ({ targetId, url }) => {
      try {
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          return toMcpError(new Error(`Invalid URL: "${url}"`))
        }
        if (parsed.protocol !== 'https:' || !isPerplexityDomain(parsed.hostname)) {
          return toMcpError(
            new Error(`Invalid URL: must be a https://perplexity.ai/ URL, got "${url}"`),
          )
        }
        await client.navigateOwnedTarget(targetId, url)
        clearQuestionBinding()
        return textResult(`Navigated owned target [${targetId}] to: ${url}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 13. comet_open_conversation
  server.tool(
    'comet_open_conversation',
    'Navigate to a specific conversation URL.',
    openConversationShape,
    async ({ url }) => {
      try {
        await ensureConnected()
        let parsed: URL
        try {
          parsed = new URL(url)
        } catch {
          return toMcpError(new Error(`Invalid URL: "${url}"`))
        }
        if (parsed.protocol !== 'https:' || !isPerplexityDomain(parsed.hostname)) {
          return toMcpError(
            new Error(`Invalid URL: must be a https://perplexity.ai/ URL, got "${url}"`),
          )
        }
        await client.navigate(url)
        clearQuestionBinding()
        return textResult(`Navigated to: ${url}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 12. comet_get_page_content
  server.tool(
    'comet_get_page_content',
    'Extract the current page content (title and body text) up to a maximum length.',
    getPageContentShape,
    async ({ maxLength }) => {
      try {
        await ensureConnected()
        const len = maxLength ?? 10000
        const raw = await client.safeEvaluate(buildExtractPageContentScript(len))
        const parsed = JSON.parse(String(extractValue(raw))) as { title: string; text: string }
        return textResult(`Title: ${parsed.title}\n\n${parsed.text}`)
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // 13. comet_wait
  server.tool(
    'comet_wait',
    'Poll until the current agent finishes responding and return the full response. Use after comet_ask times out.',
    waitShape,
    async ({ timeout }) => {
      try {
        await ensureConnected()
        const { record, error: loadError } = loadPendingBinding(client.state.port)
        if (loadError) logger.warn(`Pending binding record unreadable: ${loadError}`)
        const url = record && record.epoch !== SERVER_EPOCH ? await currentTargetUrl() : null
        const context = resolveBindingContext({
          pendingQuestion,
          record,
          targetId: client.state.targetId,
          url,
        })
        if (context.origin === 'restart_lost') {
          return textResult(
            `Binding lost after server restart: ${restartLostDiagnostic(context.restartReason, record)} Fail closed: tab content is not attributed to any pending question.`,
          )
        }
        const boundQuestion = context.question
        const effectiveTimeout = timeout ?? 120000
        const startTime = Date.now()
        let lastResponse = ''
        let stableSince = 0
        let lastStatus = 'idle'
        const settleMs = Math.min(12000, Math.max(2000, effectiveTimeout / 3))
        const collectedSteps: string[] = []

        while (Date.now() - startTime < effectiveTimeout) {
          await sleep(config.pollInterval)
          const statusRaw = await client.safeEvaluate(
            buildGetAgentStatusScript(activeSelectors, boundQuestion ?? undefined),
          )
          const status = parseAgentStatus(extractValue(statusRaw))
          if (context.origin === 'rebound' && status.bindingError) {
            return textResult(
              `Binding lost after server restart: rebind validation failed (${status.bindingError}). Fail closed: tab content is not attributed to the rebound question.`,
            )
          }
          if (boundQuestion && !status.response) {
            lastStatus = status.bindingError || 'Waiting for this question to receive an answer'
            stableSince = 0
            continue
          }
          lastStatus = status.status

          for (const step of status.steps) {
            if (!collectedSteps.includes(step)) collectedSteps.push(step)
          }

          if (status.response && status.response !== lastResponse) {
            lastResponse = status.response
            stableSince = 0
          } else if ((status.status === 'completed' || status.status === 'idle') && lastResponse) {
            if (!stableSince) stableSince = Date.now()
          } else {
            stableSince = 0
          }

          if (stableSince && Date.now() - stableSince >= settleMs) {
            const parts: string[] = []
            if (lastResponse) parts.push(lastResponse)
            if (collectedSteps.length > 0) {
              parts.push(`\n\nSteps:\n${collectedSteps.map((s) => `  - ${s}`).join('\n')}`)
            }
            return textResult(parts.join('') || 'Agent completed with no visible response.')
          }
        }

        // Timeout
        const timeoutParts: string[] = [
          lastStatus === 'completed'
            ? 'Response not settled before timeout.'
            : 'Agent is still working after timeout.',
        ]
        if (lastStatus !== 'working' && lastStatus !== 'completed' && lastStatus !== 'idle') {
          timeoutParts.push(`Binding diagnostic: ${lastStatus}`)
        }
        if (collectedSteps.length > 0) {
          timeoutParts.push(`\nSteps so far:\n${collectedSteps.map((s) => `  - ${s}`).join('\n')}`)
        }
        if (lastResponse) timeoutParts.push(`\nPartial response:\n${lastResponse}`)
        return textResult(timeoutParts.join('\n'))
      } catch (err) {
        return toMcpError(err)
      }
    },
  )

  // Connect via stdio
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info('MCP Comet server connected via stdio.')

  // Signal handlers
  const shutdown = async () => {
    logger.info('Shutting down...')
    try {
      await client.disconnect()
    } catch {}
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
