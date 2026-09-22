import type { Difficulty, Question, PlanEntry, GenLog, GenAttempt, FetchBankResult, ReadingBlock, DroppedEntry, RunTotals } from "../types";
import { callModel, MODEL } from "./anthropic";
import { planSchema, SOLVE_SCHEMA, JUDGE_SCHEMA } from "./schemas";
import {
	bandText,
	norm,
	answerLeaks,
	enumeratesAnswerCount,
	answersCollide,
	selectPlan,
	parseObject,
	unpackContent,
	polish,
	numericValue
} from "../quiz-logic";

// The half of the boundary rules that never varies. Sent once as a cached
// system block; the topic-specific half stays in the per-call prompt, because
// caching is a prefix match and a topic at the top would defeat it.
const BOUNDARY_RULES = `Treat the topic as a boundary, not a theme. Read it the way the person who typed it meant it: a short, specific topic is a specification, and every question must sit inside it.
The test is the ANSWER, not the question. If the answer is a thing, person, place, date, term or number that belongs to the topic itself, the question is in. If the question merely mentions the topic on the way to an answer from a neighbouring subject, it is out. A question that names the topic and then asks who designed it, what happened next door, or which wider movement it belonged to is out, because the answer lives outside the topic.
Never widen a narrow topic to find variety.

Read the topic in the present tense unless it names a period or is inherently historical. A topic phrased as a thing (a drink, a cuisine, a sport, a craft, a city, a species) means that thing as it exists now: how it is made or done, what it is like, where it is found, what varieties and terms it has, who and what are associated with it today. Origins and history are one strand among several, not the default. Unless the topic names a period, no more than a quarter of the questions may be about how the topic began, who founded or invented it, or what it used to be.

Decide how many distinct members the topic has: people, works, events, places, terms. A range, a list, a period or a category is a set, however narrowly it is phrased.
If the topic has at least as many members as questions, each question must be about a different member. Distribute across the whole span, not the most famous or best-documented members.
If the topic has fewer members than questions, spread the questions across the members as evenly as you can, and vary what is asked about each.
Every answer in the set must be a different thing. Two questions whose answers are the same place, person, term or number under different names are one question asked twice.`;

// The topic-specific half: what changes per call, kept out of the cached block.
const BOUNDARY = (topic: string, others: string[]) => `The topic is: "${topic}".${others.length ? `\nOther players' topics in this same quiz, which your questions must not stray into and must not duplicate: ${others.map((o) => `"${o}"`).join(", ")}. Where this topic and one of those overlap, stay on the part that is only this topic.` : ""}`;

const CRAFT = `What makes a question worth asking:
- It gives a foothold proportionate to the difficulty. At easy, most of the table should be able to reason towards it. At hard, a narrow route in is enough, and only the enthusiast needs to be able to find it. At no level should a question be a bare memory test with no route in at all.
- The answer is satisfying when revealed. Either "of course" or "I didn't know that", never "if you say so". Prefer facts with a story, a surprise, a connection or a why behind them over bare dates and figures.
- It carries its own interest. Fold the striking detail into the question rather than saving it for the answer, so even the person who misses it learns something worth hearing read aloud.
- It asks one thing, in one sentence, and the answer is one thing. No "name both", no "and in what year".
- Numbers only when the number is the famous part. Nobody enjoys guessing the exact figure of a fact they had never heard of.
- Prefer the specific to the superlative. "Which planet's day is longer than its year?" beats "Which is the smallest planet?"
- The answer must not appear in the question in any form: not the word, not a word sharing its root, not an adjective made from it, not a translation of it. Naming the people to ask for their country, or the language to ask for its region, gives the answer away. Before finishing each question, check every word of the answer against the question and rewrite if any match.
- Do not state the complement of the answer, and do not set the answer up as the odd one out of a property you name. "Unlike the others, which still have speakers, this branch is...?" hands the answer over without using the word. If the reader could deduce the answer from the wording alone, it is not a question.
- Exactly one defensible answer. If several members share the property you are asking about, add the detail that singles one out, or ask something else. "Which branch stands alone with no close relative?" fails when three branches do.
- Never ask for the size of an open or debated set: how many languages, species, countries, works, members. Such counts depend on where lines are drawn and will be wrong for someone at the table. A count is acceptable only when it is fixed by definition (planets in the Solar System, players in a side) or is itself the famous fact.
- Specialist vocabulary counts toward difficulty. An answer is "jargon" if a general-interest newspaper would need to explain it to its readers (a technical term, a term of art, a name known only within the field); a jargon answer is never below level 4.`;

const FORMAT_GUIDE = (userFormat: string) => userFormat
	? `QUESTION FORMAT, FIXED BY THE PLAYER: every question must follow this pattern: "${userFormat}". Keep the pattern's wording and shape; vary only what it asks about. Report "format" as exactly the player's pattern.`
	: `QUESTION FORMAT. Decide, for this topic, whether the questions should be mixed in shape or should all follow one fixed pattern. Some topics are better with one pattern (flags: "which country's flag..."; capital cities: "what is the capital of..."; verb forms: "what is the ... of ..."), because the repetition lets the table settle into a rhythm and the variety lives in the answers. Most topics are better mixed: different angles (where, when, who, why, how many, what it is called, what it does) across the set, with no angle used for more than about a third of the questions. Report "format" as either "mixed" or "fixed: <the pattern>". Choose fixed only when you can name the pattern.`;

