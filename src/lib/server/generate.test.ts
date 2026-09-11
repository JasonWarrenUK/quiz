import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The pipeline's budgets were all call counts; the platform's limit is wall
// clock. These cover the deadline that reconciles the two, and the run totals.

vi.mock("$env/static/private", () => ({ ANTHROPIC_API_KEY: "test-key" }));

const callModel = vi.fn();
vi.mock("./anthropic", async () => {
	const actual = await vi.importActual<typeof import("./anthropic")>("./anthropic");
	return { ...actual, MODEL: "claude-sonnet-5", callModel: (...args: unknown[]) => callModel(...args) };
});

const { fetchBank } = await import("./generate");

beforeEach(() => {
	callModel.mockReset();
	vi.useFakeTimers();
});

afterEach(() => vi.useRealTimers());

describe("fetchBank time budget", () => {
	it("stops at the deadline and keeps what was already written", async () => {
		// Every call burns four minutes of the budget and returns nothing usable,
		// so only the clock can end this run.
		callModel.mockImplementation(async () => {
			vi.advanceTimersByTime(240_000);
			return null;
		});

		const p = fetchBank("Topic", 5, "Medium", { useSearch: false });
		await vi.runAllTimersAsync();
		const { bank, log } = await p;

		expect(log.timedOut).toBe(true);
		expect(bank).toEqual([]);
		// It stopped on the clock, well before the call caps would have.
		expect(log.attempts.length).toBeLessThan(19);
	});

	it("returns questions written before the budget ran out rather than losing them", async () => {
		// Questions carried in from a previous run stand in for work already
		// done; the run then times out before it can add to them.
		const existing = Array.from({ length: 3 }, (_, i) => ({
			subject: `Kept ${i + 1}`,
			angle: "angle",
			a: `Answer ${i + 1}`,
			alt: [],
			level: 3,
			jargon: false,
			q: `Question ${i + 1}?`,
			verified: true,
			solved: "in" as const,
			judged: "in" as const
		}));
		callModel.mockImplementation(async () => {
			vi.advanceTimersByTime(240_000);
			return null;
		});

		const p = fetchBank("Topic", 5, "Medium", { useSearch: false, existing });
		await vi.runAllTimersAsync();
		const { bank, log } = await p;

		expect(log.timedOut).toBe(true);
		// The three already-good questions survive the timeout.
		expect(bank).toHaveLength(3);
		expect(bank.map((q) => q.a)).toEqual(["Answer 1", "Answer 2", "Answer 3"]);
		expect(log.shortfall).toBe(2);
	});

	it("does not flag a timeout on a run that finishes inside the budget", async () => {
		callModel.mockImplementation(async () => null);

		const p = fetchBank("Topic", 5, "Medium", { useSearch: false });
		await vi.runAllTimersAsync();
		const { log } = await p;

		expect(log.timedOut).toBeUndefined();
	});
});

describe("fetchBank run totals", () => {
	it("sums tokens and calls across every attempt", async () => {
		// callModel records usage on the attempt it is given, as the real one does.
		callModel.mockImplementation(async (_prompt: string, o: { a: Record<string, unknown> }) => {
			o.a.tokens = { input: 100, output: 50, cacheWrite: 0, cacheRead: 900, searches: 0 };
			o.a.ms = 1000;
			return null;
		});

		const p = fetchBank("Topic", 5, "Medium", { useSearch: false });
		await vi.runAllTimersAsync();
		const { log } = await p;

		expect(log.totals?.calls).toBe(log.attempts.length);
		expect(log.totals?.inputTokens).toBe(100 * log.attempts.length);
		expect(log.totals?.outputTokens).toBe(50 * log.attempts.length);
		expect(log.totals?.cacheReadTokens).toBe(900 * log.attempts.length);
	});
});

