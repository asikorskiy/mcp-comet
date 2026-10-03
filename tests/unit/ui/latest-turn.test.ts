import { describe, expect, it } from 'vitest'
import { buildGetAgentStatusScript } from '../../../src/ui/status.js'

function conversation(turns: Array<{ question?: string; answer?: string }>) {
  const nodes: any[] = []
  const prose: any[] = []
  for (const turn of turns) {
    const node: any = {
      innerText: turn.question ?? turn.answer,
      querySelector: () => (turn.answer ? {} : null),
      compareDocumentPosition(other: any) {
        return nodes.indexOf(other) > nodes.indexOf(this) ? 4 : 2
      },
    }
    nodes.push(node)
    if (turn.answer) {
      prose.push({
        innerText: turn.answer,
        parentElement: {
          tagName: 'MAIN',
          classList: { contains: () => false },
          parentElement: null,
        },
        cloneNode: () => ({ querySelectorAll: () => [] }),
        closest: () => node,
      })
    }
  }
  return {
    body: { innerText: '' },
    querySelector: () => null,
    querySelectorAll: (selector: string) => {
      if (selector === 'main [data-renderer="lm"]') return nodes
      if (selector === 'button') return []
      if (selector.includes('prose')) return prose
      return []
    },
  }
}

function status(turns: Array<{ question?: string; answer?: string }>, pending: string) {
  const script = buildGetAgentStatusScript(undefined, pending)
  return JSON.parse(Function('document', `return ${script}`)(conversation(turns)))
}

describe('latest question answer binding', () => {
  it('rejects the old answer while the latest question has no answer', () => {
    const state = status(
      [{ question: 'Old?' }, { answer: 'Old answer body' }, { question: 'New?' }],
      'New?',
    )
    expect(state.response).toBe('')
    expect(state.status).toBe('idle')
  })

  it('accepts a new answer despite same prose count after DOM container reuse', () => {
    const state = status(
      [{ question: 'Old?' }, { question: 'New?' }, { answer: 'New answer body' }],
      'New?',
    )
    expect(state.proseCount).toBe(1)
    expect(state.status).toBe('completed')
    expect(state.response).toBe('New answer body')
  })

  it('fails closed when the submitted question is not the latest turn', () => {
    const state = status(
      [{ question: 'Old?' }, { answer: 'Old answer body' }, { question: 'Other?' }],
      'New?',
    )
    expect(state.response).toBe('')
    expect(state.bindingError).toMatch(/Submitted question not found/)
  })
})
