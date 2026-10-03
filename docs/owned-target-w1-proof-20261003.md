# Owned-target W1 browser proof — 2026-10-03

Commit: 07edf523bd38619d89671d078717d5fc61fe599b
Scope: read-only Comet CDP verification after owner-research browser lease release.

## Isolation
- Created a fresh background CDP target and bound it as MCP-owned: 35785351A9C0376BD880370A49777FF7.
- Navigated only that target to the supplied W1 conversation URL.
- Pre-existing target URLs compared before/after: unchanged (true).
- No target was closed, cleared, activated, or otherwise cleaned up.

## Artifact read
- Page title: Researcher sandbox SHADOW BACKTEST #W1, standard mode. One weekly single-brief...
- Visible document.body.innerText length: 28,439 characters.
- Returned head and tail, plus nine public load-bearing source URLs, in the live smoke output. Raw head/tail are intentionally not copied here: they include project/navigation material outside the requested artifact.
- A second read-only target and DOM search found no element containing the local baseline unique W1 phrase. Therefore there is no verified stable answer-container selector and no claim that the 28,439-character page body is the exact standalone W1 artifact.

## Result
Isolation and target ownership: passed. Artifact conversation/title/source-bearing page read: passed. Exact full artifact extraction: partial — Comet exposes a mixed visible page body, while the local baseline is a comparison rather than a DOM selector contract. Smallest safe next step is selector discovery/validation against a non-project answer container; do not mutate this project conversation or its settings.
