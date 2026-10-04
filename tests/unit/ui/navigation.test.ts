import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildModeChipClickScript,
  buildModeChipScript,
  buildModeMenuItemClickScript,
  buildModeMenuItemScript,
  buildModeSwitchScript,
  buildNewChatScript,
  buildReadActiveModeScript,
  buildSubmitPromptScript,
  chipLabelToMode,
} from '../../../src/ui/navigation.js'

describe('buildSubmitPromptScript', () => {
  it('clicks an enabled submit button instead of a synthetic Enter', () => {
    const script = buildSubmitPromptScript()
    expect(script).toContain('aria-label="Submit"')
    expect(script).not.toContain('KeyboardEvent')
    let clicked = false
    const doc = {
      querySelector: (selector: string) =>
        selector === '#ask-input'
          ? { innerText: 'A question' }
          : selector.includes('Submit')
            ? {
                disabled: false,
                click: () => {
                  clicked = true
                },
              }
            : null,
    }
    const result = Function('document', `return ${script}`)(doc)
    expect(result).toBe('clicked_submit')
    expect(clicked).toBe(true)
  })

  it('fails closed on an empty composer', () => {
    const doc = {
      querySelector: (selector: string) => (selector === '#ask-input' ? { innerText: '' } : null),
    }
    expect(Function('document', `return ${buildSubmitPromptScript()}`)(doc)).toBe('empty_input')
  })
})

describe('buildModeSwitchScript', () => {
  it('uses icon-based matching for deep-research', () => {
    const s = buildModeSwitchScript('deep-research')
    expect(s).toContain('#pplx-icon-telescope')
    expect(s).toContain('[role="listbox"]')
    expect(s).toContain('[role="menuitem"]')
    expect(s).toContain('xlink:href')
  })

  it('uses icon-based matching for computer', () => {
    const s = buildModeSwitchScript('computer')
    expect(s).toContain('#pplx-icon-click')
    expect(s).toContain('[role="menuitem"]')
  })

  it('handles create mode with computer icon', () => {
    const s = buildModeSwitchScript('create')
    expect(s).toContain('#pplx-icon-custom-computer')
  })

  it('handles learn mode with book icon', () => {
    const s = buildModeSwitchScript('learn')
    expect(s).toContain('#pplx-icon-book')
  })

  it('handles review mode with file-check icon', () => {
    const s = buildModeSwitchScript('review')
    expect(s).toContain('#pplx-icon-file-check')
  })

  it('returns no_action for standard mode', () => {
    const s = buildModeSwitchScript('standard')
    expect(s).toContain('standard_mode_no_action')
  })

  it('skips shortcut-typeahead-option items', () => {
    const s = buildModeSwitchScript('deep-research')
    expect(s).toContain('shortcut-typeahead-option')
  })

  it('returns no_listbox_found when listbox missing', () => {
    const s = buildModeSwitchScript('deep-research')
    expect(s).toContain('no_listbox_found')
  })

  it('returns a synchronous IIFE', () => {
    const s = buildModeSwitchScript('deep-research')
    expect(s).toMatch(/^\(function\(\)\s*\{[\s\S]*\}\)\(\)$/)
  })

  it('does not use setTimeout', () => {
    const s = buildModeSwitchScript('deep-research')
    expect(s).not.toContain('setTimeout')
  })

  it('uses fallback icon for unknown mode', () => {
    const s = buildModeSwitchScript('unknown-custom-mode')
    expect(s).toContain('#pplx-icon-unknown-custom-mode')
  })
})

describe('buildModeSwitchScript injection safety', () => {
  it('escapes special characters in mode icon href', () => {
    // Use an unknown mode with special chars — it gets the #pplx-icon- prefix
    const malicious = "test';alert(1);//"
    const script = buildModeSwitchScript(malicious)
    const expected = JSON.stringify(`#pplx-icon-${malicious}`)
    expect(script).toContain(`var iconHref = ${expected};`)
    // Verify JSON round-trip is safe
    expect(JSON.parse(expected)).toBe(`#pplx-icon-${malicious}`)
  })
})