describe("fetchBank prompt assembly", () => {
	it("sends the stable text once as a cached block, not in every prompt", async () => {
		callModel.mockImplementation(async () => null);

		const p = fetchBank("Roman aqueducts", 5, "Medium", { useSearch: false });
		await vi.runAllTimersAsync();
		await p;

		const [prompt, o] = callModel.mock.calls[0] as [string, { cachedSystem: string }];
		// The craft notes and difficulty table live in the cached block...
		expect(o.cachedSystem).toContain("What makes a question worth asking");
		expect(o.cachedSystem).toContain("DIFFICULTY: MEDIUM");
		expect(o.cachedSystem).toContain("Treat the topic as a boundary");
		// ...and not in the per-call prompt, which carries the topic instead.
		expect(prompt).not.toContain("What makes a question worth asking");
		expect(prompt).not.toContain("DIFFICULTY: MEDIUM");
		expect(prompt).toContain("Roman aqueducts");
	});

	it("gives every call in a run the identical cached block", async () => {
		// Necessary for reuse but not sufficient: the cache key also covers tools
		// and output_config, so a stage whose schema or tool set differs writes
		// its own entry. Reuse within a stage is what the live run confirms.
		callModel.mockImplementation(async (_p: string, o: { a: Record<string, unknown> }) => {
			o.a.tokens = { input: 1, output: 1, cacheWrite: 0, cacheRead: 0, searches: 0 };
			return null;
		});

		const p = fetchBank("Topic", 5, "Medium", { useSearch: false });
		await vi.runAllTimersAsync();
		await p;

		const blocks = new Set(callModel.mock.calls.map((c) => (c[1] as { cachedSystem: string }).cachedSystem));
		expect(blocks.size).toBe(1);
	});
});

describe("write() handling of an unfinished search loop", () => {
	// A response still paused after its continuations ran out has a truncated
	// body, exactly like one that hit the token limit. Before this, only
	// max_tokens was recognised, so an exhausted pause was reported as invalid
	// JSON and the batch never shrank in response.
	const pausedWrite = (n: number) => ({
		content: [{ type: "text", text: `{"questions":[${Array.from({ length: n }, (_, i) => `{"id":${i + 1},"ok":true,"q":"Q${i + 1}?","a":"A${i + 1}","alt":[]}`).join(",")}` }],
		stop_reason: "pause_turn",
		usage: { input_tokens: 10, output_tokens: 5 }
	});

	it("treats an exhausted pause as a cut-off rather than bad JSON", async () => {
		let call = 0;
		callModel.mockImplementation(async (_p: string, o: { a: Record<string, unknown>; useSearch: boolean }) => {
			call += 1;
			if (!o.useSearch && call === 1) {
				return {
					content: [{ type: "text", text: JSON.stringify({
						reading: { includes: "a", excludes: "b", answers: "c" },
						members: 50,
						format: "mixed",
						plan: Array.from({ length: 5 }, (_, i) => ({ member: `M${i + 1}`, angle: `angle ${i + 1}`, answer: `A${i + 1}`, level: 3, jargon: false }))
					}) }],
					stop_reason: "end_turn",
					usage: { input_tokens: 10, output_tokens: 5 }
				};
			}
			return pausedWrite(1);
		});

		const p = fetchBank("Topic", 2, "Medium", { useSearch: true });
		await vi.runAllTimersAsync();
		const { log } = await p;

		const writes = log.attempts.filter((x) => x.stage === "write");
		expect(writes.length).toBeGreaterThan(0);
		// Reported as a cut-off, naming the unfinished searches as the cause.
		expect(writes[0].parse).toContain("searches unfinished");
		expect(writes[0].parse).not.toContain("not valid JSON");
	});

	it("shrinks the batch when a write pauses out, so fewer searches are asked for", async () => {
		let call = 0;
		callModel.mockImplementation(async (_p: string, o: { useSearch: boolean }) => {
			call += 1;
			if (call === 1) {
				return {
					content: [{ type: "text", text: JSON.stringify({
						reading: { includes: "a", excludes: "b", answers: "c" },
						members: 50,
						format: "mixed",
						plan: Array.from({ length: 8 }, (_, i) => ({ member: `M${i + 1}`, angle: `angle ${i + 1}`, answer: `A${i + 1}`, level: 3, jargon: false }))
					}) }],
					stop_reason: "end_turn",
					usage: { input_tokens: 10, output_tokens: 5 }
				};
			}
			return pausedWrite(1);
		});

		const p = fetchBank("Topic", 5, "Medium", { useSearch: true });
		await vi.runAllTimersAsync();
		const { log } = await p;

		const shrank = log.attempts.find((x) => x.stage === "write" && x.batchNote);
		expect(shrank?.batchNote).toContain("searches unfinished");
		expect(shrank?.batchNote).toContain("2 → 1");
	});
});