const DIFF_PROMPT: Record<Difficulty, string> = {
	Easy: `DIFFICULTY: EASY. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Easy means at least four of the five get it. These are the topic's headline facts: what a short encyclopedia entry on this exact topic states in its opening paragraphs, plus anything about it that has entered general culture. If a question requires having read about the topic, it is too hard for this level. No answer may be a specialist term: every answer must be a word or name that appears in general-interest newspapers without explanation. Rate each question 1 or 2 on a 1-5 scale; do not write anything you would rate 3 or above.`,
	Medium: `DIFFICULTY: MEDIUM. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Medium means the person who chose it gets about seven in ten and the others get about two in ten. These are facts a genuine enthusiast knows without looking up and a casual observer does not: the topic's own working detail rather than its headlines. Most answers must be everyday words, names, places or numbers. An answer that is a specialist term (one a general-interest newspaper would have to explain) is automatically a 4, never a 3, and there should be at most one such answer in the set; if you want to test the concept behind a specialist term at level 3, describe the concept and ask for something plain about it instead of asking for its name. Rate each question on a 1-5 scale. Most should be 3; a 2 or a 4 is fine where the topic offers a natural one, but 3 must be the most common rating in the set, and nothing may be 1 or 5.`,
	Hard: `DIFFICULTY: HARD. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Hard means the person who chose it gets about half and the others get almost none. These are the facts that reward having spent real time on this exact topic: the less-visited members, the detail behind the headlines, the thing a devotee is pleased to be asked. Harder means deeper into the same topic, never wider. Every answer must still be a single, verifiable, unambiguous fact; obscurity that cannot be checked is not difficulty. Rate each question 4 or 5 on a 1-5 scale; do not write anything you would rate 3 or below. If you find yourself writing a headline fact, replace it.`
};

const SPARES = 3;
const BATCH_PLAIN = 5;
const BATCH_SEARCH = 2;
// The route's maxDuration is 300s. Stop starting work at 240s so the last call
// (capped at 90s) plus the final stream flush land inside the ceiling rather
// than being killed mid-pipeline.
const BUDGET_MS = 240_000;
// No call is started with less than this left, because a call that cannot
// finish spends the flush headroom and returns nothing. Per stage, because the
// stages are not the same size: a measured plan call takes 45s (the figure
// anthropic.ts uses to rule out dividing the request timeout), so a 20s floor
// would start one that is certain to time out. Write carries search and can
// pause, so it gets the same room; solve and judge are single cheap calls.
const MIN_CALL_MS: Record<GenAttempt["stage"], number> = { plan: 50_000, write: 50_000, solve: 25_000, judge: 25_000 };

export interface FetchBankOpts {
	onStatus?: (s: string) => void;
	useSearch?: boolean;
	signal?: AbortSignal;
	otherTopics?: string[];
	existing?: Question[];
	format?: string;
}