describe('buildNewChatScript', () => {
  it('navigates to perplexity.ai', () => {
    const s = buildNewChatScript()
    expect(s).toContain('perplexity.ai')
  })
})

describe('buildReadActiveModeScript', () => {
  it('returns a synchronous IIFE', () => {
    const s = buildReadActiveModeScript()
    expect(s).toMatch(/^\(function\(\)\s*\{[\s\S]*\}\)\(\)$/)
  })

  it('detects computer mode from /copilot/ URL', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('/copilot/')
    expect(s).toContain("return 'computer'")
  })

  it('detects computer mode from /computer/tasks/ URL', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('/computer/tasks/')
  })

  it('looks for bg-subtle class on menuitems', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('.bg-subtle')
  })

  it('maps telescope icon to deep-research', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('#pplx-icon-telescope')
    expect(s).toContain('"deep-research"')
  })

  it('maps gavel icon to model-council', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('#pplx-icon-gavel')
    expect(s).toContain('"model-council"')
  })

  it('maps book icon to learn', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('#pplx-icon-book')
    expect(s).toContain('"learn"')
  })

  it('maps file-check icon to review', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('#pplx-icon-file-check')
    expect(s).toContain('"review"')
  })

  it('maps click icon to computer', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('#pplx-icon-click')
  })

  it('skips shortcut-typeahead-option items', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain('shortcut-typeahead-option')
  })

  it('returns standard as default fallback', () => {
    const s = buildReadActiveModeScript()
    expect(s).toContain("return 'standard'")
  })

  it('does not use setTimeout', () => {
    const s = buildReadActiveModeScript()
    expect(s).not.toContain('setTimeout')
  })
})

describe('chipLabelToMode', () => {
  it('maps chip labels back to internal modes', () => {
    expect(chipLabelToMode('Search')).toBe('standard')
    expect(chipLabelToMode('Deep research')).toBe('deep-research')
    expect(chipLabelToMode('Model council')).toBe('model-council')
    expect(chipLabelToMode('Learn step by step')).toBe('learn')
    expect(chipLabelToMode('Computer')).toBe('computer')
  })

  it('does not map deep research to standard via the search substring', () => {
    expect(chipLabelToMode('deep research')).toBe('deep-research')
    expect(chipLabelToMode('')).toBeNull()
    expect(chipLabelToMode('Something else')).toBeNull()
  })
})

describe('buildModeChipScript', () => {
  const makeEl = (attrs, text, rect) => ({
    getAttribute: (name) => (attrs[name] === undefined ? null : attrs[name]),
    textContent: text,
    getBoundingClientRect: () => rect,
  })
  const input = { getBoundingClientRect: () => ({ x: 600, y: 400, width: 620, height: 90 }) }

  it('finds the first unlabeled text button aligned with the composer', () => {
    const doc = {
      querySelector: (sel) => (sel === '#ask-input' ? input : null),
      querySelectorAll: () => [
        makeEl({ 'aria-label': 'Add files or tools' }, '', {
          x: 500,
          y: 445,
          width: 100,
          height: 40,
        }),
        makeEl({}, 'Search', { x: 580, y: 445, width: 92, height: 40 }),
        makeEl({}, 'Computer', { x: 700, y: 445, width: 120, height: 40 }),
      ],
    }
    const chip = JSON.parse(Function('document', `return ${buildModeChipScript()}`)(doc))
    expect(chip.found).toBe(true)
    expect(chip.label).toBe('Search')
    expect(chip.icx).toBe(910)
    expect(chip.icy).toBe(445)
  })

  it('skips labeled, popup, empty, and misaligned buttons', () => {
    const doc = {
      querySelector: (sel) => (sel === '#ask-input' ? input : null),
      querySelectorAll: () => [
        makeEl({ 'aria-label': 'Claude Sonnet 5.5', 'aria-haspopup': 'menu' }, 'Sonnet 5.5', {
          x: 900,
          y: 445,
          width: 120,
          height: 40,
        }),
        makeEl({}, '', { x: 600, y: 445, width: 50, height: 40 }),
        makeEl({}, 'Far away', { x: 100, y: 1200, width: 80, height: 40 }),
      ],
    }
    const chip = JSON.parse(Function('document', `return ${buildModeChipScript()}`)(doc))
    expect(chip.found).toBe(false)
  })

  it('reports a missing composer', () => {
    const doc = { querySelector: () => null, querySelectorAll: () => [] }
    const chip = JSON.parse(Function('document', `return ${buildModeChipScript()}`)(doc))
    expect(chip.found).toBe(false)
  })
})

