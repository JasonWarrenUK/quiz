import { z } from "zod";
import type { RequestHandler } from "./$types";
import { fetchBank } from "$lib/server/generate";
import type { Question } from "$lib/types";

const QuestionSchema = z.object({
	subject: z.string().max(200),
	angle: z.string().max(200),
	a: z.string().max(200),
	alt: z.array(z.string().max(200)).max(10),
	level: z.number().min(1).max(5),
	jargon: z.boolean(),
	q: z.string().max(400),
	verified: z.boolean().nullable()
});

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
					existing: existing as Question[],
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
