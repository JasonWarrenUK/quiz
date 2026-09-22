import { describe, it, expect } from "vitest";
import { PlanEntrySchema, QuestionSchema } from "./question-schema";

// The point of deriving the types from these schemas is that a field cannot be
// added to one and forgotten in the other. These guard the properties that
// made the drift matter in the first place.

const question = {
	subject: "Bell Rock Lighthouse",
	angle: "who designed it",
	a: "Robert Stevenson",
	alt: [],
	level: 3,
	jargon: false,
	q: "Which engineer designed the Bell Rock Lighthouse?",
	verified: true
};

describe("question schema", () => {
	it("accepts a written question", () => {
		expect(QuestionSchema.safeParse(question).success).toBe(true);
	});

	it("requires question text, unlike a plan entry", () => {
		const planned = { ...question, q: null };
		expect(PlanEntrySchema.safeParse(planned).success).toBe(true);
		expect(QuestionSchema.safeParse(planned).success).toBe(false);
	});

	it("keeps the check state, so a top-up does not redo work already done", () => {
		// Zod strips unknown keys. If these fell out of the schema, a top-up
		// would re-solve and re-judge questions that had already passed.
		const checked = {
			...question,
			solved: "in" as const,
			solverBest: "Robert Stevenson",
			solverCandidates: ["Robert Stevenson"],
			solverRivals: [],
			solverDiffers: false,
			solverConfidence: "high",
			judged: "in" as const,
			judgeNote: "fine",
			judgeUnsure: false,
			rivalVerdicts: [{ name: "Alan Stevenson", verdict: "wrong" }],
			source: "Wikipedia"
		};

		const parsed = QuestionSchema.parse(checked);

		// Every check field survives the round trip.
		for (const key of Object.keys(checked)) {
			expect(parsed).toHaveProperty(key);
		}
	});

	it("describes the same fields in both schemas apart from q", () => {
		// Question extends PlanEntry, so the only difference is q's nullability.
		const planKeys = Object.keys(PlanEntrySchema.shape).sort();
		const questionKeys = Object.keys(QuestionSchema.shape).sort();
		expect(questionKeys).toEqual(planKeys);
	});

	it("rejects a level outside the 1-5 band", () => {
		expect(QuestionSchema.safeParse({ ...question, level: 0 }).success).toBe(false);
		expect(QuestionSchema.safeParse({ ...question, level: 6 }).success).toBe(false);
	});
});
