import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, type CallModelAttempt } from "./anthropic";

// The transport layer had no tests. These pin the behaviour that the retry,
// pause_turn and deadline paths are meant to have, so the later SDK swap has
// something to be checked against.

vi.mock("$env/static/private", () => ({ ANTHROPIC_API_KEY: "test-key" }));

const attempt = (): CallModelAttempt => ({
	stage: "write",
	call: 1,
	asked: 2,
	model: "",
	status: null,
	apiError: null,
	stopReason: null,
	usage: null,
	rawHead: null,
	parse: null,
	validation: null,
	rateWaits: 0,
	startedAt: Date.now()
});

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const msg = (text: string, extra: Record<string, unknown> = {}) => ({
	content: [{ type: "text", text }],
	stop_reason: "end_turn",
	usage: { input_tokens: 10, output_tokens: 5 },
	...extra
});

const opts = (a: CallModelAttempt, over: Record<string, unknown> = {}) => ({
	useSearch: false,
	maxUses: 0,
	onStatus: () => {},
	a,
	...over
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn();
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Drives a promise that awaits fake timers to completion.
async function run<T>(p: Promise<T>): Promise<T> {
	await vi.runAllTimersAsync();
	return p;
}

describe("callModel transport", () => {
	it("retries after a 429 and records the wait count", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
			.mockResolvedValueOnce(ok(msg("done")));
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(a.rateWaits).toBe(1);
		expect(a.status).toBe(200);
		expect(res?.content[0].text).toBe("done");
	});

	it("gives up after the 429 ceiling and reports the error", async () => {
		fetchMock.mockImplementation(async () => new Response("rate limited", { status: 429 }));
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		// 1 initial + 4 retries, then it stops.
		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(a.rateWaits).toBe(4);
		expect(res).toBeNull();
		expect(a.apiError).toContain("429");
	});

	it("retries a 200 whose body is not JSON", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response("<html>gateway</html>", { status: 200 }))
			.mockResolvedValueOnce(ok(msg("recovered")));
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(a.transportRetry).toContain("body not JSON");
		expect(res?.content[0].text).toBe("recovered");
	});

	it("continues a pause_turn and accumulates content across both responses", async () => {
		fetchMock
			.mockResolvedValueOnce(ok(msg("first", { stop_reason: "pause_turn" })))
			.mockResolvedValueOnce(ok(msg("second")));
		const a = attempt();

		const res = await run(callModel("p", opts(a, { useSearch: true, maxUses: 4 })));

		expect(a.pauses).toBe(1);
		expect(res?.content.map((b) => b.text)).toEqual(["first", "second"]);
		expect(res?.stop_reason).toBe("end_turn");
	});

	it("surfaces a still-paused response instead of passing it off as complete", async () => {
		// Every continuation comes back still paused; after the cap the caller
		// must be able to tell this apart from a finished response.
		// A fresh Response per call: a Response body can only be read once.
		fetchMock.mockImplementation(async () => ok(msg("chunk", { stop_reason: "pause_turn" })));
		const a = attempt();

		const res = await run(callModel("p", opts(a, { useSearch: true, maxUses: 4 })));

		expect(a.pauses).toBe(2);
		expect(res?.stop_reason).toBe("pause_turn");
	});

	it("reports a structured API error without retrying it", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "bad" } }), { status: 400 })
		);
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(res).toBeNull();
		expect(a.apiError).toContain("invalid_request_error: bad");
	});

	it("passes an abort signal that fires on the request timeout", async () => {
		// AbortSignal.timeout runs on the real event loop, which vitest's fake
		// timers do not drive, so this one case uses real ones and a short wait.
		vi.useRealTimers();
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		await callModel("p", opts(attempt(), { timeoutMs: 20 }));

		const sent = fetchMock.mock.calls[0][1].signal as AbortSignal;
		expect(sent).toBeInstanceOf(AbortSignal);
		expect(sent.aborted).toBe(false);
		await new Promise((r) => setTimeout(r, 50));
		expect(sent.aborted).toBe(true);
	});

	it("treats a timeout abort as a network error rather than a cancellation", async () => {
		// A caller cancellation must propagate, but a timeout is a failed call
		// that the pipeline records and moves past.
		fetchMock.mockImplementation(async () => {
			throw Object.assign(new Error("The operation timed out."), { name: "TimeoutError" });
		});
		const a = attempt();

		const res = await run(callModel("p", opts(a, { timeoutMs: 1000 })));

		expect(res).toBeNull();
		expect(a.apiError).toContain("network");
	});

	it("records token usage from the response", async () => {
		fetchMock.mockResolvedValueOnce(ok(msg("hi")));
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		expect(res?.usage?.input_tokens).toBe(10);
		expect(res?.usage?.output_tokens).toBe(5);
		expect(a.usage).toContain("10 in / 5 out");
		expect(a.tokens).toMatchObject({ input: 10, output: 5 });
	});

	it("sums usage across pause_turn continuations rather than keeping only the last", async () => {
		fetchMock
			.mockResolvedValueOnce(ok(msg("first", { stop_reason: "pause_turn" })))
			.mockResolvedValueOnce(ok(msg("second")));
		const a = attempt();

		const res = await run(callModel("p", opts(a, { useSearch: true, maxUses: 4 })));

		// Both turns are billed: 10+10 in, 5+5 out.
		expect(res?.usage?.input_tokens).toBe(20);
		expect(res?.usage?.output_tokens).toBe(10);
		expect(a.tokens).toMatchObject({ input: 20, output: 10 });
	});

	it("reports cache reads and writes so caching can be verified", async () => {
		fetchMock.mockResolvedValueOnce(
			ok(msg("hi", { usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 1337, cache_read_input_tokens: 0 } }))
		);
		const a = attempt();

		await run(callModel("p", opts(a)));

		expect(a.tokens).toMatchObject({ cacheWrite: 1337, cacheRead: 0 });
		expect(a.usage).toContain("1337 cache write");
	});
});
