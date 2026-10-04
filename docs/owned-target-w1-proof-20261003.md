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

## Scoped artifact completion — 2026-10-04
- A later fresh owned target FF8135F125AC2BBC3E20B4B49C829F6A again preserved every pre-existing target URL (before/after invariant true) and was the only target navigated to W1.
- The scoped main element, rather than document.body, produced the artifact dialogue: title matched W1; totalCharacters=4925, returnedCharacters=4925, truncated=false. Its head begins with the W1 prompt and its tail ends with the cited answer/source portion; the live command emitted both values.
- main-scoped public load-bearing source URLs: Digiday OpenAI click-to-chat; Digiday retail-media talent; Digiday Google publisher licensing; Digiday Reuters paywall; Meta One; OpenAI model-misalignment framework; RBC economy; Pew news censorship; IAB ad-spend forecast.
- Mode safety read: W1 URL and 28,439-character page body were identical before/after mode preflight; input existed and draft was empty. The preflight URL is a conversation, so comet_mode with a requested mode returns its explicit fail-closed project/conversation result before any slash UI, home navigation, or input mutation.
- No project instruction, setting, attachment, conversation, schedule, sharing, backend, existing tab, or draft was altered.


## Acceptance repair record — 2026-10-04
The inspectable raw owned-target capture is docs/w1-artifact-scoped-raw-20261004.json. It contains the exact selector (main), title, complete 4,925-character returned text, explicit truncated:false, verbatim 1,000-character head/tail, renderer block texts, and all nine complete permalink URLs. It records target A67C08E2A4747150F48784EFBCD87ADA and originalTargetsUnchanged:true.

Independent comparison is negative: local ../../outputs/comet-pilot/20261003_W1_artifact_raw.md has 6,125 characters; neither full text nor the baseline phrase Google тестирует оплату издателям occurs in the scoped main capture. Therefore main is not proven to be the standalone Deep Research W1 file and this repair is intentionally PARTIAL, not an artifact-completeness pass.

Draft safety evidence is bounded: the owned W1 composer was empty before/after read-only preflight and the conversation URL guard fails closed before any slash UI or navigation. An unrelated nonempty owner draft was not safely available and was not created, read, or modified; that stronger before/after proof remains unavailable by design.
