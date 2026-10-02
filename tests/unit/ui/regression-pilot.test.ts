import { describe, expect, it } from 'vitest'
import { buildFindProseJS } from '../../../src/prose-filter.js'
import { buildExtractSourcesScript } from '../../../src/ui/extraction.js'
import { buildModeSwitchScript } from '../../../src/ui/navigation.js'
import { buildGetAgentStatusScript } from '../../../src/ui/status.js'

function evaluate(script: string, documentStub: object): any {
  return Function('document', `return ${script}`)(documentStub)
}

describe('Comet browser regressions', () => {
  it('does not misread Expand pane as an active Stop button', () => {
    const root: any = {
      tagName: 'DIV',
      classList: { contains: (name: string) => name === 'prose' },
      parentElement: { tagName: 'MAIN', parentElement: null, classList: { contains: () => false } },
      innerText: 'Headline\nSupported fact',
      cloneNode: () => ({ querySelectorAll: () => [] }),
    }
    const nested: any = {
      tagName: 'LI',
      classList: { contains: () => false },
      parentElement: root,
      innerText: 'Supported fact',
      cloneNode: () => ({ querySelectorAll: () => [] }),
    }
    const expand = {
      getAttribute: (name: string) => (name === 'aria-label' ? 'Expand pane' : null),
      querySelector: () => ({ tagName: 'rect' }),
    }
    const doc = {
      body: { innerText: 'Searching is mentioned in an old completed answer' },
      querySelector: () => null,
      querySelectorAll: (selector: string) => {
        if (selector === 'button') return [expand]
        if (selector.includes('prose')) return [root, nested]
        return []
      },
    }
    const status = JSON.parse(evaluate(buildGetAgentStatusScript(), doc))
    expect(status.status).toBe('completed')
    expect(status.hasStopButton).toBe(false)
    expect(status.response).toBe('Headline\nSupported fact')
    expect(status.proseCount).toBe(1)
    expect(buildFindProseJS()).toContain("parent.classList?.contains('prose')")
  })

  it('preserves answers over 8000 chars and labels oversized responses', () => {
    const root = {
      tagName: 'DIV',
      classList: { contains: (name: string) => name === 'prose' },
      parentElement: { tagName: 'MAIN', parentElement: null, classList: { contains: () => false } },
      innerText: 'x'.repeat(12000),
      cloneNode: () => ({ querySelectorAll: () => [] }),
    }
    const doc = {
      body: { innerText: '' },
      querySelector: () => null,
      querySelectorAll: (selector: string) => (selector.includes('prose') ? [root] : []),
    }
    const script = buildGetAgentStatusScript()
    expect(JSON.parse(evaluate(script, doc)).response.length).toBe(12000)
    root.innerText = 'y'.repeat(52000)
    const capped = JSON.parse(evaluate(script, doc)).response
    expect(capped).toContain('[MCP response truncated at 48000 chars]')
    expect(capped.length).toBeGreaterThan(48000)
  })

  it('extracts citation data URLs including official Perplexity blog pages', () => {
    const url = 'https://www.perplexity.ai/hub/blog/introducing-comet'
    const citation: any = {
      className: 'citation inline',
      innerText: 'perplexity',
      attributes: [{ value: '' }, { value: url }],
      parentElement: { closest: () => null },
      closest: () => null,
      querySelector: () => null,
    }
    const nested: any = { ...citation, parentElement: { closest: () => citation } }
    const doc = {
      querySelectorAll: (selector: string) =>
        selector.includes('citation') ? [citation, nested] : [],
    }
    const sources = JSON.parse(evaluate(buildExtractSourcesScript(), doc))
    expect(sources).toEqual([{ url, title: 'perplexity' }])
  })

  it('reads ordinary source links from a project answer', () => {
    const url = 'https://arxiv.org/abs/2406.18665'
    const anchor = { href: url, innerText: 'RouteLLM paper' }
    const doc = {
      querySelectorAll: (selector: string) => (selector.includes('main [class*') ? [anchor] : []),
    }
    expect(JSON.parse(evaluate(buildExtractSourcesScript(), doc))).toEqual([
      { url, title: 'RouteLLM paper' },
    ])
  })

  it('falls back to a visible mode label when an SVG identifier changes', () => {
    let clicked = false
    const item = {
      className: '',
      textContent: 'Deep research',
      querySelectorAll: () => [],
      click: () => {
        clicked = true
      },
    }
    const doc = {
      querySelector: () => ({ role: 'listbox' }),
      querySelectorAll: () => [item],
    }
    expect(evaluate(buildModeSwitchScript('deep-research'), doc)).toBe('clicked:deep research')
    expect(clicked).toBe(true)
  })
})
