import { describe, it, expect } from "vitest";
import { planSchema, SOLVE_SCHEMA, JUDGE_SCHEMA, type JsonSchema } from "./schemas";

// The API rejects a schema with any object lacking additionalProperties: false,
// or carrying bounds it does not support. Walk every node and check.
const UNSUPPORTED = ["minimum", "maximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"];

function walk(node: unknown, path: string, problems: string[]): void {
	if (Array.isArray(node)) { node.forEach((n, i) => walk(n, `${path}[${i}]`, problems)); return; }
	if (!node || typeof node !== "object") return;
	const s = node as JsonSchema;
	if (s.type === "object") {
		if (s.additionalProperties !== false) problems.push(`${path}: object without additionalProperties: false`);
		const props = Object.keys((s.properties as Record<string, unknown>) || {});
		const req = (s.required as string[]) || [];
		for (const p of props) if (!req.includes(p)) problems.push(`${path}.${p}: not required`);
	}
	for (const k of UNSUPPORTED) if (k in s) problems.push(`${path}: uses ${k}`);
	for (const [k, v] of Object.entries(s)) walk(v, `${path}.${k}`, problems);
}

const valid = (s: JsonSchema) => { const p: string[] = []; walk(s, "$", p); return p; };

describe("structured output schemas", () => {
	it("plan schema is API-safe", () => {
		expect(valid(planSchema())).toEqual([]);
	});
	it("plan schema is byte-identical on every call, so it stays cacheable", () => {
		// The schema is part of the cached prefix. It used to drop the reading
		// block once the reading was fixed, which made plan the one stage that
		// never got a cache hit; the prompt now asks for null instead.
		expect(JSON.stringify(planSchema())).toBe(JSON.stringify(planSchema()));
	});
	it("plan schema allows a null reading for calls after the first", () => {
		const reading = (planSchema().properties as Record<string, JsonSchema>).reading;
		expect(reading.anyOf).toBeDefined();
		expect((reading.anyOf as JsonSchema[]).some((x) => x.type === "null")).toBe(true);
	});
	it("solve and judge schemas are API-safe", () => {
		expect(valid(SOLVE_SCHEMA)).toEqual([]);
		expect(valid(JUDGE_SCHEMA)).toEqual([]);
	});
	it("judge verdict fields match what generate.ts reads", () => {
		const verdicts = (JUDGE_SCHEMA.properties as Record<string, JsonSchema>).verdicts;
		const item = (verdicts.items as JsonSchema).properties as Record<string, unknown>;
		expect(Object.keys(item).sort()).toEqual(["correct", "countFixed", "duplicateOf", "fails", "id", "rivals", "why"]);
	});
});