// Phase 1 plans the whole set in one call: member, angle, answer, level,
// jargon for k+spares entries, with no question text. Answers and members are
// checked mechanically. Phase 2 writes questions for approved entries in
// batches, with search if on; each written question is checked for leaks and
// the answer is held to the plan. Returns { bank, log } (bank may be short).
export async function fetchBank(topic: string, k: number, difficulty: Difficulty, opts: FetchBankOpts = {}): Promise<FetchBankResult> {
	const { onStatus = () => {}, useSearch = true, signal, otherTopics = [], existing = [], format = "" } = opts;
	const log: GenLog = { topic, difficulty, attempts: [], search: useSearch, format: format || null, startedAt: new Date().toISOString() };
	// Everything identical across every call in this run, sent once as a cached
	// system block instead of being re-billed at full rate on each of them.
	// Difficulty is fixed for a run, so its prompt belongs here too.
	// The two concurrent topic workers start together, so both of their first
	// plan calls miss and both write the entry; the sharing pays from each
	// worker's second call onward, and for any topic beyond the opening pair.
	const cachedSystem = `${BOUNDARY_RULES}\n\n${CRAFT}\n\n${DIFF_PROMPT[difficulty]}`;
	// The platform kills the function at maxDuration and nothing written so far
	// survives that. Stop before the ceiling and return a short set instead,
	// which the UI already handles.
	const deadline = Date.now() + BUDGET_MS;
	const timeLeft = () => deadline - Date.now();
	// Not "any time left": a call needs room to be worth starting, or it spends
	// the flush headroom and returns nothing. See MIN_CALL_MS.
	const outOfTime = (stage: GenAttempt["stage"] = "plan") => timeLeft() <= MIN_CALL_MS[stage];
	// A call gets whatever is left, capped: never start one that cannot finish.
	const callTimeout = () => Math.max(0, Math.min(90_000, timeLeft()));
	// Fires at the deadline. callModel needs this as well as its timeout: a
	// timeout bounds one request, while this stops the backoff sleeps and the
	// retries between them, which are what let a call run past the budget.
	const deadlineCtrl = new AbortController();
	const deadlineTimer = setTimeout(() => deadlineCtrl.abort(), Math.max(0, timeLeft()));
	const deadlineSignal = deadlineCtrl.signal;
	// Any throw leaves this function past the clear on the return path (a cancel,
	// but also anything unexpected from the parsing helpers), and a timer left
	// pending holds the event loop open for the rest of the budget. Clearing it
	// on abort covers the cancel; abort() is the only throw the pipeline raises
	// deliberately, and the timer is harmless once fired in any case.
	signal?.addEventListener("abort", () => clearTimeout(deadlineTimer), { once: true });
	deadlineSignal.addEventListener("abort", () => clearTimeout(deadlineTimer), { once: true });
	const kept: Question[] = existing.slice(); // finished questions
	let pending: PlanEntry[] = []; // approved plan entries awaiting a question
	let members: number | null = null, relax = 0;
	let planCalls = 0, writeCalls = 0, emptyCalls = 0;
	// Entries that failed at write, solve or judge. The plan prompt lists them
	// as off limits and selectPlan rejects them mechanically, so a refill cannot
	// loop on the same dead entry.
	const dropped: DroppedEntry[] = [];
	const dropEntry = (it: PlanEntry, why: string) => { dropped.push({ subject: it.subject, angle: it.angle, a: it.a, why: why.slice(0, 120) }); };
	// Plan entries beyond what was needed, never examined. Re-validated and
	// promoted before paying for another plan call.
	let reserve: Record<string, unknown>[] = [];
	let spareNote: string | null = null;
	const abort = () => { if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" }); };
	const newAttempt = (stage: GenAttempt["stage"], asked: number): GenAttempt => {
		const a: GenAttempt = { stage, call: log.attempts.length + 1, asked, model: MODEL, status: null, apiError: null, stopReason: null, usage: null, rawHead: null, parse: null, validation: null, rateWaits: 0, startedAt: Date.now() };
		log.attempts.push(a);
		return a;
	};
	const finishAttempt = (a: GenAttempt) => { a.ms = Date.now() - a.startedAt; };
	const summary = () => [...kept, ...pending].map((x) => `${x.subject} · ${x.angle} · L${x.level}${x.jargon ? " · jargon" : ""}${x.q ? "" : " · planned"}${x.verified === false ? " · unverified" : ""}${x.solved === "in" ? " · solved" : x.solved === "unsolved" ? " · unsolved" : ""}${x.judged === "in" ? (x.judgeUnsure ? " · in (judge unsure of answer)" : " · in") : x.judged === "unjudged" ? " · unjudged" : ""}`);

	// ---- phase 1: plan ----
	async function plan(need: number) {
		abort();
		planCalls += 1;
		const used = [...kept, ...pending];
		const a = newAttempt("plan", need);
		onStatus(used.length ? `planning (${used.length}/${k})` : "planning");
		const readingBlock = log.reading
			? `THE READING OF THE TOPIC, already fixed for this round; plan against it exactly:
includes: ${log.reading.includes}
excludes: ${log.reading.excludes}
every answer must be: ${log.reading.answers}`
			: `FIRST, READ THE TOPIC AS A SPECIFICATION. Before planning anything, restate it in three lines as "reading": what it includes, what it explicitly or implicitly excludes (a parenthetical, a range, a qualifier, a "not ..." is a hard exclusion), and what kind of thing every answer must be (a branch, a person, a place, a term...). The reading describes the topic as typed and nothing else: not this call, not the questions already written. Plan only inside that reading. If the topic says "branches, not individual languages", no answer may be a language and no question may turn on one.`;
		// The difficulty table, the boundary rules and the craft notes arrive in
		// the cached system block; only what varies per call is repeated here.
		const prompt = `PLAN a quiz round. Do not write the questions yet.
${BOUNDARY(topic, otherTopics)}

${readingBlock}

${FORMAT_GUIDE(format)}

Produce ${need + SPARES} candidate entries for a set of ${k} questions (${need} are needed; the rest are spares in case some are rejected). Each entry must have exactly one defensible answer: if several members share the property, add the detail that singles one out, or choose another angle. Do not plan a count of an open or debated set. Do not plan two entries that rest on the same fact. For each entry give:
- "member": the member of the topic it is about, as a bare name with nothing in brackets
- "angle": in five words or fewer, what is being asked about that member (its location, when it split off, what it is called, why it happened...)
- "answer": the single, short, factual answer, exactly as it should be revealed. It must be a specific thing: a hedged or approximate answer ("very little", "about a tenth", "several") is not an answer and will be rejected
- "level": your honest 1-5 rating for the table above; every level must be ${bandText(difficulty)}
- "jargon": true if a general-interest newspaper would need to explain the answer, else false
Every answer must be a different thing; the same place, person or number under two names is a repeat.${used.length ? `\nAlready in the set, which you must not repeat (answer): ${used.map((u) => `${u.subject} → ${u.a}`).join("; ")}.${relax ? " The topic's members are nearly used up, so a second question about an already-used member is allowed if it asks something different." : " Do not reuse a member already listed."}` : ""}${dropped.length ? `\nTried earlier in this round and dropped. Do not propose these again, nor anything resting on the same fact: ${dropped.map((d) => `${d.subject} (${d.angle} → ${d.a}): ${d.why}`).join("; ")}.` : ""}
Also give "members", your estimate of how many distinct members the topic has, and "format" as instructed above${log.reading ? ', and "reading": null, because the reading is already fixed above and must not be restated' : ', and "reading" as instructed above'}.
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"reading":${log.reading ? "null" : '{"includes":"...","excludes":"...","answers":"..."}'},"members":<int>,"format":"mixed" or "fixed: <pattern>","plan":[{"member":"...","angle":"...","answer":"...","level":<1-5>,"jargon":<true|false>}]}`;
		const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a, thinking: "deep", schema: planSchema(), cachedSystem, timeoutMs: callTimeout(), deadlineSignal });
		finishAttempt(a);
		if (!data) { emptyCalls += 1; return; }
		const { text } = unpackContent(data.content || []);
		const { obj, complete } = parseObject(text, "plan");
		const entries = Array.isArray(obj.plan) ? obj.plan : [];
		a.parse = complete ? `ok (${entries.length} entries)` : data.stop_reason === "max_tokens" ? `salvaged ${entries.length} entries from a response cut off at the token limit` : `partial: ${entries.length} entries recovered from a response that was not valid JSON`;
		if (members === null && Number.isFinite(obj.members)) { const m = Number(obj.members); members = m; log.members = m; if (m < k) log.memberNote = `model estimated ${m} members for ${k} questions; repeats capped at ${Math.min(2, Math.ceil(k / m))} per member`; }
		if (obj.format && !log.formatDecided) log.formatDecided = String(obj.format);
		if (!log.reading && obj.reading && typeof obj.reading === "object") {
			const r = obj.reading as unknown as Record<string, unknown>;
			log.reading = { includes: String(r.includes || "").slice(0, 300), excludes: String(r.excludes || "").slice(0, 300), answers: String(r.answers || "").slice(0, 200) } satisfies ReadingBlock;
		}
		if (!entries.length) { a.rawHead = text.slice(0, 400); return; }
		const { chosen, rejected, spare } = selectPlan(entries, need, difficulty, [...kept, ...pending], members, k, relax, dropped);
		pending = [...pending, ...chosen];
		reserve = [...reserve, ...spare];
		// Every entry rejected, and only on caps: the topic is exhausted at this
		// cap. Loosen one notch for the next plan rather than let the round die.
		if (!chosen.length && rejected.length && rejected.every((r) => r.why.every((w) => /already used|specialist-term answer/.test(w))) && relax < 1) {
			relax += 1;
			log.acceptedWithProblems = [log.acceptedWithProblems, `topic exhausted at one question per member; allowing a second (and a second specialist term at medium) for the refill`].filter(Boolean).join("; ");
			a.relaxNote = "caps loosened for the next plan";
		}
		a.validation = rejected.length ? `rejected ${rejected.length}: ${rejected.map((r) => `${r.member}: ${r.why.join(", ")}`).join(" | ")}` : "all accepted";
		const angles = new Set([...kept, ...pending].map((x) => norm(x.angle)));
		if (!format && log.formatDecided === "mixed" && angles.size < Math.min(3, k)) log.acceptedWithProblems = [log.acceptedWithProblems, `plan declared mixed but uses ${angles.size} angle${angles.size === 1 ? "" : "s"}`].filter(Boolean).join("; ");
		a.subjects = summary();
	}

	// ---- phase 2: write ----
	const initialBatch = useSearch ? BATCH_SEARCH : BATCH_PLAIN;
	let batch = initialBatch;
	async function write() {
		abort();
		writeCalls += 1;
		const items = pending.slice(0, batch);
		const a = newAttempt("write", items.length);
		if (spareNote) { a.spareNote = spareNote; spareNote = null; }
		onStatus(`writing (${kept.length}/${k})`);
		// As in plan(): difficulty, boundary rules and craft come from the cached
		// system block, so only the topic and the entries are repeated per call.
		const prompt = `WRITE quiz questions for a plan that has already been approved.
${BOUNDARY(topic, otherTopics)}

${log.reading ? `THE READING OF THE TOPIC for this round:
includes: ${log.reading.includes}
excludes: ${log.reading.excludes}
every answer must be: ${log.reading.answers}
` : ""}
${format ? `QUESTION FORMAT, FIXED BY THE PLAYER: every question must follow this pattern: "${format}".` : log.formatDecided && log.formatDecided !== "mixed" ? `QUESTION FORMAT for this round: ${log.formatDecided}. Every question follows that pattern.` : "QUESTION FORMAT: mixed. Each entry's angle tells you what shape its question takes."}

${useSearch ? `VERIFY. You have a web search tool. For each entry, run at most one brief search to confirm the planned answer is correct and unambiguous. If the search shows the planned answer is wrong, contested, or one of several equally good answers, do not write a question for it: return that entry with "ok": false and a short "note". When you do confirm an answer, give "verified": true and "source": the title or URL of the page that confirmed it; "verified": true without a source will be treated as unverified. Keep your text between searches to a bare minimum; the JSON is the only thing that should appear in your final message.\n` : ""}Write one question for each entry below. The question must be about the given member, from the given angle, and its answer must be the planned answer: you may correct capitalisation or add acceptable alternate answers, but not change what the answer is. Keep each question under 35 words, one sentence, one thing asked. Use British spelling. The answer must not appear in the question in any form.
Entries:
${items.map((it, i) => `${i + 1}. member: ${it.subject}; angle: ${it.angle}; answer: ${it.a}; level ${it.level}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"questions":[{"id":<entry number>,"ok":<true|false>,"q":"question text","a":"the answer","alt":["acceptable alternates or empty"]${useSearch ? `,"verified":<true|false>,"source":"title or URL, only when verified"` : ""},"note":"only if ok is false"}]}`;
		const data = await callModel(prompt, { useSearch, maxUses: items.length * 2, signal, onStatus, a, thinking: "light", cachedSystem, timeoutMs: callTimeout(), deadlineSignal });
		finishAttempt(a);
		if (!data) { emptyCalls += 1; return; }
		const { text, searches, toolErrors, resultCount } = unpackContent(data.content || []);
		if (useSearch) { a.searches = searches.length ? `${searches.length} (${searches.map((q) => `"${q}"`).join(", ")}) → ${resultCount} results` : "none run"; if (toolErrors.length) a.toolErrors = toolErrors.join(", "); }
		const { obj, complete } = parseObject(text, "questions");
		const qs: Record<string, unknown>[] = Array.isArray(obj.questions) ? obj.questions : [];
		// Two ways a write call ends early with the JSON unfinished: the token
		// limit, and a search loop still paused after its continuations ran out.
		// Both leave a truncated response, and both want the same answer, a
		// smaller batch: maxUses scales with batch, so fewer entries means fewer
		// searches and less chance of pausing out again.
		const hitTokens = data.stop_reason === "max_tokens";
		const stillPaused = data.stop_reason === "pause_turn";
		const cutOff = hitTokens || stillPaused;
		const cutNote = hitTokens ? "cut off at the token limit" : "cut off with its searches unfinished";
		a.parse = complete ? `ok (${qs.length} returned)` : cutOff ? `salvaged ${qs.length} from a response ${cutNote}` : `partial: ${qs.length} recovered from a response that was not valid JSON`;
		if (cutOff) { const nb = Math.max(1, Math.min(batch - 1, qs.length || 1)); if (nb !== batch) { a.batchNote = `batch ${batch} → ${nb} (${hitTokens ? "cut off" : "searches unfinished"})`; batch = nb; } }
		else if (complete && batch < initialBatch) { a.batchNote = `batch ${batch} → ${batch + 1} (clean call)`; batch += 1; }
		if (!qs.length) { a.rawHead = text.slice(0, 400); return; }

		const droppedNotes: string[] = [], done = new Set<number>();
		for (const x of qs) {
			const id = Number(x.id);
			const it = items[id - 1];
			if (!it || done.has(id)) continue;
			done.add(id);
			const why: string[] = [];
			if (x.ok === false || String(x.ok).toLowerCase() === "false") why.push(`writer rejected: ${x.note || "no reason given"}`);
			const q = polish(x.q, "q"), aTxt = polish(x.a || it.a, "a");
			const alt = (Array.isArray(x.alt) ? x.alt : []).map((v: unknown) => polish(v, "a")).filter(Boolean);
			if (!why.length) {
				if (!q || q.length < 12) why.push("no question text");
				if (q.split(/\s+/).length > 45) why.push("over length");
				if (!answersCollide(aTxt, it.a)) why.push(`answer changed from plan ("${it.a}" → "${aTxt}")`);
				const leak = answerLeaks(q, [aTxt, ...alt], topic);
				if (leak) why.push(`answer "${leak}" is given away by the question`);
				if (enumeratesAnswerCount(q, aTxt)) why.push("the question lists the things it asks to count");
			}
			// alternates must not collide with any other kept answer
			const others = [...kept, ...pending.filter((p) => p !== it)];
			const cleanAlt = alt.filter((v: string) => !others.some((o) => answersCollide(o.a, v)));
			if (why.length) { droppedNotes.push(`${it.subject}: ${why.join(", ")}`); dropEntry(it, why.join(", ")); pending = pending.filter((p) => p !== it); continue; }
			const source = String(x.source || "").trim().slice(0, 160) || null;
			const claimed = x.verified === true || String(x.verified).toLowerCase() === "true";
			const verified = useSearch ? (claimed && !!source) : null;
			if (useSearch && claimed && !source) a.sourceNote = [a.sourceNote, `${it.subject}: claimed verified with no source; recorded as unverified`].filter(Boolean).join("; ");
			kept.push({ ...it, q, a: aTxt, alt: cleanAlt, verified, source: verified ? source : null });
			pending = pending.filter((p) => p !== it);
		}
		// entries the writer ignored stay pending for the next write call
		a.validation = droppedNotes.length ? `dropped ${droppedNotes.length}: ${droppedNotes.join(" | ")}` : "all kept";
		a.subjects = summary();
	}

	// ---- phase 3: judge ----
	// One cheap call over the written questions not yet judged. The test is the
	// topic as typed, not the words in it: a question passes only if its answer
	// belongs to the topic as the person who wrote the topic meant it.
	let judgeCalls = 0;
	async function judge() {
		abort();
		judgeCalls += 1;
		const items = kept.filter((x) => !x.judged);
		if (!items.length) return;
		const a = newAttempt("judge", items.length);
		onStatus(`checking against the topic (${kept.length}/${k})`);
		const prompt = `JUDGE a set of quiz questions against their topic. You are not writing or improving anything; you are deciding, for each question, whether it belongs and whether it works. You have no search; answer from knowledge, and say when you are unsure.
