import type { Difficulty, Question, GenLog, FetchBankResult } from "../types";

export interface FetchBankViaApiOpts {
	onStatus: (s: string) => void;
	useSearch: boolean;
	signal: AbortSignal;
	otherTopics: string[];
	existing: Question[];
	format: string;
}

// Client-side counterpart to the artefact's direct-from-browser fetchBank:
// calls the server route instead of the Anthropic API directly (the key
// lives server-side now), reading the NDJSON status stream to drive the
// same onStatus callback the UI already expects.
export async function fetchBankViaApi(topic: string, k: number, difficulty: Difficulty, opts: FetchBankViaApiOpts): Promise<FetchBankResult> {
	const { onStatus, useSearch, signal, otherTopics, existing, format } = opts;
	const res = await fetch("/api/generate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ topic, k, difficulty, useSearch, otherTopics, existing, format }),
		signal
	});
	if (!res.ok || !res.body) {
		const text = await res.text().catch(() => "");
		throw new Error(`generation request failed: HTTP ${res.status}${text ? ` - ${text.slice(0, 200)}` : ""}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl: number;
		while ((nl = buf.indexOf("\n")) >= 0) {
			const line = buf.slice(0, nl);
			buf = buf.slice(nl + 1);
			if (!line.trim()) continue;
			const msg = JSON.parse(line) as { type: string; status?: string; result?: FetchBankResult; message?: string };
			if (msg.type === "status" && msg.status) onStatus(msg.status);
			else if (msg.type === "done" && msg.result) return msg.result;
			else if (msg.type === "cancelled") throw Object.assign(new Error("cancelled"), { name: "AbortError" });
			else if (msg.type === "error") throw new Error(msg.message || "generation failed");
		}
	}
	// The server sends a done line even when it stops at its own time budget, so
	// reaching here means the stream died first: almost always the platform
	// killing the function at maxDuration. Say so, rather than reporting a bare
	// missing result, because the two call for different responses.
	throw new Error("the generator stopped before it finished, most likely by running out of time on the server; trying again keeps anything already written");
}

export type { GenLog };