describe('buildModeMenuItemScript', () => {
  const item = (opts) => ({
    className: opts.cls || '',
    textContent: opts.text,
    getAttribute: (n) => (n === 'role' ? opts.role || null : null),
    getBoundingClientRect: () => ({
      x: 700,
      y: 500,
      width: opts.rect ? opts.rect.width : 160,
      height: opts.rect ? opts.rect.height : 40,
    }),
    querySelectorAll: (sel) =>
      sel === 'use' && opts.uses
        ? opts.uses.map((href) => ({ getAttribute: (n) => (n === 'xlink:href' ? href : null) }))
        : [],
  })

  it('matches the deep research menuitemradio by label', () => {
    const doc = {
      querySelectorAll: (sel) =>
        sel.includes('menuitemradio')
          ? [
              item({ cls: 'shortcut-typeahead-option', text: 'Deep research' }),
              item({ text: 'Search' }),
              item({ text: 'Deep research', role: 'menuitemradio' }),
            ]
          : [],
    }
    const found = JSON.parse(
      Function('document', `return ${buildModeMenuItemScript('deep-research')}`)(doc),
    )
    expect(found.found).toBe(true)
    expect(found.role).toBe('menuitemradio')
    expect(found.label).toBe('Deep research')
  })

  it('matches by icon href when the label differs', () => {
    const doc = {
      querySelectorAll: (sel) =>
        sel.includes('menuitemradio')
          ? [
              item({
                text: 'Research deeply',
                role: 'menuitemradio',
                uses: ['#pplx-icon-telescope'],
              }),
            ]
          : [],
    }
    const found = JSON.parse(
      Function('document', `return ${buildModeMenuItemScript('deep-research')}`)(doc),
    )
    expect(found.found).toBe(true)
  })

  it('skips hidden items and reports a miss', () => {
    const doc = {
      querySelectorAll: (sel) =>
        sel.includes('menuitemradio')
          ? [
              item({ text: 'Deep research', rect: { width: 0, height: 0 } }),
              item({ text: 'Search' }),
            ]
          : [],
    }
    const found = JSON.parse(
      Function('document', `return ${buildModeMenuItemScript('deep-research')}`)(doc),
    )
    expect(found.found).toBe(false)
  })
})

