// JSON schemas for the structured-output calls (plan, solve, judge). The
// write call carries the web search tool and is left as free JSON for now.
// Rules the API enforces: every object needs additionalProperties: false,
// and numeric or string bounds (minimum, maxLength...) are not supported, so
// the prompt still states the 1-5 band and selectPlan still checks it.

export type JsonSchema = Record<string, unknown>;

const obj = (properties: Record<string, JsonSchema>): JsonSchema => ({
	type: "object",
	properties,
	required: Object.keys(properties),
	additionalProperties: false
});

const str: JsonSchema = { type: "string" };
const int: JsonSchema = { type: "integer" };
const bool: JsonSchema = { type: "boolean" };
const list = (items: JsonSchema): JsonSchema => ({ type: "array", items });
const nullable = (inner: JsonSchema): JsonSchema => ({ anyOf: [inner, { type: "null" }] });
const oneOf = (values: string[]): JsonSchema => ({ type: "string", enum: values });

const READING = obj({ includes: str, excludes: str, answers: str });

const PLAN_ENTRY = obj({ member: str, angle: str, answer: str, level: int, jargon: bool });

// The first plan call also fixes the reading of the topic; later calls are
// given it and must not restate it.
export function planSchema(withReading: boolean): JsonSchema {
	return obj({
		...(withReading ? { reading: READING } : {}),
		members: int,
		format: str,
		plan: list(PLAN_ENTRY)
	});
}

export const SOLVE_SCHEMA: JsonSchema = obj({
	solutions: list(obj({
		id: int,
		best: str,
		candidates: list(str),
		fromWording: bool,
		confidence: oneOf(["high", "medium", "low"])
	}))
});

export const JUDGE_SCHEMA: JsonSchema = obj({
	constraints: list(str),
	verdicts: list(obj({
		id: int,
		fails: list(str),
		correct: oneOf(["yes", "no", "unsure"]),
		countFixed: nullable(bool),
		duplicateOf: nullable(int),
		rivals: list(obj({ name: str, verdict: oneOf(["same", "real", "wrong"]) })),
		why: str
	}))
});