The topic, exactly as the player typed it: "${topic}".${otherTopics.length ? `\nOther players' topics in the same quiz, which this topic's questions must not stray into: ${otherTopics.map((o) => `"${o}"`).join(", ")}.` : ""}${format ? `\nThe player fixed the question format: every question must follow the pattern "${format}".` : ""}
${log.reading ? `The reading of the topic used to write these questions:\nincludes: ${log.reading.includes}\nexcludes: ${log.reading.excludes}\nevery answer must be: ${log.reading.answers}\nCheck that reading against the topic as typed first; if the reading missed an exclusion the topic states, apply the topic, not the reading.` : `First, read the topic as a specification: what it includes, what it explicitly or implicitly excludes (a parenthetical, a range, a qualifier, a "not ..." is a hard exclusion), and what kind of thing every answer must be.`}
STEP 1. Write out the topic's constraints as a numbered list, "constraints", one per line, each a single testable statement (C1 "the answer is a branch, not a language", C2 "the question is about a difference between branches", C3 "no answer is a count of an open set"...). Include a constraint for every exclusion the topic states and for the kind of thing an answer must be.
STEP 2. For every question, go through every constraint in turn and list in "fails" the ids of the constraints it breaks. Do this constraint by constraint; do not form an overall impression first.
STEP 3. Also give:
- "correct": "yes", "no" or "unsure". Say "no" when you are confident the given answer is wrong, or when it rests on a contested definition.
- "countFixed": for a numeric answer only: true if the count is fixed by definition or is itself the famous fact, false if it depends on where lines are drawn (how many languages, dialects, species, works). A false here is a failure.
- "duplicateOf": the id of an earlier question this one rests on the same fact as, or is answered by the same reasoning as; otherwise null. Only the later of a pair is marked.
- "rivals": some questions list candidate answers that a blind solver produced without seeing ours. For each, say "same" (another name or wording for our answer), "real" (a genuinely different answer the question as worded does not rule out, so the question is ambiguous), or "wrong" (not a defensible answer). Where the solver's own best answer differs from ours, treat it as a candidate too.
Be strict about the constraints, correctness and real rivals; lenient about style, difficulty and phrasing. On a broad topic, a question on any part of it is in.
Questions:
${items.map((it, i) => `${i + 1}. Q: ${it.q} A: ${it.a}${it.alt?.length ? ` (also: ${it.alt.join(", ")})` : ""}${(it.solverRivals?.length || it.solverDiffers) ? ` | candidates from a blind solver: ${[...(it.solverDiffers ? [it.solverBest] : []), ...(it.solverRivals || [])].filter(Boolean).join("; ")}` : ""}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"constraints":["C1 ...","C2 ..."],"verdicts":[{"id":<number>,"fails":["C2"],"correct":"yes"|"no"|"unsure","countFixed":<true|false|null>,"duplicateOf":<number or null>,"rivals":[{"name":"...","verdict":"same"|"real"|"wrong"}],"why":"twelve words at most, only when something fails"}]}`;
		const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a, thinking: "deep", schema: JUDGE_SCHEMA, cachedSystem, timeoutMs: callTimeout(), deadlineSignal });
		finishAttempt(a);
		if (!data) { emptyCalls += 1; return; }
		const { text } = unpackContent(data.content || []);
		const { obj, complete } = parseObject(text, "verdicts");
		const vs: Record<string, unknown>[] = Array.isArray(obj.verdicts) ? obj.verdicts : [];
		a.parse = complete ? `ok (${vs.length} verdicts)` : `partial: ${vs.length} verdicts recovered`;
		if (!vs.length) { a.rawHead = text.slice(0, 400); items.forEach((it) => { it.judged = "unjudged"; }); a.validation = "no verdicts; questions kept unjudged"; return; }
		if (Array.isArray(obj.constraints) && obj.constraints.length && !log.judgeConstraints) log.judgeConstraints = obj.constraints.map(String).slice(0, 8);
		const out: string[] = [];
		const bool = (v: unknown) => v === true || String(v).toLowerCase() === "true";
		for (const v of vs) {
			const it = items[Number(v.id) - 1];
			if (!it) continue;
			const fails: string[] = [];
			const broke = (Array.isArray(v.fails) ? v.fails : []).map(String).filter(Boolean);
			if (broke.length) fails.push(`breaks ${broke.join(", ")}`);
			if (v.in !== undefined && !bool(v.in)) fails.push("outside the topic");
			if (String(v.correct || "").toLowerCase() === "no") fails.push("answer judged wrong");
			if (numericValue(it.a) !== null && v.countFixed !== undefined && v.countFixed !== null && !bool(v.countFixed)) fails.push("count of an open set");
			const dup = Number(v.duplicateOf);
			if (Number.isFinite(dup) && dup > 0 && dup < Number(v.id) && items[dup - 1]) fails.push(`duplicate of ${items[dup - 1].subject}`);
			const rv = (Array.isArray(v.rivals) ? v.rivals : []).map((r: Record<string, unknown>) => ({ name: String(r?.name || ""), verdict: String(r?.verdict || "").toLowerCase() }));
			const real = rv.filter((r) => r.verdict === "real").map((r) => r.name).filter(Boolean);
			if (real.length) fails.push(`ambiguous; also defensible: ${real.slice(0, 3).join(", ")}`);
			// The solver's own answer differed and the judge did not call it wrong or the same: treat as contested.
			if (it.solverDiffers && !rv.some((r) => answersCollide(r.name, it.solverBest as string) && r.verdict !== "real") && String(v.correct || "").toLowerCase() !== "yes") fails.push(`blind solver answered "${it.solverBest}" and the judge did not confirm ours`);
			it.rivalVerdicts = rv;
			it.judged = fails.length ? "out" : "in";
			if (String(v.correct || "").toLowerCase() === "unsure") it.judgeUnsure = true;
			if (fails.length) { it.judgeNote = `${fails.join("; ")}${v.why ? `: ${String(v.why).slice(0, 120)}` : ""}`; out.push(`${it.subject}: ${it.judgeNote}`); }
		}
		items.filter((it) => !it.judged).forEach((it) => { it.judged = "unjudged"; });
		const before = kept.length;
		for (let i = kept.length - 1; i >= 0; i--) if (kept[i].judged === "out") { dropEntry(kept[i], kept[i].judgeNote || "judged out"); kept.splice(i, 1); }
		a.validation = out.length ? `out ${before - kept.length}: ${out.join(" | ")}` : "all in";
		a.subjects = summary();
	}

	// ---- phase 3a: solve ----
	// Questions only, no answers. The model is asked what the answers are, not
	// whether ours is right: listing rivals is a task it does well, certifying
	// uniqueness is one it does badly. Comparison to the plan is mechanical.
	let solveCalls = 0;
	async function solve() {
		abort();
		solveCalls += 1;
		const items = kept.filter((x) => !x.solved);
		if (!items.length) return;
		const a = newAttempt("solve", items.length);
		onStatus(`solving blind (${kept.length}/${k})`);
		const prompt = `SOLVE these quiz questions. You are given the questions only. For each one:
- "best": the answer you would give, as briefly as it would be said at a table
- "candidates": every MATERIALLY DIFFERENT answer a well-informed person could defend for the question as worded, including "best". Two names for the same thing are one candidate: list the thing once, under its commonest name. A candidate is something that would make a different player right. Include one only if the wording fails to rule it out
- "fromWording": true if the answer can be worked out from the question's own wording without knowing the subject (the items are listed and you are asked to count them, the answer's complement is stated, the answer is described in other words)
- "confidence": "high", "medium" or "low" that "best" is correct
Answer from knowledge; you have no search. Do not comment on the questions. Topic, for context only: "${topic}".
Questions:
${items.map((it, i) => `${i + 1}. ${it.q}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"solutions":[{"id":<number>,"best":"...","candidates":["..."],"fromWording":<true|false>,"confidence":"high"|"medium"|"low"}]}`;
		const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a, thinking: "light", schema: SOLVE_SCHEMA, cachedSystem, timeoutMs: callTimeout(), deadlineSignal });
		finishAttempt(a);
		if (!data) { emptyCalls += 1; return; }
		const { text } = unpackContent(data.content || []);
		const { obj, complete } = parseObject(text, "solutions");
		const sols: Record<string, unknown>[] = Array.isArray(obj.solutions) ? obj.solutions : [];
		a.parse = complete ? `ok (${sols.length} solutions)` : `partial: ${sols.length} solutions recovered`;
		if (!sols.length) { a.rawHead = text.slice(0, 400); items.forEach((it) => { it.solved = "unsolved"; }); a.validation = "no solutions; questions kept unsolved"; return; }
		const bool = (v: unknown) => v === true || String(v).toLowerCase() === "true";
		const out: string[] = [], noted: string[] = [];
		for (const v of sols) {
			const it = items[Number(v.id) - 1];
			if (!it) continue;
			const mine = [it.a, ...(it.alt || [])];
			const best = String(v.best || "").trim();
			const cands = (Array.isArray(v.candidates) ? v.candidates : []).map((c: unknown) => String(c).trim()).filter(Boolean);
			const matches = (x: string) => mine.some((m) => answersCollide(m, x));
			const rivals = cands.filter((c) => !matches(c));
			// The solver only drops on the one thing it can see for itself: the
			// answer being in the wording. Rivals and a differing best answer are
			// recorded and handed to the judge, which has the planned answer and
			// can tell a synonym from a second answer.
			const fails: string[] = [];
			if (bool(v.fromWording)) fails.push("answerable from the wording");
			it.solved = fails.length ? "out" : "in";
			it.solverBest = best; it.solverCandidates = cands; it.solverRivals = rivals.slice(0, 4); it.solverDiffers = !!best && !matches(best); it.solverConfidence = String(v.confidence || "");
			if (fails.length) { it.judgeNote = fails.join("; "); out.push(`${it.subject}: ${it.judgeNote}`); }
			else if (rivals.length || it.solverDiffers) noted.push(`${it.subject}: ${it.solverDiffers ? `solver said "${best}"` : ""}${rivals.length ? `${it.solverDiffers ? "; " : ""}possible rivals ${rivals.slice(0, 3).join(", ")}` : ""} (for the judge)`);
		}
		items.filter((it) => !it.solved).forEach((it) => { it.solved = "unsolved"; });
		const before = kept.length;
		for (let i = kept.length - 1; i >= 0; i--) if (kept[i].solved === "out") { dropEntry(kept[i], kept[i].judgeNote || "answerable from the wording"); kept.splice(i, 1); }
		a.validation = [out.length ? `out ${before - kept.length}: ${out.join(" | ")}` : "all solvable", noted.length ? `noted: ${noted.join(" | ")}` : ""].filter(Boolean).join(" · ");
		a.subjects = summary();
	}

	// Before paying for a plan call, re-validate the spares from earlier plans
	// against the current set and promote whatever still passes.
	function promoteSpares(need: number) {
		if (!reserve.length) return;
		const r = selectPlan(reserve, need, difficulty, [...kept, ...pending], members, k, relax, dropped);
		reserve = r.spare;
		if (!r.chosen.length) return;
		pending = [...pending, ...r.chosen];
		spareNote = `${r.chosen.length} promoted from spares instead of a plan call`;
	}

	const maxPlan = 4, maxWrite = Math.ceil(k / initialBatch) + 6, maxEmpty = 4, maxJudge = 3, maxSolve = 3;
	while (emptyCalls < maxEmpty) {
		// Call caps bound the work, not the clock. Without this the pipeline can
		// still be mid-stage when the platform kills the function, which loses
		// every question already written; stopping here keeps them.
		// The cheapest stage sets the floor here; each branch below re-checks
		// against its own, since a plan call needs far more room than a judge.
		if (outOfTime("judge")) { log.timedOut = true; break; }
		if (kept.length < k) {
			if (!pending.length) promoteSpares(k - kept.length);
			if (!pending.length) {
				if (planCalls >= maxPlan) break;
				if (outOfTime("plan")) { log.timedOut = true; break; }
				await plan(k - kept.length);
				if (!pending.length) continue;
			}
			if (writeCalls >= maxWrite) break;
			if (outOfTime("write")) { log.timedOut = true; break; }
			await write();
			continue;
		}
		// full set written: solve blind, then judge against the topic; loop if either shrank it
		if (kept.some((x) => !x.solved) && solveCalls < maxSolve) {
			if (outOfTime("solve")) { log.timedOut = true; break; }
			await solve(); continue;
		}
		if (kept.some((x) => !x.judged) && judgeCalls < maxJudge) { await judge(); continue; }
		break;
	}
	// If the call budget ran out before the checks, run each once more if allowed
	// and if the clock still permits it.
	if (kept.some((x) => !x.solved) && solveCalls < maxSolve && emptyCalls < maxEmpty && !outOfTime("solve")) await solve();
	if (kept.some((x) => !x.judged) && judgeCalls < maxJudge && emptyCalls < maxEmpty && !outOfTime("judge")) await judge();

	if (difficulty === "Medium" && k >= 3 && kept.length >= 3) {
		const cnt = (l: number) => kept.filter((x) => x.level === l).length;
		if (cnt(3) < cnt(2) || cnt(3) < cnt(4)) log.acceptedWithProblems = [log.acceptedWithProblems, `medium set is not mostly level 3 (${cnt(2)}×2, ${cnt(3)}×3, ${cnt(4)}×4)`].filter(Boolean).join("; ");
	}
	// Nothing else is started from here, so the timer has no one left to stop;
	// leaving it pending would hold the event loop open past the response.
	clearTimeout(deadlineTimer);
	// A call abandoned mid-flight against the budget counts as a timed-out run
	// just as much as the loop guard refusing to start the next one.
	if (log.attempts.some((x) => x.timedOut)) log.timedOut = true;
	if (dropped.length) log.dropped = dropped;
	// Per-attempt usage was already logged; this makes the cost of a whole run
	// visible in one place, which is what the caching change has to be judged on.
	log.totals = log.attempts.reduce<RunTotals>((t, x) => ({
		calls: t.calls + 1,
		inputTokens: t.inputTokens + (x.tokens?.input ?? 0),
		outputTokens: t.outputTokens + (x.tokens?.output ?? 0),
		cacheWriteTokens: t.cacheWriteTokens + (x.tokens?.cacheWrite ?? 0),
		cacheReadTokens: t.cacheReadTokens + (x.tokens?.cacheRead ?? 0),
		thinkingTokens: t.thinkingTokens + (x.tokens?.thinking ?? 0),
		searches: t.searches + (x.tokens?.searches ?? 0),
		ms: t.ms + (x.ms ?? 0)
	}), { calls: 0, inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, thinkingTokens: 0, searches: 0, ms: 0 });
	log.shortfall = Math.max(0, k - kept.length);
	log.finishedAt = new Date().toISOString();
	onStatus(kept.length >= k ? "done" : kept.length ? `short (${kept.length}/${k})` : "failed");
	return { bank: kept.slice(0, k), log };
}
