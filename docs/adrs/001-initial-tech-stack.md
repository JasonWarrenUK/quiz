# ADR-001: Initial Tech Stack and Artefact Translation

> **Status**: Accepted
> **Date**: 2026-09-07
> **Author**: Jason Warren
> **Context**: Ported from a single-file `quiz-night.jsx` Claude artefact

---

## Context

`quiz-night.jsx` was a single-file React component (~1700 lines) exported from Claude Chat: a party quiz generator that plans, writes, blind-solves and judges quiz questions via live calls to the Anthropic Messages API, then runs a scored multiplayer round on one shared phone. It ran entirely client-side, calling `api.anthropic.com` directly from the browser with no server, because the Claude artefact host injects an API key into that environment.

Growing this into a real, deployable project required settling the runtime stack, translating the React/JSX component model into something else, and finding a home for the Anthropic API key that no longer has an artefact host to hide it.

---

## Decision

- **Framework**: Svelte 5 (runes) / SvelteKit 2, the default target for artefact ports in this workflow. React/Next.js was not requested.
- **Backend**: a SvelteKit server route (`src/routes/api/generate/+server.ts`) proxies the Anthropic API. The key lives in `.env` (`ANTHROPIC_API_KEY`), read via `$env/static/private`, and never reaches the browser.
- **Package manager**: bun throughout (`sv create`, `sv add`, `bun run`).
- **Styling**: Tailwind CSS v4 for layout/spacing utilities (ported near-verbatim from the JSX `className` strings), colour routed through a role-alias CSS custom-property layer (`src/lib/styles/tokens.css`) rather than hardcoded hex values, per this project's theme conventions.
- **Testing**: Vitest, unit-testing flavour, covering the pure logic module (`src/lib/quiz-logic.ts`).

---

## Rationale

Svelte 5's runes (`$state`, `$derived`, `$effect`) map cleanly onto the artefact's React hooks (`useState`, `useMemo`, `useEffect`), and SvelteKit's file-based routing gives the project a natural home for the server-side generation endpoint the artefact never needed. Tailwind was kept rather than hand-written CSS because the artefact's own layout is expressed almost entirely as Tailwind utility classes in `className` strings; hand-writing equivalent CSS would have been a large, unnecessary scope expansion with real risk of losing layout fidelity, when the only thing that actually needed replacing was the artefact's hardcoded colour values.

The generation pipeline (`fetchBank`: a plan → write → solve → judge loop with retry/backoff, truncated-JSON salvage, and mechanical validation against the plan) was ported close to verbatim into the server route rather than rebuilt on an agent framework such as LangChain. The pipeline's complexity is almost entirely domain logic specific to this app (answer-collision matching, plan selection, British-spelling normalisation) that a framework would not remove; a framework would only replace the transport plumbing (retries, streaming), which the port already handles directly against the Messages API.

---

## Alternatives Considered

### Option 1: React / Next.js

**Description**: Keep the artefact's own framework, scaffold a Next.js app around it, add a Next.js API route for the Anthropic key.

**Pros**:
- Near copy-paste of the original JSX with no idiom translation
- No React → Svelte rune-mapping risk

**Why rejected**: Not requested; Svelte/SvelteKit is the default target for this workflow, and React is an explicit opt-in the user did not make.

### Option 2: LangChain (or similar) for the generation pipeline

**Description**: Wrap the plan/write/solve/judge calls in a LangChain agent or chain.

**Pros**:
- Built-in tracing and observability
- Easier to swap models later

**Cons**:
- Adds a dependency and an abstraction layer over logic that is already correct and specific to this app
- Does not remove any of the actual complexity (answer collision, plan selection, salvage-on-truncation), which is domain logic, not transport logic

**Why rejected**: The user's own instinct was to question this, and the answer held even under that pressure: if the current API calls are underperforming, the fix is either prompt/phase redesign (merging solve+judge, fewer round trips) or better observability, neither of which requires a framework. The port keeps `callModel` as a single seam that could be swapped later without touching the domain logic, so the door to LangChain (or anything else) stays open without needing it now.

