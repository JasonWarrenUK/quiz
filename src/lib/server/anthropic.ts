import { ANTHROPIC_API_KEY } from "$env/static/private";
import type { GenAttempt } from "../types";

export interface ContentBlock {
	type: string;
	text?: string;
	input?: { query?: string };
	content?: unknown;
}

export interface Usage {
	input_tokens: number;
	output_tokens: number;
	cache_creation_input_tokens?: number;
	cache_read_input_tokens?: number;
	server_tool_use?: { web_search_requests?: number };
}

export interface ModelResponse {
	content: ContentBlock[];
	stop_reason?: string;
	usage?: Usage;
}

export type CallModelAttempt = GenAttempt;

export const MODEL = "claude-sonnet-5";
const MODELS = [MODEL];
// Headroom, not a target: a cut-off response costs a retry, unused room costs nothing.
const MAX_TOKENS = 8000;
// Per-request ceiling. Callers working to a deadline pass something smaller.
const REQUEST_TIMEOUT_MS = 90_000;

const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((res, rej) => {
		const id = setTimeout(res, ms);
		signal?.addEventListener("abort", () => { clearTimeout(id); rej(Object.assign(new Error("cancelled"), { name: "AbortError" })); }, { once: true });
	});

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
}

// One API round trip with the transport handling this endpoint has needed:
// 429 backoff, a retry when a 200 arrives with its first bytes missing, and
// pause_turn continuation for long search loops. Records into `a`.
export async function callModel(prompt: string, { useSearch, maxUses, signal, onStatus, a, thinking = "off", schema, cachedSystem, timeoutMs = REQUEST_TIMEOUT_MS }: CallModelOpts): Promise<ModelResponse | null> {
	for (const m of MODELS) {
		a.model = m;
		let rateTries = 0;
		try {
			const reqBody = (msgs: unknown[]) => JSON.stringify({
				model: m,
				max_tokens: MAX_TOKENS,
				messages: msgs,
				// The cached block goes in `system`, which renders before `messages`,
				// so the volatile per-call prompt cannot shift the cached prefix.
				...(cachedSystem ? { system: [{ type: "text", text: cachedSystem, cache_control: { type: "ephemeral" } }] } : {}),
				...(thinking === "off" ? { thinking: { type: "disabled" } } : { thinking: { type: "adaptive" } }),
				// One output_config: effort and format are siblings, and a second
				// spread of the same key would silently drop the first.
				...(thinking === "light" || schema
					? {
						output_config: {
							...(thinking === "light" ? { effort: "low" } : {}),
							...(schema ? { format: { type: "json_schema", schema } } : {})
						}
					}
					: {}),
				// Basic variant on purpose. web_search_20260209 (dynamic filtering) was
				// tried on 2026-09-08: it doubled input tokens and tripled write-call
				// time on this workload, because its filtering runs as extra
				// code-execution turns whose output also lands in context.
				...(useSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }] } : {})
			});
			const post = (msgs: unknown[]) => fetch("https://api.anthropic.com/v1/messages", {
				method: "POST",
				headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
				body: reqBody(msgs),
				// A hung connection would otherwise block until the platform kills
				// the whole function, losing every question already written.
				signal: timeoutMs > 0 ? AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]) : signal
			});
			let messages: unknown[] = [{ role: "user", content: prompt }];
			let res: Response;
			while (true) {
				res = await post(messages);
				if (res.status !== 429 || rateTries >= 4) break;
				rateTries += 1;
				a.rateWaits = rateTries;
				onStatus(`rate limited, waiting (${rateTries})`);
				await sleep(1500 * Math.pow(2, rateTries - 1), signal);
			}
			a.status = res.status;
			let rawText = await res.text();
			let body: Record<string, unknown> | null = null;
			try { body = JSON.parse(rawText); } catch { body = null; }
			for (let tCount = 1; tCount <= 2 && res.ok && body === null; tCount++) {
				a.transportRetry = `body not JSON (started "${rawText.slice(0, 40)}"), retried ${tCount}×`;
				await sleep(800 * tCount, signal);
				const res2 = await post(messages);
				a.status = res2.status;
				rawText = await res2.text();
				try { body = JSON.parse(rawText); } catch { body = null; }
				res = res2;
			}
			if (!res.ok || !body || body.type === "error" || !Array.isArray(body.content)) {
				const err = body?.error as { type?: string; message?: string } | undefined;
				a.apiError = err ? `${err.type}: ${err.message}` : body === null ? `HTTP ${res.status}, body is not JSON` : `HTTP ${res.status}, JSON has no content array (keys: ${Object.keys(body).join(", ") || "none"})`;
				a.rawHead = rawText.slice(0, 400);
				continue;
			}
			let pauses = 0;
			let accumulated = body.content as ContentBlock[];
			// Each continuation is separately billed, so usage has to be summed
			// across them: taking only the last body under-reports a paused call.
			const tally: Usage = { input_tokens: 0, output_tokens: 0 };
			const addUsage = (u: Usage | undefined) => {
				if (!u) return;
				tally.input_tokens += u.input_tokens ?? 0;
				tally.output_tokens += u.output_tokens ?? 0;
				if (u.cache_creation_input_tokens) tally.cache_creation_input_tokens = (tally.cache_creation_input_tokens ?? 0) + u.cache_creation_input_tokens;
				if (u.cache_read_input_tokens) tally.cache_read_input_tokens = (tally.cache_read_input_tokens ?? 0) + u.cache_read_input_tokens;
				const n = u.server_tool_use?.web_search_requests;
				if (Number.isFinite(n)) tally.server_tool_use = { web_search_requests: (tally.server_tool_use?.web_search_requests ?? 0) + (n as number) };
			};
			addUsage(body.usage as Usage | undefined);
			while (body.stop_reason === "pause_turn" && pauses < 2) {
				pauses += 1;
				a.pauses = pauses;
				onStatus(`still checking (${pauses})`);
				messages = [...messages, { role: "assistant", content: body.content }];
				const resP = await post(messages);
				const rawP = await resP.text();
				let bodyP: Record<string, unknown> | null = null;
				try { bodyP = JSON.parse(rawP); } catch { bodyP = null; }
				if (!resP.ok || !bodyP || bodyP.type === "error" || !Array.isArray(bodyP.content)) {
					const err = bodyP?.error as { type?: string; message?: string } | undefined;
					a.apiError = `continuation after pause_turn failed: ${err ? `${err.type}: ${err.message}` : `HTTP ${resP.status}`}`;
					break;
				}
				body = bodyP;
				accumulated = [...accumulated, ...(bodyP.content as ContentBlock[])];
				addUsage(bodyP.usage as Usage | undefined);
			}
			a.stopReason = (body.stop_reason as string) ?? null;
			const usage = tally.input_tokens || tally.output_tokens ? tally : undefined;
			const su = usage?.server_tool_use?.web_search_requests;
			const cr = usage?.cache_read_input_tokens, cw = usage?.cache_creation_input_tokens;
			a.usage = usage
				? `${usage.input_tokens} in / ${usage.output_tokens} out${cr ? ` / ${cr} cached` : ""}${cw ? ` / ${cw} cache write` : ""}${Number.isFinite(su) ? ` / ${su} search${su === 1 ? "" : "es"}` : ""}`
				: null;
			if (usage) a.tokens = { input: usage.input_tokens, output: usage.output_tokens, cacheWrite: cw ?? 0, cacheRead: cr ?? 0, searches: Number.isFinite(su) ? (su as number) : 0 };
			return { content: accumulated, stop_reason: body.stop_reason as string | undefined, usage };
		} catch (e) {
			if (e instanceof Error && e.name === "AbortError") throw e;
			a.apiError = `network: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
	return null;
}
