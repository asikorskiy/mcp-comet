# OpenClaw research integration (owner fork)

Baseline: upstream v1.1.5. This branch fixes DOM drift observed with Comet Chrome/153 and preserves user tabs; it is a maintained source fork, not a patched global npm installation. MIT license remains upstream.

## Changes

- Do not close other browser tabs on automatic MCP connection or comet_ask(newChat). Keep the selected CDP target for follow-up; avoid silently selecting another main tab.
- Comet mode queries are non-invasive: return unknown rather than navigating away or clearing a draft. Explicit mode switching uses Lexical insertText and recognizes a clicked menu item; selecting standard navigates home. Switching mode can still fail when the Comet UI changes; caller must check result.
- A completed answer is not active merely because a separate button contains an SVG rectangle or old page text says Searching. Extract outer prose with line breaks rather than the final nested list item.
- Extract cited URL from citation data attributes, accept official Perplexity blog URLs, deduplicate nested badges. A citation still needs independent fact verification.

## Test and use

Local build: npm ci --ignore-scripts; npm run typecheck; npm run build; npm test; npm run lint. Run via node dist/cli.js start as an OpenClaw stdio MCP server; grant comet__* only to the research agent through the owner-approved tool policy. Do not run separate CLI MCP clients concurrently with active sessions: they may attach to a different browser tab. The embedded OpenClaw MCP client keeps one connection over the session lifetime.

Researcher contract: one scoped Comet task per own conversation; choose mode only if confirmed, ask with newChat:false after setting mode. Use source URLs and browser verification independently, timebox monitoring and fall back to Sonar when session/budget is unavailable. Comet does not write to Obsidian; use vault_io.py and review before ingest.

Upstream maintenance: fetch upstream tags, merge onto this branch, rerun all tests and one live completion/source/follow-up smoke test before redeploying. Do not overwrite global npm files. Current direct API does not provide a reliable explicit choice of Perplexity backend model; do not claim model selection from mode switching.


## Owned target artifact retrieval

When Comet already has owner tabs, do not call comet_open_conversation or comet_connect for a research artifact. Use the explicit owned-target sequence instead.

1. Call comet_create_owned_target. It uses browser-level CDP Target.createTarget with background=true, verifies every pre-existing target URL is unchanged, and returns the bound target ID. It never closes or reuses an existing target.
2. Call comet_open_owned_conversation with that exact ID and a https://perplexity.ai/ conversation URL. The tool refuses a missing, non-owned, or ambiguous target; it never reconnects to an owner tab as a fallback.
3. For body/source completeness, use the supported CDPClient owned-target read path: createOwnedTarget(), navigateOwnedTarget(targetId, conversationUrl), then safeEvaluate a read-only DOM expression returning document.title, body.innerText, its character count, first and last 1000 characters, and deduplicated anchor href values. Record totalCharacters, returnedCharacters, and truncated explicitly; never infer completeness from a source count.

The browser smoke-tested W1 read path returned the requested conversation title and 60,061 characters, plus head/tail and source URLs. This is a DOM-level page-body extraction; its body includes visible navigation/history text, so a consumer needing only the prose artifact must preserve the explicit count and apply a future answer-container selector rather than claim the 8,957-character local baseline as an exact match.

If browser-level CDP, target verification, or the owned target is unavailable, fail closed. Leave every tab in place; do not use target cleanup as recovery. Project and draft conversations remain unsupported for mode switching: comet_mode must return its existing fail-closed result rather than navigating home or issuing a slash command.
