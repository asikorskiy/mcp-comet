import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getHandler, mocks, registerHandlers, resetHarness } from './harness.js'

describe('owned target tools', () => {
  beforeAll(async () => {
    await registerHandlers()
  })

  beforeEach(() => {
    resetHarness()
  })

  it('reports explicit ownership and the unchanged original URLs', async () => {
    mocks.createOwnedTarget.mockResolvedValue({
      targetId: 'owned-42',
      originalTargets: [
        {
          id: 'owner-1',
          type: 'page',
          title: 'Owner draft',
          url: 'https://www.perplexity.ai/search/owner',
        },
      ],
    })

    const result = await getHandler('comet_create_owned_target')({})

    expect(mocks.createOwnedTarget).toHaveBeenCalledOnce()
    expect(result.content[0].text).toContain('owned-42')
    expect(result.content[0].text).toContain('owner-1 https://www.perplexity.ai/search/owner')
  })

  it('navigates only the supplied owned target', async () => {
    const url = 'https://www.perplexity.ai/search/745f1bec-c52c-4875-b973-a4eb207b8806'

    const result = await getHandler('comet_open_owned_conversation')({ targetId: 'owned-42', url })

    expect(mocks.navigateOwnedTarget).toHaveBeenCalledWith('owned-42', url)
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(result.content[0].text).toContain('owned-42')
  })

  it('rejects a non-Perplexity URL before navigating any target', async () => {
    const result = await getHandler('comet_open_owned_conversation')({
      targetId: 'owned-42',
      url: 'https://evilperplexity.ai/search/x',
    })

    expect(mocks.navigateOwnedTarget).not.toHaveBeenCalled()
    expect(result.isError).toBe(true)
  })
})
