import Anthropic from "@anthropic-ai/sdk";
import { ANTHROPIC_API_KEY } from "$env/static/private";
import type { GenAttempt } from "../types";

// The SDK's own types for everything the pipeline reads off a response.
export type ContentBlock = Anthropic.ContentBlock;
export type Usage = Anthropic.Usage;
export type ModelResponse = { content: ContentBlock[]; stop_reason?: string | null; usage?: Usage };

export type CallModelAttempt = GenAttempt;

export const MODEL = "claude-sonnet-5";
// Headroom, not a target: a cut-off response costs a retry, unused room costs nothing.
const MAX_TOKENS = 8000;
// Per-request ceiling. Callers working to a deadline pass something smaller.
const REQUEST_TIMEOUT_MS = 90_000;
const RATE_TRIES = 4;

// maxRetries: 0 on purpose. The SDK would retry inside a single call, and its
// wall clock is timeout x (maxRetries + 1): at a 90s timeout that is 270s
// against a 240s pipeline budget. Dividing the timeout instead is not an
// option, because a measured plan call takes 45s. So the retry policy stays
// here, where it can report each wait into the attempt log and respect the
// caller's deadline.
// fetchOverride exists so tests can drive the transport without a live key or
// a stubbed global; nothing in the app passes it.
export function makeClient(fetchOverride?: typeof fetch): Anthropic {
	return new Anthropic({ apiKey: ANTHROPIC_API_KEY || "missing-key", maxRetries: 0, ...(fetchOverride ? { fetch: fetchOverride } : {}) });
}

let client = makeClient();

// Test seam: swap the client, and get back a function that restores the real one.
export function setClientForTests(c: Anthropic): () => void {
	const prev = client;
	client = c;
	return () => { client = prev; };
}

// The pipeline and the API route both recognise a cancellation by this name,
// so every abort leaves this module wearing it.
const cancelled = () => Object.assign(new Error("cancelled"), { name: "AbortError" });

// A deadline stop is not a cancellation: the caller wants the run to end and
// keep what it has, not to be reported as a user cancel. callModel turns this
// into a failed call, so the pipeline records it and stops on its own clock.
export class DeadlineError extends Error {
	constructor() {
		super("call abandoned: the pipeline's time budget ran out");
		this.name = "DeadlineError";
	}
}

export function isDeadline(e: unknown): boolean {
	return e instanceof DeadlineError;
}

// Waits, unless a signal fires first. Both the caller's cancel signal and the
// deadline reach this: a sleep that outlives the budget is the thing that let
// the backoff ladder run past it.
const sleep = (ms: number, signal?: AbortSignal, deadlineSignal?: AbortSignal) =>
	new Promise<void>((res, rej) => {
		if (deadlineSignal?.aborted) return rej(new DeadlineError());
		if (signal?.aborted) return rej(cancelled());
		const id = setTimeout(res, ms);
		const onCancel = () => { clearTimeout(id); rej(cancelled()); };
		const onDeadline = () => { clearTimeout(id); rej(new DeadlineError()); };
		signal?.addEventListener("abort", onCancel, { once: true });
		deadlineSignal?.addEventListener("abort", onDeadline, { once: true });
	});

// A cancellation from the caller. The SDK wraps it as APIUserAbortError, whose
// `name` is a plain "Error", so the usual name check never matches it; without
// this, pressing Cancel would be recorded as a failed call and the run would
// carry on instead of stopping.
function isCancellation(e: unknown): boolean {
	if (e instanceof Anthropic.APIUserAbortError) return true;
	return e instanceof Error && e.name === "AbortError";
}

