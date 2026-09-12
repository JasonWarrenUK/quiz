import { z } from "zod";
import type { Config } from "@sveltejs/adapter-vercel";
import type { RequestHandler } from "./$types";
import { fetchBank } from "$lib/server/generate";
import { QuestionSchema } from "$lib/question-schema";

// One request runs a topic's whole pipeline (plan, write with search, solve,
// judge), which takes minutes. Vercel's default function duration is far
// shorter and would cut the stream off mid-pipeline.
// BUDGET_MS in generate.ts is set against this number and must move with it:
// the pipeline stops itself 60s early so a run ends with a result rather than
// being killed. Raising this without raising that just wastes the extra time.
// That budget is enforced two ways, because a per-request timeout alone does
// not bound a call: a deadline signal stops the retries and the backoff waits
// inside a call, and MIN_CALL_MS stops a new one starting with no room.
export const config: Config = { maxDuration: 300 };

// The question shape is defined once, in lib/question-schema.ts, and the
// PlanEntry/Question types are inferred from it. Validating against the same
// schema the types come from is what stops the two drifting.
const RequestSchema = z.object({
	topic: z.string().min(1).max(300),
	k: z.number().int().min(2).max(10),
	difficulty: z.enum(["Easy", "Medium", "Hard"]),
	useSearch: z.boolean().optional().default(true),
	otherTopics: z.array(z.string().max(300)).max(4).optional().default([]),
	existing: z.array(QuestionSchema).max(10).optional().default([]),
	format: z.string().max(200).optional().default("")
});

// Streams one JSON line per status update (NDJSON), ending with a final line
// carrying the full result. This lets the client show live per-attempt
// progress ("planning", "writing (3/5)", "rate limited...") over plain fetch,
// matching the artefact's onStatus callback without needing websockets.
export const POST: RequestHandler = async ({ request }) => {
	const parsed = RequestSchema.safeParse(await request.json());
	if (!parsed.success) {
		return new Response(JSON.stringify({ error: "invalid request", issues: parsed.error.issues }), { status: 400 });
	}
	const { topic, k, difficulty, useSearch, otherTopics, existing, format } = parsed.data;

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			const send = (line: Record<string, unknown>) => controller.enqueue(encoder.encode(JSON.stringify(line) + "\n"));
			try {
				const result = await fetchBank(topic, k, difficulty, {
					useSearch,
					otherTopics,
					existing,
					format,
					signal: request.signal,
					onStatus: (status) => send({ type: "status", status })
				});
				send({ type: "done", result });
			} catch (e) {
				if (e instanceof Error && e.name === "AbortError") {
					send({ type: "cancelled" });
				} else {
					send({ type: "error", message: e instanceof Error ? e.message : String(e) });
				}
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, { headers: { "Content-Type": "application/x-ndjson" } });
};
