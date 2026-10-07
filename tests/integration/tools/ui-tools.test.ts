import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getHandler, mocks, registerHandlers, resetHarness } from './harness.js'

describe('UI control tool handlers', () => {
  beforeAll(async () => {
    await registerHandlers()
  })

  beforeEach(() => {
    resetHarness()
  })

  describe('comet_screenshot', () => {
    it('returns PNG format by default', async () => {
      mocks.screenshot.mockResolvedValue('base64pngdata')
      const handler = getHandler('comet_screenshot')
      const result = await handler({})

      expect(result.content[0].type).toBe('image')
      expect(result.content[0].mimeType).toBe('image/png')
      expect(result.content[0].data).toBe('base64pngdata')
    })

    it('returns JPEG format when specified', async () => {
      mocks.screenshot.mockResolvedValue('base64jpegdata')
      const handler = getHandler('comet_screenshot')
      const result = await handler({ format: 'jpeg' })

      expect(result.content[0].type).toBe('image')
      expect(result.content[0].mimeType).toBe('image/jpeg')
      expect(result.content[0].data).toBe('base64jpegdata')
    })

    it('returns error response when screenshot fails', async () => {
      mocks.screenshot.mockRejectedValue(new Error('Screenshot failed'))
      const handler = getHandler('comet_screenshot')
      const result = await handler({})

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Screenshot failed')
    })
  })

  describe('comet_mode', () => {
    it('returns current mode via URL detection (non-standard)', async () => {
      mocks.safeEvaluate.mockResolvedValue({ result: { value: 'computer' } })
      const handler = getHandler('comet_mode')
      const result = await handler({})

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Current mode: computer')
    })

    it('returns current mode from the composer chip label', async () => {
      mocks.safeEvaluate
        .mockResolvedValueOnce({ result: { value: 'standard' } })
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              found: true,
              x: 626,
              y: 449,
              label: 'Deep research',
              icx: 924,
              icy: 445,
            }),
          },
        })
      const result = await getHandler('comet_mode')({})

      expect(result.content[0].text).toContain('Current mode: deep-research')
      expect(result.content[0].text).toContain('composer chip: Deep research')
    })

    it('does not mutate the draft while querying an uncertain mode', async () => {
      mocks.safeEvaluate.mockResolvedValue({ result: { value: 'standard' } })
      const handler = getHandler('comet_mode')
      const result = await handler({})

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Current mode: unknown')
      expect(mocks.navigate).not.toHaveBeenCalled()
      expect(mocks.typeChar).not.toHaveBeenCalled()
    }, 15000)

    it('fails closed inside a conversation without navigating or clearing a draft', async () => {
      mocks.safeEvaluate.mockResolvedValue({
        result: {
          value: JSON.stringify({
            url: 'https://www.perplexity.ai/search/conversation-id',
            hasInput: true,
            hasDraft: false,
          }),
        },
      })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })
      expect(result.content[0].text).toContain('conversation mode cannot be safely selected')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('fails closed on a project page that holds an unsent draft', async () => {
      mocks.safeEvaluate.mockResolvedValue({
        result: {
          value: JSON.stringify({
            url: 'https://www.perplexity.ai/projects/project-id',
            hasInput: true,
            hasDraft: true,
          }),
        },
      })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })
      expect(result.content[0].text).toContain('unsent draft')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('switches mode in place on a blank project composer', async () => {
      const chip = { found: true, x: 626, y: 449, label: 'Search', icx: 924, icy: 445 }
      mocks.safeEvaluate
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              url: 'https://www.perplexity.ai/projects/project-id',
              hasInput: true,
              hasDraft: false,
            }),
          },
        })
        .mockResolvedValueOnce({ result: { value: JSON.stringify(chip) } })
        .mockResolvedValueOnce({
          result: { value: JSON.stringify({ clicked: true, label: 'Search' }) },
        })
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({ clicked: true, label: 'Deep research', role: 'menuitemradio' }),
          },
        })
        .mockResolvedValueOnce({
          result: { value: JSON.stringify({ ...chip, label: 'Deep research' }) },
        })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode switched and confirmed: deep-research')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('fails closed on home draft or unreadable preflight', async () => {
      mocks.safeEvaluate.mockResolvedValueOnce({
        result: {
          value: JSON.stringify({
            url: 'https://www.perplexity.ai/',
            hasInput: true,
            hasDraft: true,
          }),
        },
      })
      expect((await getHandler('comet_mode')({ mode: 'deep-research' })).content[0].text).toContain(
        'unsent draft',
      )
      mocks.safeEvaluate.mockResolvedValueOnce({ result: { value: undefined } })
      expect((await getHandler('comet_mode')({ mode: 'deep-research' })).content[0].text).toContain(
        'preflight unavailable',
      )
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('switches mode via pointer sequence and confirms via the chip label', async () => {
      const chip = { found: true, x: 626, y: 449, label: 'Search', icx: 924, icy: 445 }
      mocks.safeEvaluate
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              url: 'https://www.perplexity.ai/',
              hasInput: true,
              hasDraft: false,
            }),
          },
        })
        .mockResolvedValueOnce({ result: { value: JSON.stringify(chip) } })
        .mockResolvedValueOnce({
          result: { value: JSON.stringify({ clicked: true, label: 'Search' }) },
        })
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({ clicked: true, label: 'Deep research', role: 'menuitemradio' }),
          },
        })
        .mockResolvedValueOnce({
          result: { value: JSON.stringify({ ...chip, label: 'Deep research' }) },
        })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode switched and confirmed: deep-research')
      expect(mocks.navigate).not.toHaveBeenCalled()
    })

    it('returns early when the requested mode is already active', async () => {
      mocks.safeEvaluate
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              url: 'https://www.perplexity.ai/',
              hasInput: true,
              hasDraft: false,
            }),
          },
        })
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              found: true,
              x: 626,
              y: 449,
              label: 'Deep research',
              icx: 924,
              icy: 445,
            }),
          },
        })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode already active: deep-research')
    })

    it('fails closed when the composer has no mode chip', async () => {
      mocks.safeEvaluate
        .mockResolvedValueOnce({
          result: {
            value: JSON.stringify({
              url: 'https://www.perplexity.ai/',
              hasInput: true,
              hasDraft: false,
            }),
          },
        })
        .mockResolvedValue({
          result: { value: JSON.stringify({ found: false, reason: 'mode_chip_not_found' }) },
        })
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode switch failed')
      expect(result.content[0].text).toContain('mode chip not found')
    })

    it('reports the precise blocker when the chip click fails', async () => {
      const preflight = {
        result: {
          value: JSON.stringify({
            url: 'https://www.perplexity.ai/',
            hasInput: true,
            hasDraft: false,
          }),
        },
      }
      const chip = {
        result: {
          value: JSON.stringify({
            found: true,
            x: 626,
            y: 449,
            label: 'Search',
            icx: 924,
            icy: 445,
          }),
        },
      }
      const clickFailed = { result: { value: JSON.stringify({ clicked: false }) } }
      mocks.safeEvaluate
        .mockResolvedValueOnce(preflight)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(clickFailed)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(clickFailed)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(clickFailed)
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode switch failed')
      expect(result.content[0].text).toContain('mode chip click failed')
    }, 15000)

    it('reports the precise blocker when the menu lacks the mode item', async () => {
      const preflight = {
        result: {
          value: JSON.stringify({
            url: 'https://www.perplexity.ai/',
            hasInput: true,
            hasDraft: false,
          }),
        },
      }
      const chip = {
        result: {
          value: JSON.stringify({
            found: true,
            x: 626,
            y: 449,
            label: 'Search',
            icx: 924,
            icy: 445,
          }),
        },
      }
      const chipClick = { result: { value: JSON.stringify({ clicked: true, label: 'Search' }) } }
      const missing = { result: { value: JSON.stringify({ clicked: false, menuOpen: true }) } }
      mocks.safeEvaluate
        .mockResolvedValueOnce(preflight)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(chipClick)
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(chipClick)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(chipClick)
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(chipClick)
        .mockResolvedValueOnce(chip)
        .mockResolvedValueOnce(chipClick)
        .mockResolvedValueOnce(missing)
        .mockResolvedValueOnce(chipClick)
      const result = await getHandler('comet_mode')({ mode: 'deep-research' })

      expect(result.content[0].text).toContain('Mode switch failed')
      expect(result.content[0].text).toContain("mode menu did not contain a 'deep-research' item")
    }, 20000)

    it('returns error response when safeEvaluate fails', async () => {
      mocks.safeEvaluate.mockRejectedValue(new Error('Evaluate failed'))
      const handler = getHandler('comet_mode')
      const result = await handler({})

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Evaluate failed')
    })
  })

  describe('comet_list_tabs', () => {
    it('returns categorized tabs', async () => {
      mocks.listTabsCategorized.mockResolvedValue({
        main: [
          { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
        ],
        sidecar: [{ id: 'target-2', url: 'https://example.com', type: 'page', title: 'Sidecar' }],
        agentBrowsing: [],
        overlay: [],
        others: [],
      })
      const handler = getHandler('comet_list_tabs')
      const result = await handler({})

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Main')
      expect(result.content[0].text).toContain('Perplexity')
    })

    it('returns no tabs message when all categories empty', async () => {
      mocks.listTabsCategorized.mockResolvedValue({
        main: [],
        sidecar: [],
        agentBrowsing: [],
        overlay: [],
        others: [],
      })
      const handler = getHandler('comet_list_tabs')
      const result = await handler({})

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('No tabs found')
    })

    it('returns error response when listTabsCategorized fails', async () => {
      mocks.listTabsCategorized.mockRejectedValue(new Error('List failed'))
      const handler = getHandler('comet_list_tabs')
      const result = await handler({})

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('List failed')
    })
  })

  describe('comet_open_conversation', () => {
    it('rejects domain suffix attack', async () => {
      const handler = getHandler('comet_open_conversation')
      const result = await handler({ url: 'https://perplexity.ai.evil.com/search/123' })
      expect(result.content[0].text).toContain('Error')
    })

    it('rejects path-based bypass', async () => {
      const handler = getHandler('comet_open_conversation')
      const result = await handler({ url: 'https://evil.com/perplexity.ai/' })
      expect(result.content[0].text).toContain('Error')
    })

    it('rejects credential-based URL confusion', async () => {
      const handler = getHandler('comet_open_conversation')
      const result = await handler({ url: 'https://perplexity.ai@evil.com/' })
      expect(result.content[0].text).toContain('Error')
    })

    it('rejects evilperplexity.ai domain suffix attack', async () => {
      const handler = getHandler('comet_open_conversation')
      const result = await handler({ url: 'https://evilperplexity.ai/search/123' })
      expect(result.content[0].text).toContain('Error')
    })

    it('accepts valid perplexity.ai URL', async () => {
      mocks.navigate.mockResolvedValue(undefined)
      const handler = getHandler('comet_open_conversation')
      const result = await handler({ url: 'https://www.perplexity.ai/search/abc123' })
      expect(result.content[0].text).toContain('Navigated to:')
    })
  })

  describe('comet_switch_tab', () => {
    it('switches by tabId', async () => {
      mocks.listTargets.mockResolvedValue([
        { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
        { id: 'target-2', url: 'https://example.com', type: 'page', title: 'Example' },
      ])
      mocks.disconnect.mockResolvedValue(undefined)
      mocks.connect.mockResolvedValue('target-1')
      const handler = getHandler('comet_switch_tab')
      const result = await handler({ tabId: 'target-1' })

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Switched to tab')
      expect(result.content[0].text).toContain('Perplexity')
    })

    it('switches by title', async () => {
      mocks.listTargets.mockResolvedValue([
        { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
        { id: 'target-2', url: 'https://example.com', type: 'page', title: 'Example' },
      ])
      mocks.disconnect.mockResolvedValue(undefined)
      mocks.connect.mockResolvedValue('target-1')
      const handler = getHandler('comet_switch_tab')
      const result = await handler({ title: 'Perplexity' })

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Switched to tab')
    })

    it('returns tab not found for nonexistent tabId', async () => {
      mocks.listTargets.mockResolvedValue([
        { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
      ])
      const handler = getHandler('comet_switch_tab')
      const result = await handler({ tabId: 'nonexistent' })

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Tab not found')
    })

    it('returns tab not found when no criteria provided', async () => {
      mocks.listTargets.mockResolvedValue([
        { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
      ])
      const handler = getHandler('comet_switch_tab')
      const result = await handler({})

      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Tab not found')
    })

    it('returns error response when connect fails', async () => {
      mocks.listTargets.mockResolvedValue([
        { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
      ])
      mocks.disconnect.mockResolvedValue(undefined)
      mocks.connect.mockRejectedValue(new Error('Connect failed'))
      const handler = getHandler('comet_switch_tab')
      const result = await handler({ tabId: 'target-1' })

      expect(result.isError).toBe(true)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('Connect failed')
    })
  })

  describe('auto-connect', () => {
    it('auto-connects when no targetId set for comet_list_tabs', async () => {
      mocks.state.targetId = null
      mocks.launchOrConnect.mockResolvedValue('target-1')
      mocks.closeExtraTabs.mockResolvedValue(undefined)
      mocks.listTabsCategorized.mockResolvedValue({
        main: [
          { id: 'target-1', url: 'https://www.perplexity.ai', type: 'page', title: 'Perplexity' },
        ],
        sidecar: [],
        agentBrowsing: [],
        overlay: [],
        others: [],
      })
      const handler = getHandler('comet_list_tabs')
      const result = await handler({})
      expect(mocks.launchOrConnect).toHaveBeenCalled()
      expect(result.content[0].text).toContain('Main')
    })
  })
})
