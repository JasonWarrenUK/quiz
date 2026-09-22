<!-- doc-changelog: generated 2026-09-22. Delete this line once you hand-edit this file. -->
# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-09-22

### Added

- Generation runs stream live status over NDJSON, and requests are validated with Zod, instead of the original artefact's client-only flow.
- Plan and judge calls return structured, schema-guaranteed JSON with thinking enabled, so responses no longer need salvage parsing except as a fallback.
- A run's total token usage is tracked across all calls, not just per individual call.
- Dropped plan entries (failed at write, solve or judge) are recorded so a refill never re-proposes or re-pays for them; unused plan entries are reused as spares instead of discarded.
- A light/system/dark theme toggle, with the new brass-and-indigo palette applied before first paint to avoid a flash of the wrong theme.

### Changed

- Moved to Claude Sonnet 5 for generation calls: current generation, cheaper than the model it replaces.
- The Anthropic API transport now runs on the official SDK rather than a hand-rolled client.
- Question types are derived from a single shared schema instead of being maintained separately.
- Prompt text that never varies within a run is now cached once instead of resent on every call.
- The plan schema is kept stable across calls so repeated plan requests can hit prompt caching.

### Fixed

- Answer-leak checking now matches answer stems against question word prefixes, catching cases like "landless" giving away "land".
- Restoring saved question state no longer silently drops the solved, judged or source fields Zod was stripping as unknown keys.
- The generation pipeline now stops on a wall-clock deadline instead of only a call count, and each request is individually bounded by both a timeout and the overall deadline.
- Requests no longer keep paying for "thinking" output when it was meant to be switched off.
- A stream that dies early now reports the likely cause instead of failing silently.
- An unfinished search loop is now treated as a cut-off response rather than accepted as complete.
- The generation API route's `maxDuration` is set to 300 seconds so a full topic pipeline isn't cut off by the platform default.

[Unreleased]: https://github.com/JasonWarrenUK/quiz/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/JasonWarrenUK/quiz/releases/tag/v0.1.0
