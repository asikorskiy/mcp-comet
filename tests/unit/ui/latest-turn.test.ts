import { describe, expect, it } from 'vitest'
import { buildGetAgentStatusScript } from '../../../src/ui/status.js'

function conversation(turns: Array<{ question?: string; answer?: string }>) {
  const nodes: any[] = []
  const prose: any[] = []
  for (const turn of turns) {
    const node: any = {
      innerText: turn.question ?? turn.answer,
      matches: () => Boolean(turn.answer),
      querySelector: () => null,
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

  it('binds the latest long question when rich-text links change rendered text', () => {
    const prefix = 'D2 QA-1647: narrow follow-up on the previous answer; retain this same project. '
    const submitted = prefix + 'Read [the original](https://example.org/article) and explain.'
    const rendered = prefix + 'Read the original and explain.'
    const state = status(
      [
        { question: 'Earlier question' },
        { answer: 'Earlier answer' },
        { question: rendered },
        { answer: 'Actual D2 response' },
      ],
      submitted,
    )
    expect(state.status).toBe('completed')
    expect(state.response).toBe('Actual D2 response')
    expect(state.bindingError).toBe('')
  })

  it('ignores duplicate rendered question text and identifies root prose as answer', () => {
    const prompt =
      'QA-OPS-1706 unique binding verification in this same D2 project conversation. Do not research or change project context.'
    const state = status(
      [{ question: prompt + prompt }, { answer: 'QA-OPS-1706 confirmed.' }],
      prompt,
    )
    expect(state.status).toBe('completed')
    expect(state.response).toBe('QA-OPS-1706 confirmed.')
  })

  it('does not bind an old answer when the new rich-text question has no answer', () => {
    const prefix = 'D2 QA-1647: narrow follow-up on the previous answer; retain this same project. '
    const state = status(
      [
        { question: 'Earlier question' },
        { answer: 'Earlier answer' },
        { question: prefix + 'Read the original.' },
      ],
      prefix + 'Read [the original](https://example.org/article).',
    )
    expect(state.response).toBe('')
    expect(state.status).toBe('idle')
  })

  it('fails closed for repeated question prefixes rather than returning an old answer', () => {
    const prefix = 'D2 QA-1647: narrow follow-up on the previous answer; retain this same project. '
    const state = status(
      [
        { question: prefix + 'old' },
        { answer: 'Old answer' },
        { question: prefix + 'new' },
        { answer: 'New answer' },
      ],
      prefix + 'new [link](https://example.org)',
    )
    expect(state.response).toBe('')
    expect(state.bindingError).toMatch(/Ambiguous/)
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
