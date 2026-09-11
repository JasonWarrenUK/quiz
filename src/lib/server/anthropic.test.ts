import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callModel, makeClient, setClientForTests, type CallModelAttempt } from "./anthropic";

// The transport layer's tests. The SDK issues its own requests rather than
// going through the global fetch, so a fetch is injected into the client here
// instead of stubbing a global: same mock shape, honest plumbing.

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

const ok = (body: unknown) =>
	new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const msg = (text: string, extra: Record<string, unknown> = {}) => ({
	id: "msg_1",
	type: "message",
	role: "assistant",
	model: "claude-sonnet-5",
	content: [{ type: "text", text, citations: null }],
	stop_reason: "end_turn",
	stop_sequence: null,
	usage: { input_tokens: 10, output_tokens: 5 },
	...extra
});

const err = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const opts = (a: CallModelAttempt, over: Record<string, unknown> = {}) => ({
	useSearch: false,
	maxUses: 0,
	onStatus: () => {},
	a,
	...over
});

let fetchMock: ReturnType<typeof vi.fn>;
let restore: () => void;

// Fake timers make the backoff sleeps instant. Scoped to the describes that
// need them rather than the whole file: the SDK's own timeout and abort
// handling run on real timers, which fake ones do not drive.
function withFakeTimers() {
	beforeEach(() => {
		vi.useFakeTimers();
		fetchMock = vi.fn();
		restore = setClientForTests(makeClient(fetchMock as unknown as typeof fetch));
	});
	afterEach(() => {
		vi.useRealTimers();
		restore();
	});
}

// The SDK's ContentBlock is a discriminated union, so text has to be narrowed
// to rather than read off the union.
const textOf = (blocks: { type: string }[] | undefined) =>
	(blocks ?? []).filter((b): b is { type: "text"; text: string } => b.type === "text").map((b) => b.text);

// Drives a promise that awaits fake timers to completion.
async function run<T>(p: Promise<T>): Promise<T> {
	await vi.runAllTimersAsync();
	return p;
}

describe("callModel transport", () => {
	withFakeTimers();

	it("retries after a 429 and records the wait count", async () => {
		fetchMock
			.mockResolvedValueOnce(new Response("rate limited", { status: 429 }))
			.mockResolvedValueOnce(ok(msg("done")));
		const a = attempt();

		const res = await run(callModel("p", opts(a)));

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(a.rateWaits).toBe(1);
		expect(a.status).toBe(200);
		expect(textOf(res?.content)).toEqual(["done"]);
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
		expect(textOf(res?.content)).toEqual(["recovered"]);
	});

	it("continues a pause_turn and accumulates content across both responses", async () => {
		fetchMock
			.mockResolvedValueOnce(ok(msg("first", { stop_reason: "pause_turn" })))
			.mockResolvedValueOnce(ok(msg("second")));
		const a = attempt();

		const res = await run(callModel("p", opts(a, { useSearch: true, maxUses: 4 })));

		expect(a.pauses).toBe(1);
		expect(textOf(res?.content)).toEqual(["first", "second"]);
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

	it("treats a dropped connection as a network error, not a cancellation", async () => {
		// A caller cancellation must propagate, but a timeout is a failed call
		// that the pipeline records and moves past.
		fetchMock.mockImplementation(async () => {
			throw Object.assign(new Error("socket hang up"), { name: "TypeError" });
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

		await run(callModel("p", opts(a, { cachedSystem: "stable rules" })));

		expect(a.tokens).toMatchObject({ cacheWrite: 1337, cacheRead: 0 });
		expect(a.usage).toContain("1337 cache write");
	});
});

describe("callModel request shape", () => {
	withFakeTimers();

	const bodyOf = () => JSON.parse(fetchMock.mock.calls[0][1].body as string);

	it("disables thinking explicitly rather than by omission", async () => {
		// On Sonnet 5 an omitted `thinking` runs adaptive, so "off" has to be sent.
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		await run(callModel("p", opts(attempt(), { thinking: "off" })));

		expect(bodyOf().thinking).toEqual({ type: "disabled" });
	});

	it("sends adaptive thinking at low effort for light calls", async () => {
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		await run(callModel("p", opts(attempt(), { thinking: "light" })));

		const body = bodyOf();
		expect(body.thinking).toEqual({ type: "adaptive" });
		expect(body.output_config.effort).toBe("low");
	});

	it("keeps effort and schema in one output_config", async () => {
		// Two spreads of the same key would silently drop the first.
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		const schema = { type: "object", properties: {}, required: [], additionalProperties: false };
		await run(callModel("p", opts(attempt(), { thinking: "light", schema })));

		const body = bodyOf();
		expect(body.output_config.effort).toBe("low");
		expect(body.output_config.format).toEqual({ type: "json_schema", schema });
	});

	it("sends the stable text as a cached system block", async () => {
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		await run(callModel("p", opts(attempt(), { cachedSystem: "stable rules" })));

		expect(bodyOf().system).toEqual([
			{ type: "text", text: "stable rules", cache_control: { type: "ephemeral" } }
		]);
	});

	it("omits system entirely when there is nothing to cache", async () => {
		fetchMock.mockResolvedValueOnce(ok(msg("x")));
		await run(callModel("p", opts(attempt())));

		expect(bodyOf().system).toBeUndefined();
	});
});

// The SDK enforces the request timeout and detects a caller's abort with its
// own timers, which vitest's fake ones do not drive. These two run on real
// timers with short waits instead.
describe("callModel aborts (real timers)", () => {
	let realFetch: ReturnType<typeof vi.fn>;
	let undo: () => void;

	beforeEach(() => {
		realFetch = vi.fn();
		undo = setClientForTests(makeClient(realFetch as unknown as typeof fetch));
	});
	afterEach(() => undo());

	it("gives up on a request that outlives its timeout", async () => {
		// The SDK enforces the per-request timeout now; what matters here is that
		// it ends the call and is recorded as a network failure, not a cancellation.
		// The SDK aborts via the signal it passes down, so the fake honours it
		// the way a real fetch would.
		realFetch.mockImplementation(
			(_url: string, init: { signal?: AbortSignal }) =>
				new Promise((_res, rej) => {
					init.signal?.addEventListener("abort", () => rej(init.signal!.reason), { once: true });
				})
		);
		const a = attempt();

		const res = await callModel("p", opts(a, { timeoutMs: 20 }));

		expect(res).toBeNull();
		expect(a.apiError).toContain("network");
	});

	it("still propagates a caller cancellation through the combined signal", async () => {
		// The SDK wraps a caller abort as APIUserAbortError with name "Error", so
		// a plain name check misses it. If that goes unnoticed, pressing Cancel
		// is recorded as a failed call and the run carries on regardless.
		const caller = new AbortController();
		// The SDK watches the caller's signal and raises APIUserAbortError, whose
		// name is a plain "Error"; the fake aborts the way a real fetch would.
		realFetch.mockImplementation(
			(_url: string, init: { signal?: AbortSignal }) =>
				new Promise((_res, rej) => {
					init.signal?.addEventListener("abort", () => rej(init.signal!.reason), { once: true });
				})
		);
		setTimeout(() => caller.abort(), 5);
		const a = attempt();

		// Attach the rejection handler before draining timers, so the rejection
		// is never momentarily unhandled.
		const call = callModel("p", opts(a, { signal: caller.signal, timeoutMs: 90_000 }));
		const assertion = expect(call).rejects.toMatchObject({ name: "AbortError" });
		await assertion;
		// A cancellation propagates; it is not recorded as a failed call.
		expect(a.apiError).toBeNull();
	});

});