// Worth another attempt: rate limits, the 5xx family and a dropped connection.
// A 4xx that is not 429 is a bad request and will fail again identically.
function retryable(e: unknown): boolean {
	// A timeout is not. APIConnectionTimeoutError extends APIConnectionError, so
	// it has to be excluded first or the whole backoff sequence runs again
	// against a deadline that has already expired: the caller set timeoutMs from
	// the time it had left, and spending more of it is the opposite of the point.
	if (e instanceof Anthropic.APIConnectionTimeoutError) return false;
	if (e instanceof Anthropic.RateLimitError) return true;
	if (e instanceof Anthropic.APIConnectionError) return true;
	if (e instanceof Anthropic.APIError && typeof e.status === "number") return e.status >= 500;
	return false;
}

// A 200 whose body is not a message. This endpoint has been seen to return one
// (a gateway error page), and the SDK handles it two ways depending on the
// response's content-type: with a JSON type it tries to parse and lets the
// SyntaxError out unwrapped, with any other type it hands back the raw body as
// though it were the message. Neither is in its retry set, so both are caught
// here: the throw by isBadBody, the quiet one by looking for the content array.
function isBadBody(e: unknown): boolean {
	return e instanceof SyntaxError && !(e instanceof Anthropic.APIError);
}

class BadBodyError extends Error {
	constructor(readonly head: string) {
		super(`response body is not a message (started "${head}")`);
		this.name = "BadBodyError";
	}
}

// What the SDK hands back when the body is not a message, by content-type:
// a non-JSON type comes through as the raw string (the gateway HTML case), a
// JSON type that parses but is not a message comes through as an object, a 204
// as null and an empty body as undefined. Only the string is readable as-is,
// so the other shapes are rendered rather than stringified into "[object
// Object]" or an empty head.
function badBodyHead(res: unknown): string {
	if (typeof res === "string") return res.slice(0, 40);
	if (res === null) return "(no body: HTTP 204)";
	if (res === undefined) return "(empty body)";
	try { return JSON.stringify(res).slice(0, 40); } catch { return "(unreadable body)"; }
}

function assertMessage(res: Anthropic.Message): Anthropic.Message {
	if (!res || !Array.isArray(res.content)) throw new BadBodyError(badBodyHead(res));
	return res;
}

function describe(e: unknown): string {
	// A timeout and a dropped connection are both the network failing to deliver
	// a call, and the pipeline treats them the same way: one empty call, move on.
	if (e instanceof Anthropic.APIConnectionError) return `network: ${e.message}`;
	if (e instanceof Anthropic.APIError) {
		// The SDK's message is the status plus the raw body. The API's own error
		// message is the readable part, so prefer it when it is there.
		const body = e.error as { error?: { type?: string; message?: string } } | undefined;
		const type = body?.error?.type ?? e.name;
		return `${type}: ${body?.error?.message ?? e.message}`;
	}
	return `network: ${e instanceof Error ? e.message : String(e)}`;
}

interface CallModelOpts {
	useSearch: boolean;
	maxUses: number;
	signal?: AbortSignal;
	onStatus: (s: string) => void;
	a: CallModelAttempt;
	// Thinking depth. On Sonnet 5 omitting `thinking` runs adaptive thinking, so
	// a cheap call has to opt out explicitly rather than by omission. "deep" is
	// adaptive at default effort for the calls that reason (plan, judge);
	// "light" is adaptive at low effort; "off" disables it outright.
	// Write stays on "light" rather than "off": Sonnet 5 reaches for tools less
	// readily with thinking disabled, and write is the call carrying search.
	thinking?: "deep" | "light" | "off";
	// JSON schema for structured output; the response text is then guaranteed to parse.
	schema?: Record<string, unknown>;
	// Text that is identical across calls in a run, sent as a cached system
	// block so it is not re-billed at full rate on every call.
	cachedSystem?: string;
	// Wall-clock ceiling for this call, so one hung request cannot eat the whole
	// serverless budget. The caller trims it to whatever remains of the deadline.
	timeoutMs?: number;
	// Fires when the pipeline's budget runs out. timeoutMs alone bounds one
	// request; it does not bound this function, which can sleep through a
	// backoff ladder and start a fresh request on either side of the deadline.
	// This is what stops the retries and the sleeps, not just the socket.
	deadlineSignal?: AbortSignal;
}

