export type Difficulty = "Easy" | "Medium" | "Hard";

export type ModeKey = "solo" | "turns" | "buzzer";
export type WinKey = "count" | "target" | "highest" | "race" | "coop";

export interface ModeDef {
	label: string;
	min: number;
	max: number;
	blurb: string;
}

export interface WinDef {
	label: string;
	min: number;
	max: number;
	blurb: string;
}

export interface Player {
	name: string;
	topic: string;
	difficulty: Difficulty;
	format: string;
}

export interface NamedPlayer extends Player {
	name: string;
	topic: string;
	format: string;
}

// PlanEntry and Question are derived from the Zod schemas in
// question-schema.ts, so the validation the API route runs and the types the
// app compiles against cannot drift apart. `import type` keeps zod out of the
// client bundle: this module is imported by Svelte components.
export type { PlanEntry, Question } from "./question-schema";
import type { PlanEntry, Question } from "./question-schema";

export interface ScheduleEntry extends Question {
	topic: number;
	reader: number;
	answerer: number | null;
	i: number;
}

export interface PlanRejection {
	member: string;
	answer: string;
	why: string[];
}

export interface SelectPlanResult {
	chosen: PlanEntry[];
	rejected: PlanRejection[];
	spare: Record<string, unknown>[];
}

// A plan entry that failed after planning (at write, solve or judge), kept so
// the next plan call neither proposes it again nor has it accepted.
export interface DroppedEntry {
	subject: string;
	angle: string;
	a: string;
	why: string;
}

export interface ReadingBlock {
	includes: string;
	excludes: string;
	answers: string;
}

export interface GenAttempt {
	stage: "plan" | "write" | "judge" | "solve";
	call: number;
	asked: number;
	model: string;
	status: number | null;
	apiError: string | null;
	stopReason: string | null;
	usage: string | null;
	// The same figures unformatted, so a run can be totalled without reparsing
	// the display string.
	tokens?: { input: number; output: number; cacheWrite: number; cacheRead: number; thinking: number; searches: number };
	rawHead: string | null;
	parse: string | null;
	validation: string | null;
	rateWaits: number;
	startedAt: number;
	ms?: number;
	searches?: string;
	toolErrors?: string;
	sourceNote?: string;
	pauses?: number;
	batchNote?: string;
	relaxNote?: string;
	spareNote?: string;
	transportRetry?: string;
	subjects?: string[];
	// The call was abandoned against the pipeline's time budget rather than
	// failing on its own merits.
	timedOut?: boolean;
}

export interface RunTotals {
	calls: number;
	inputTokens: number;
	outputTokens: number;
	// Cache writes cost ~1.25x and reads ~0.1x of base input price, so the two
	// are tracked apart from plain input tokens.
	cacheWriteTokens: number;
	cacheReadTokens: number;
	// Part of outputTokens, broken out: it is what a thinking setting costs.
	thinkingTokens: number;
	searches: number;
	ms: number;
}

export interface GenLog {
	topic: string;
	difficulty?: Difficulty;
	attempts: GenAttempt[];
	search?: boolean;
	format?: string | null;
	startedAt?: string;
	finishedAt?: string;
	members?: number;
	memberNote?: string;
	formatDecided?: string;
	reading?: ReadingBlock;
	judgeConstraints?: string[];
	acceptedWithProblems?: string;
	dropped?: DroppedEntry[];
	shortfall?: number;
	// Set when the run stopped against its wall-clock budget rather than
	// finishing or exhausting its call caps.
	timedOut?: boolean;
	// Whole-run token totals, summed from the per-call usage. Per-attempt
	// figures alone made the cost of a run visible only one call at a time.
	totals?: RunTotals;
	fatal?: string;
	cancelled?: boolean;
	reused?: boolean;
	toppedUp?: number;
}

export interface FetchBankResult {
	bank: Question[];
	log: GenLog;
}

export interface SelfTestResult {
	name: string;
	ok: boolean;
	detail?: string;
}

export type EndedBy = "questions" | "race" | "coop" | "table" | null;

export interface PlayEvent {
	i: number;
	who?: number | null;
	pts?: number;
	viaSteal?: boolean;
	void?: boolean;
	at: string;
}

export interface HistorySnapshot {
	idx: number;
	scores: number[];
	faced: number[];
	plays: PlayEvent[];
	endedBy: EndedBy;
	raceWinner: number | null;
}

export type Flags = Record<number, string[]>;

export type Phase = "setup" | "loading" | "short" | "handoff" | "question" | "done" | "error";

export interface ParsedPlanObject {
	reading?: ReadingBlock;
	members?: number;
	format?: string;
	plan?: Record<string, unknown>[];
	questions?: Record<string, unknown>[];
	verdicts?: Record<string, unknown>[];
	solutions?: Record<string, unknown>[];
	constraints?: string[];
}