describe('buildModeChipClickScript', () => {
  class FakeEvent {
    type: string
    constructor(type: string, init?: Record<string, unknown>) {
      this.type = type
      if (init) Object.assign(this, init as object)
    }
  }
  const makeEl = (
    attrs: Record<string, string | null>,
    text: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => {
    const events: string[] = []
    return {
      events,
      getAttribute: (name: string) => (attrs[name] === undefined ? null : attrs[name]),
      textContent: text,
      getBoundingClientRect: () => rect,
      dispatchEvent: (e: { type: string }) => {
        events.push(e.type)
        return true
      },
    }
  }
  const input = { getBoundingClientRect: () => ({ x: 600, y: 400, width: 620, height: 90 }) }

  beforeEach(() => {
    vi.stubGlobal('PointerEvent', FakeEvent)
    vi.stubGlobal('MouseEvent', FakeEvent)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dispatches a full pointer sequence on the mode chip', () => {
    const chipEl = makeEl({}, 'Search', { x: 580, y: 445, width: 92, height: 40 })
    const doc = {
      querySelector: (sel: string) => (sel === '#ask-input' ? input : null),
      querySelectorAll: () => [
        makeEl({ 'aria-label': 'Add files or tools' }, '', {
          x: 500,
          y: 445,
          width: 100,
          height: 40,
        }),
        chipEl,
      ],
    }
    const out = JSON.parse(Function('document', `return ${buildModeChipClickScript()}`)(doc))
    expect(out.clicked).toBe(true)
    expect(out.label).toBe('Search')
    expect(chipEl.events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })

  it('reports a missing chip without dispatching', () => {
    const doc = {
      querySelector: (sel: string) => (sel === '#ask-input' ? input : null),
      querySelectorAll: () => [
        makeEl({ 'aria-label': 'Search' }, 'Search', { x: 580, y: 445, width: 92, height: 40 }),
      ],
    }
    const out = JSON.parse(Function('document', `return ${buildModeChipClickScript()}`)(doc))
    expect(out.clicked).toBe(false)
    expect(out.reason).toBe('mode_chip_not_found')
  })
})

describe('buildModeMenuItemClickScript', () => {
  class FakeEvent {
    type: string
    constructor(type: string, init?: Record<string, unknown>) {
      this.type = type
      if (init) Object.assign(this, init as object)
    }
  }
  const item = (opts: {
    text: string
    role?: string
    rect?: { width: number; height: number }
    cls?: string
  }) => {
    const events: string[] = []
    return {
      events,
      className: opts.cls || '',
      textContent: opts.text,
      getAttribute: (n: string) => (n === 'role' ? opts.role || null : null),
      getBoundingClientRect: () => ({
        x: 700,
        y: 500,
        width: opts.rect ? opts.rect.width : 160,
        height: opts.rect ? opts.rect.height : 40,
      }),
      querySelectorAll: () => [],
      dispatchEvent: (e: { type: string }) => {
        events.push(e.type)
        return true
      },
    }
  }

  beforeEach(() => {
    vi.stubGlobal('PointerEvent', FakeEvent)
    vi.stubGlobal('MouseEvent', FakeEvent)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dispatches a full pointer sequence on the deep research item', () => {
    const dr = item({ text: 'Deep research', role: 'menuitemradio' })
    const doc = {
      querySelectorAll: (sel: string) =>
        sel.includes('menuitemradio') ? [item({ text: 'Search', role: 'menuitemradio' }), dr] : [],
    }
    const out = JSON.parse(
      Function('document', `return ${buildModeMenuItemClickScript('deep-research')}`)(doc),
    )
    expect(out.clicked).toBe(true)
    expect(out.label).toBe('Deep research')
    expect(out.role).toBe('menuitemradio')
    expect(dr.events).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'])
  })

  it('reports an open menu without the target item', () => {
    const doc = {
      querySelectorAll: (sel: string) =>
        sel.includes('menuitemradio') ? [item({ text: 'Search', role: 'menuitemradio' })] : [],
    }
    const out = JSON.parse(
      Function('document', `return ${buildModeMenuItemClickScript('deep-research')}`)(doc),
    )
    expect(out.clicked).toBe(false)
    expect(out.menuOpen).toBe(true)
  })

  it('reports a closed menu when nothing is visible', () => {
    const doc = {
      querySelectorAll: (sel: string) =>
        sel.includes('menuitemradio')
          ? [item({ text: 'Deep research', rect: { width: 0, height: 0 } })]
          : [],
    }
    const out = JSON.parse(
      Function('document', `return ${buildModeMenuItemClickScript('deep-research')}`)(doc),
    )
    expect(out.clicked).toBe(false)
    expect(out.menuOpen).toBe(false)
  })
})