// One API round trip with the transport handling this endpoint has needed:
// backoff on the retryable failures, and pause_turn continuation for long
// search loops. Records into `a`.
export async function callModel(prompt: string, { useSearch, maxUses, signal, onStatus, a, thinking = "off", schema, cachedSystem, timeoutMs = REQUEST_TIMEOUT_MS, deadlineSignal }: CallModelOpts): Promise<ModelResponse | null> {
	a.model = MODEL;

	const params: Anthropic.MessageCreateParamsNonStreaming = {
		model: MODEL,
		max_tokens: MAX_TOKENS,
		messages: [{ role: "user", content: prompt }],
		// The cached block goes in `system`, which renders before `messages`, so
		// the volatile per-call prompt cannot shift the cached prefix.
		...(cachedSystem ? { system: [{ type: "text" as const, text: cachedSystem, cache_control: { type: "ephemeral" as const } }] } : {}),
		...(thinking === "off" ? { thinking: { type: "disabled" as const } } : { thinking: { type: "adaptive" as const } }),
		// One output_config: effort and format are siblings, and a second spread
		// of the same key would silently drop the first.
		...(thinking === "light" || schema
			? {
				output_config: {
					...(thinking === "light" ? { effort: "low" as const } : {}),
					...(schema ? { format: { type: "json_schema" as const, schema } } : {})
				}
			}
			: {}),
		// Basic variant on purpose. web_search_20260209 (dynamic filtering) was
		// tried on 2026-09-08: it doubled input tokens and tripled write-call
		// time on this workload, because its filtering runs as extra
		// code-execution turns whose output also lands in context.
		...(useSearch ? { tools: [{ type: "web_search_20250305" as const, name: "web_search" as const, max_uses: maxUses }] } : {})
	};

	// Each continuation is separately billed, so usage has to be summed across
	// them: taking only the last response under-reports a paused call.
	const tally: Usage = { input_tokens: 0, output_tokens: 0 } as Usage;
	const addUsage = (u: Usage | undefined) => {
		if (!u) return;
		tally.input_tokens += u.input_tokens ?? 0;
		tally.output_tokens += u.output_tokens ?? 0;
		if (u.cache_creation_input_tokens) tally.cache_creation_input_tokens = (tally.cache_creation_input_tokens ?? 0) + u.cache_creation_input_tokens;
		if (u.cache_read_input_tokens) tally.cache_read_input_tokens = (tally.cache_read_input_tokens ?? 0) + u.cache_read_input_tokens;
		const th = u.output_tokens_details?.thinking_tokens;
		if (th) tally.output_tokens_details = { thinking_tokens: (tally.output_tokens_details?.thinking_tokens ?? 0) + th };
		const n = u.server_tool_use?.web_search_requests;
		if (Number.isFinite(n)) tally.server_tool_use = { ...(tally.server_tool_use ?? { web_fetch_requests: 0, web_search_requests: 0 }), web_search_requests: (tally.server_tool_use?.web_search_requests ?? 0) + (n as number) };
	};

	// One request, retried on the failures worth retrying. Two separate retry
	// budgets, because the failures are unrelated: the API-level one (rate
	// limits, 5xx, dropped connections) and a retry for a 200 whose body is not
	// JSON. That second case is not in the SDK's retry set and was added here
	// for a failure actually observed on this endpoint, so it survives the
	// swap: the SDK surfaces it as a parse error rather than a status code.
	// The request observes both signals: the caller's cancel and the deadline.
	// Without the second, an in-flight request carrying a timeout set before
	// the deadline keeps running after it.
	const requestSignal = (): AbortSignal | undefined => {
		const parts = [signal, deadlineSignal].filter(Boolean) as AbortSignal[];
		return parts.length ? (parts.length === 1 ? parts[0] : AbortSignal.any(parts)) : undefined;
	};

	const send = async (messages: Anthropic.MessageParam[]): Promise<Anthropic.Message> => {
		let tries = 0, badBody = 0;
		for (;;) {
			if (deadlineSignal?.aborted) throw new DeadlineError();
			try {
				return assertMessage(await client.messages.create({ ...params, messages }, { signal: requestSignal(), timeout: timeoutMs, maxRetries: 0 }));
			} catch (e) {
				if (isDeadline(e)) throw e;
				// An abort with the deadline already fired is the deadline, not the
				// user: the combined signal cannot say which half tripped it.
				if (deadlineSignal?.aborted) throw new DeadlineError();
				if (isCancellation(e)) throw cancelled();
				if ((isBadBody(e) || e instanceof BadBodyError) && badBody < 2) {
					badBody += 1;
					const head = e instanceof BadBodyError ? e.head : String((e as Error).message).slice(0, 40);
					a.transportRetry = `body not JSON (started "${head}"), retried ${badBody}×`;
					await sleep(800 * badBody, signal, deadlineSignal);
					continue;
				}
				if (!retryable(e) || tries >= RATE_TRIES) throw e;
				tries += 1;
				a.rateWaits = tries;
				onStatus(e instanceof Anthropic.RateLimitError ? `rate limited, waiting (${tries})` : `connection trouble, retrying (${tries})`);
				await sleep(1500 * Math.pow(2, tries - 1), signal, deadlineSignal);
			}
		}
	};

	try {
		let res = await send(params.messages as Anthropic.MessageParam[]);
		a.status = 200;
		addUsage(res.usage);
		let accumulated = res.content as ContentBlock[];

		let pauses = 0;
		let messages = [...(params.messages as Anthropic.MessageParam[])];
		while (res.stop_reason === "pause_turn" && pauses < 2) {
			pauses += 1;
			a.pauses = pauses;
			onStatus(`still checking (${pauses})`);
			messages = [...messages, { role: "assistant", content: res.content }];
			try {
				res = await send(messages);
			} catch (e) {
				if (isCancellation(e)) throw cancelled();
				// Out of time: keep what the earlier turns returned rather than
				// discarding the call, and let the pipeline stop on its own clock.
				if (isDeadline(e)) { a.apiError = "continuation after pause_turn abandoned: out of time"; a.timedOut = true; break; }
				a.apiError = `continuation after pause_turn failed: ${describe(e)}`;
				break;
			}
			addUsage(res.usage);
			accumulated = [...accumulated, ...(res.content as ContentBlock[])];
		}

		a.stopReason = res.stop_reason ?? null;
		const usage = tally.input_tokens || tally.output_tokens ? tally : undefined;
		const su = usage?.server_tool_use?.web_search_requests;
		const cr = usage?.cache_read_input_tokens, cw = usage?.cache_creation_input_tokens;
		const th = usage?.output_tokens_details?.thinking_tokens ?? 0;
		a.usage = usage
			? `${usage.input_tokens} in / ${usage.output_tokens} out${cr ? ` / ${cr} cached` : ""}${cw ? ` / ${cw} cache write` : ""}${th ? ` / ${th} thinking` : ""}${Number.isFinite(su) ? ` / ${su} search${su === 1 ? "" : "es"}` : ""}`
			: null;
		if (usage) a.tokens = { input: usage.input_tokens, output: usage.output_tokens, cacheWrite: cw ?? 0, cacheRead: cr ?? 0, thinking: th, searches: Number.isFinite(su) ? (su as number) : 0 };
		return { content: accumulated, stop_reason: res.stop_reason, usage };
	} catch (e) {
		if (isCancellation(e)) throw cancelled();
		// A deadline stop is a failed call, not a thrown cancellation: the run
		// keeps every question already written and ends on the pipeline's clock.
		if (isDeadline(e)) { a.apiError = "abandoned: out of time"; a.timedOut = true; return null; }
		if (e instanceof Anthropic.APIError && typeof e.status === "number") a.status = e.status;
		a.apiError = describe(e);
		return null;
	}
}
