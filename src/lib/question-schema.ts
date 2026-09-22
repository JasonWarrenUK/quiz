import { z } from "zod";

// The single source of truth for a question's shape. The API route validates
// against these and types.ts re-exports the inferred types, so a field added
// here reaches both without anyone having to remember the other place.
//
// This lives apart from types.ts on purpose: types.ts is imported by Svelte
// components, and a runtime zod import there would pull the library into the
// client bundle for the sake of types that vanish at compile time.
//
// Not to be confused with the JSON Schemas in server/schemas.ts. Those
// describe the wire shape the model answers in ("member", "answer"), which is
// a different contract from the shape the app stores ("subject", "a").

const Short = z.string().max(200);

export const PlanEntrySchema = z.object({
	subject: Short,
	angle: Short,
	a: Short,
	alt: z.array(Short).max(10),
	level: z.number().min(1).max(5),
	jargon: z.boolean(),
	// A planned entry has no question text yet; a written one does. That is the
	// only difference between a PlanEntry and a Question.
	q: z.string().max(400).nullable(),
	verified: z.boolean().nullable(),
	source: z.string().max(300).nullable().optional(),
	// The check state must round-trip through the API: Zod strips unknown keys,
	// and without these a top-up re-solves and re-judges questions that already
	// passed.
	solved: z.enum(["in", "out", "unsolved"]).optional(),
	solverBest: Short.optional(),
	solverCandidates: z.array(Short).max(10).optional(),
	solverRivals: z.array(Short).max(10).optional(),
	solverDiffers: z.boolean().optional(),
	solverConfidence: z.string().max(20).optional(),
	judged: z.enum(["in", "out", "unjudged"]).optional(),
	judgeNote: z.string().max(400).optional(),
	judgeUnsure: z.boolean().optional(),
	rivalVerdicts: z.array(z.object({ name: Short, verdict: z.string().max(20) })).max(10).optional()
});

export const QuestionSchema = PlanEntrySchema.extend({
	q: z.string().max(400)
});

export type PlanEntry = z.infer<typeof PlanEntrySchema>;
export type Question = z.infer<typeof QuestionSchema>;
