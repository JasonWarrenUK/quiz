# Quiz Night

A quiz on one phone, passed round the table: each player names a topic and a difficulty, the app writes a full round of questions for it via Claude, then the table plays it out with turns, a shouting race, or solo.

## Overview

Quiz Night grew out of a Claude artefact: a single-file React component that planned, wrote, blind-solved and judged quiz questions live against the Anthropic API, then ran a scored multiplayer round. This is that same app rebuilt as a real SvelteKit project, with the API key moved behind a server route instead of living in the browser.

## Features

- One topic and difficulty per player; questions are generated to fit exactly that topic, not a broad theme
- A four-phase generation pipeline per topic: plan the round, write the questions (optionally verified against a web search), blind-solve them to catch ambiguous answers, then judge the set against the topic
- Three play modes (solo, turns, first-to-shout) and five win conditions (just count, hit a target, highest score, race to a score, team target)
- Live per-topic generation status streamed to the browser as the round is written
- A full dev log per round: every model call, its HTTP status, parse outcome, and validation result, for diagnosing a bad or short round
- Export the finished round as plain text or a full JSON dev log

## Prerequisites

- [Bun](https://bun.sh) 1.3+
- An [Anthropic API key](https://console.anthropic.com/) with access to `claude-sonnet-4-6`

## Installation

```bash
bun install
cp .env.example .env
# then edit .env and set ANTHROPIC_API_KEY
```

## Usage

```bash
bun run dev --open
```

Follow the three-step setup wizard (players, topics, rules), then "Write the questions" starts generation. A round with any topic short of its target question count offers a shorter round or a top-up; a round that fails entirely shows the dev log with the reason.

## Configuration

| Variable | Controls |
|---|---|
| `ANTHROPIC_API_KEY` | Server-side only, read via `$env/static/private` in `src/routes/api/generate/+server.ts`. Never sent to the browser. |

## Project Structure

```
src/
  routes/
    +page.svelte           # phase dispatch (setup/loading/short/error/handoff/question/done)
    api/generate/+server.ts # streams NDJSON status + the finished question bank
  lib/
    quiz-logic.ts           # pure logic: scheduling, answer matching, British-spelling polish, self-tests
    quiz-state.svelte.ts    # all reactive app state (runes) and the game/generation flow
    server/
      anthropic.ts          # transport: retries, 429 backoff, pause_turn continuation
      generate.ts           # the plan → write → solve → judge pipeline
    client/
      fetch-bank.ts         # reads the NDJSON stream, drives onStatus callbacks
      export.ts             # clipboard + file-download helpers
    components/              # presentational components (Btn, Chip, Field, ...)
    components/phases/       # one component per game phase
    styles/
      tokens.css             # role-alias colour/font custom properties
      quiz.css                # fonts, animations, focus states
docs/adrs/                   # architecture decision records
tests/fixtures/               # named-export test fixtures
```

## Development

```bash
bun run dev          # dev server
bun run check         # svelte-check, strict TypeScript
bun run test:unit     # vitest
bun run build         # production build (Vercel adapter)
```

## Documentation

See `docs/adrs/001-initial-tech-stack.md` for the stack decision and the artefact-to-Svelte translation rationale, including a known gap: the Handoff/Question/Done screens type-check and match the artefact's logic but have not been exercised live, since that requires a real Anthropic API key.

## License

Not yet decided.