### Option 3: Client-side API key (user pastes their own key)

**Description**: Keep the artefact's client-side-only architecture; let each user paste their own Anthropic key into the browser, stored in `localStorage`.

**Pros**:
- No server route needed; could ship as a static site on GitHub Pages

**Cons**:
- Ships a real security compromise: the key is exposed to anyone with browser devtools
- Re-introduces the exact problem (a key in the browser) that prompted moving off the artefact host in the first place

**Why rejected**: explicitly rejected by the user in favour of a server-side proxy.

---

## Consequences

### Positive

- The Anthropic API key never reaches the browser.
- The generation pipeline's retry/backoff/truncation-salvage logic, which took real iteration to get right in the artefact, ported with no behavioural rewrite.
- Vercel deployment works out of the box with `@sveltejs/adapter-vercel`, since a server route is now a first-class part of the app rather than an afterthought.

### Negative

- The artefact's live per-attempt status text ("planning", "writing (3/5)", "rate limited, waiting") required a genuine architectural change (NDJSON streaming over the fetch response body) to survive the move from a single-process browser call to a client/server split; a plain request/response `+server.ts` could not have carried it.
- A new public HTTP endpoint is a new trust boundary the artefact never had. It is validated with Zod (topic/format length caps, `k` bounded 2–10, difficulty enum) but is nonetheless a spend vector for anyone who can reach it, unlike the artefact where every call was already gated behind the user's own Claude session.

### Neutral

- Tailwind CSS is now a project dependency where the artefact had none (it used inline `style={{}}` objects exclusively for colour, and Tailwind only for layout, loaded implicitly by the artefact host). This trades a larger `node_modules` for a much smaller, more faithful component port.

---

## Implementation Notes

- Pure logic (scheduling, answer-collision matching, British-spelling `polish()`, the self-test suite) lives in `src/lib/quiz-logic.ts`, framework-free, imported by both the client state module and the server generation module.
- Reactive app state lives in `src/lib/quiz-state.svelte.ts`, a `.svelte.ts` module returning a single object with getters/setters over runes, consumed by every phase component as a `quiz` prop.
- A stale-derived-value hazard was fixed during the port: the artefact's `advance()` closed over `cur` (React's per-render `schedule[idx]`) before mutating `idx`. In Svelte, `cur` is `$derived(() => schedule[idx])`, so reading it *after* `idx` changes silently returns the wrong question. `advance()` now takes the previous `cur` as an explicit parameter, captured by every caller before it mutates `idx`.
- The artefact's own `GenLog` component references `l.model`, a field the artefact itself never actually sets on the log object (only per-attempt). This is a pre-existing quirk in the source artefact, not a porting defect, and was kept as-is (always renders "model: none") rather than silently fixed, since a faithful port preserves source behaviour rather than improving on it without being asked.

---

## Verification

- `bun run check` (svelte-check, strict TypeScript): 0 errors.
- `bun run test:unit`: 27 tests passing, including the full 40-odd-assertion self-test suite ported verbatim from the artefact's `runSelfTests()`.
- Live browser verification (Playwright): setup wizard (all 3 steps), topic entry, generation kick-off, and the real streaming NDJSON pipeline against the live Anthropic API (failing only on the intentionally-stubbed placeholder key, with the correct `401 invalid x-api-key` surfacing through the dev log) were all exercised and confirmed working end-to-end.
- **Not yet verified**: the Handoff, Question and Done screens, which require a working Anthropic API key to reach (the round only begins once a bank of questions has actually been generated). These render correctly to type-checking and match the artefact's logic on inspection, but have not been exercised live.

---

## Related Decisions

- None yet; this is the project's first ADR.

---

## References

- Source artefact: `quiz-night.jsx` (Claude Chat export, version string `2026-09-06` embedded in the file)
- `~/.claude/library/references/react-to-svelte5.md` — the idiom mapping used for the port
- `~/.claude/library/references/theme-conventions.md` — the role-alias colour convention this project's styling follows
