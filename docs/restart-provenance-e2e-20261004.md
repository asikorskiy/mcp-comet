# Restart provenance E2E proof — 2026-10-04

Workboard card: 5b01ecca-ed2e-4144-b73e-b03d4ba83fae — "Comet MCP restart loses
pending-question binding and returns unbound answer".

## What changed

- src/pending-binding.ts (new): durable pending-question binding record
  (schema 1: epoch, targetId, url, 64-char normalized questionAnchor,
  submittedAt, promptLength — never the full prompt text), per-process
  SERVER_EPOCH, and the pure resolveBindingContext decision function.
- src/server.ts: comet_ask persists the record on confirmed submit; navigation
  tools (newChat, comet_open_conversation, comet_open_owned_conversation)
  clear record and memory together; comet_poll / comet_wait resolve the
  binding context and annotate results with binding ("memory" | "rebound" |
  "unbound" | "restart_lost"), restart provenance, and priorBinding for
  unrelated tabs. Post-restart polls either rebind with the standard anchor
  validation or fail closed (status "binding_lost", suppressed response).
  Nothing is ever re-asked.
- Tests: tests/unit/pending-binding.test.ts (12 tests), tests/integration/
  tools/restart-binding.test.ts (8 tests), plus harness isolation of
  MCP_COMET_STATE_DIR. Pre-commit gates (build, lint, typecheck, 350 vitest
  tests) pass on the combined working tree.
- Docs: docs/tools.md (poll response fields + "Restart provenance and
  rebinding" section) and CHANGELOG.md (Unreleased).

## Live isolated stdio run

- Command: node scripts/e2e-restart-provenance.mjs
- Probe: public-only text ("QA-RESTART-1007 restart provenance probe: reply
  with exactly OK-1007 and nothing else. Do not research anything.").
- Isolation: dedicated MCP_COMET_STATE_DIR temp dir; server A pid 86915,
  server B pid 87086; owned target 4A31C382C09103FD2B3E23FA3EC1227C;
  conversation URL https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656

### Output (verbatim)

    state dir: /Users/asikorskiy/.openclaw/tmp/comet-restart-e2e-YbW9ow
    server A pid: 86915
    PASS owned target created — Owned target created and bound: 4A31C382C09103FD2B3E23FA3EC1227C (background=true). Existing target URLs verified unchanged:
    PASS probe question submitted — Prompt submitted successfully. Use comet_poll to track status or comet_wait to block until completion.
    PASS response present before restart — OK-1007
    PASS binding record persisted — {"schema":1,"epoch":"86915-mutjx6l7-2601b4","targetId":"4A31C382C09103FD2B3E23FA3EC1227C","url":"https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656","questionAnchor":"QA-RESTART-1007 restart provenance
    PASS record epoch belongs to process A — epoch=86915-mutjx6l7-2601b4 pidA=86915
    PASS record target matches owned target — 4A31C382C09103FD2B3E23FA3EC1227C
    PASS record URL captured — https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656
    PASS probe question appears once in body — count=1
    PASS probe answer visible in body — count=1
    server B pid: 87086
    PASS restart produced a new process — pidA=86915 pidB=87086
    PASS post-restart poll rebinds with validation — binding=rebound
    PASS restart provenance present — {"previousEpoch":"86915-mutjx6l7-2601b4","currentEpoch":"87086-mutjylce-ce91cb","submittedAt":1791102071364,"recordedTargetId":"4A31C382C09103FD2B3E23FA3EC1227C","recordedUrl":"https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656"}
    PASS rebound answer attributed — status=completed
    PASS rebound has no bindingError
    PASS current epoch belongs to process B — currentEpoch=87086-mutjylce-ce91cb
    PASS no duplicate ask after restart — before=1 after=1
    PASS answer count unchanged after restart — before=1 after=1
    PASS second owned target created — F49708EC714BCCCE97154FA34D8129D6
    PASS unrelated tab stays unbound — binding=unbound
    PASS unrelated tab not failed closed — status=idle
    PASS priorBinding provenance exposed — {"previousEpoch":"86915-mutjx6l7-2601b4","currentEpoch":"87086-mutjylce-ce91cb","submittedAt":1791102071364,"recordedTargetId":"4A31C382C09103FD2B3E23FA3EC1227C","recordedUrl":"https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656"}
    PASS unrelated tab response not suppressed — {"response":"","bindingError":""}
    PASS rebind works again on the bound tab — binding=rebound
    PASS corrupted URL fails closed — binding=restart_lost status=binding_lost
    PASS response suppressed on fail closed — response=""
    PASS fail closed keeps restart provenance — restart present
    PASS restored record rebinds again — binding=rebound
    owned tabs left open (by design): 4A31C382C09103FD2B3E23FA3EC1227C, F49708EC714BCCCE97154FA34D8129D6
    E2E-RESTART-PROVENANCE: PASS (pidA=86915 pidB=87086 url=https://www.perplexity.ai/search/e34fa667-99bf-45b9-9cbc-f6e959a1e656)
    E2E_EXIT=0

### Result

24/24 checks PASS. Key assertions:

- The record epoch belongs to process A; after the restart, process B detects
  the foreign epoch and does not treat tab content as attributed by default.
- comet_poll on the same owned tab rebinds with validation: binding "rebound",
  restart.previousEpoch = A's epoch, restart.currentEpoch = B's epoch,
  status "completed" with the answer attributed to the recorded question and
  empty bindingError.
- No duplicate ask: question marker count 1 -> 1, answer count 1 -> 1.
- Unrelated owned tab: binding "unbound", status "idle", priorBinding
  provenance only — not failed closed, response not suppressed.
- Corrupted recorded URL fails closed: binding "restart_lost",
  status "binding_lost", response suppressed, restart provenance kept.
- Restoring the record re-enables validated rebinding.

## Notes

- tests/integration/tools/restart-binding.test.ts is masked by the unanchored
  "tools/" pattern in .gitignore (line 9), which also hides the
  tests/integration/tools/ directory — consider anchoring that pattern to
  "/tools/" so new tests there are committable.
- The E2E leaves its two MCP-owned background tabs open by design; all
  pre-existing tab URLs were verified unchanged during owned-target creation.
- The long-running gateway comet MCP instance picks up this contract on its
  next process restart (dist/ is already rebuilt); fresh stdio spawns (like
  the parent E2E harness) use it immediately.
- A concurrent sibling worker edited src/cdp/client.ts, src/ui/navigation.ts,
  mode-chip parts of src/server.ts, and ui-tools/navigation tests in this
  working tree; those changes were not touched by this card.
