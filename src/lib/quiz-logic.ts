import type {
	Difficulty,
	ModeDef,
	ModeKey,
	WinDef,
	WinKey,
	PlanEntry,
	PlanRejection,
	SelectPlanResult,
	DroppedEntry,
	ScheduleEntry,
	Question,
	SelfTestResult,
	ParsedPlanObject
} from "./types";

export const MODES: Record<ModeKey, ModeDef> = {
	solo: { label: "Solo", min: 1, max: 1, blurb: "You read, you answer, you mark yourself. No cheating; nobody's watching." },
	turns: { label: "Turns", min: 2, max: 5, blurb: "One player answers each question while another reads it. Pairings rotate." },
	buzzer: { label: "First to shout", min: 3, max: 5, blurb: "One player reads; everyone else races to answer. Needs three so the race is a race." }
};

export const WINS: Record<WinKey, WinDef> = {
	count: { label: "Just count", min: 1, max: 5, blurb: "No target, no winner declared. Play the questions and see how you did." },
	target: { label: "Hit a target", min: 1, max: 1, blurb: "Reach a set number of correct answers." },
	highest: { label: "Highest score", min: 2, max: 5, blurb: "Most points when the questions run out." },
	race: { label: "Race to a score", min: 2, max: 5, blurb: "First to reach the target wins on the spot. The quiz may end early." },
	coop: { label: "Team target", min: 2, max: 5, blurb: "Everyone against the quiz. Pooled score must reach the target." }
};

export const DIFFS: Difficulty[] = ["Easy", "Medium", "Hard"];
export const BAD_REASONS = ["Wrong answer", "Off topic", "Too easy", "Too hard", "Answer given away", "Ambiguous", "Other"];

export const DIFF_BAND: Record<Difficulty, [number, number]> = { Easy: [1, 2], Medium: [2, 4], Hard: [4, 5] };
export const bandText = (d: Difficulty): string => {
	const [lo, hi] = DIFF_BAND[d];
	return d === "Medium" ? "between 2 and 4, with 3 the most common" : `${lo} or ${hi}`;
};

// ---------- pure helpers (self-tested below) ----------
export const norm = (s: unknown): string => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
export const same = (a: string, b: string): boolean => a === b || (b.startsWith(a) && b[a.length] === " ") || (a.startsWith(b) && a[b.length] === " ");
export const hasNonLatin = (s: unknown): boolean => /[^\u0000-\u024F\u1E00-\u1EFF\s\p{P}\p{N}]/u.test(String(s || ""));
export const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

const STOP = new Set(["the", "and", "of", "in", "a", "an", "to", "for", "with", "from", "by", "on", "at", "or", "is", "was", "were", "its", "into", "that", "this", "which", "what", "who", "how", "when", "where", "why", "did", "does", "do", "as", "are", "be", "been", "it", "not", "one", "two", "first", "early", "late", "new", "old", "north", "south", "east", "west", "between", "their", "them", "they", "about", "most", "more", "some", "very", "also", "than", "then", "only", "just", "over", "under"]);
const sigWords = (t: unknown): string[] => norm(t).split(" ").filter((w) => w && w.length >= 4 && !STOP.has(w));

// Does the question give the whole answer away? Every distinctive word of the
// answer (stem-matched) present in the question. Topic words are exempt.
// A question word counts if it starts with the answer word's stem: for a
// five-letter stem that is the usual stem match; for a four-letter answer
// word it also catches "landless" giving away "land".
export function answerLeaks(q: string, answers: string[], topic: string): string | null {
	const topicStems = new Set(sigWords(topic).map((w) => w.slice(0, 5)));
	const qWords = norm(q).split(" ").filter(Boolean);
	for (const ans of answers) {
		const sig = sigWords(ans).map((w) => w.slice(0, 5)).filter((st) => !topicStems.has(st));
		if (!sig.length) continue;
		if (sig.every((st) => qWords.some((w) => w.startsWith(st)))) return ans;
	}
	return null;
}

// A numeric answer whose question lists at least that many items is a
// counting exercise, not a question. "How many groups, including A, B, C and
// D?" -> four. Items are taken from the clause after including/such as/namely,
// or from any run of comma-separated capitalised terms.
const NUM_WORDS: Record<string, string> = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20" };
export const normAnswer = (a: unknown): string => norm(a).split(" ").filter(Boolean).map((w) => NUM_WORDS[w] || w).filter((w) => !STOP.has(w)).join(" ");
export const numericValue = (a: string): number | null => { const n = normAnswer(a); const m = n.match(/^(\d+)(?: |$)/); return m ? Number(m[1]) : null; };
export function enumeratesAnswerCount(q: string, a: string): boolean {
	const n = numericValue(a);
	if (n === null || n < 2) return false;
	const text = String(q || "");
	const clause = (text.match(/(?:including|such as|namely|like|comprising|consisting of)\s+([^?.;:]+)/i) || [])[1];
	const count = (str: string) => str.split(/,|\band\b|\bor\b|&/).map((x) => x.trim()).filter(Boolean).length;
	if (clause && count(clause) >= n) return true;
	const runs = text.match(/(?:[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*)(?:,\s*(?:[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*))+(?:,?\s*(?:and|or)\s*[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*)?/g) || [];
	return runs.some((r) => count(r) >= n);
}

// Two topics that are the same or largely overlap.
export function topicOverlap(a: string, b: string): "same" | "overlap" | null {
	const na = norm(a), nb = norm(b);
	if (!na || !nb) return null;
	if (na === nb) return "same";
	const sa = new Set(sigWords(a).map((w) => w.slice(0, 5))), sb = new Set(sigWords(b).map((w) => w.slice(0, 5)));
	if (!sa.size || !sb.size) return null;
	const inter = [...sa].filter((x) => sb.has(x)).length;
	const smaller = Math.min(sa.size, sb.size);
	return inter / smaller >= 0.5 ? "overlap" : null;
}

interface SalvageResult {
	members?: number;
	questions: PlanEntry[];
	complete: boolean;
}

// Recover complete question objects from a JSON response that may have been cut
// off. String-aware bracket scan; each complete top-level object is parsed.
export function salvageQuestions(text: string): SalvageResult {
	const clean = text.replace(/```json|```/g, "").trim();
	try {
		const st = clean.indexOf("{"), en = clean.lastIndexOf("}");
		const full = JSON.parse(clean.slice(st, en + 1));
		if (Array.isArray(full.questions)) return { members: full.members, questions: full.questions, complete: true };
	} catch {
		/* fall through */
	}
	const mMatch = clean.match(/"members"\s*:\s*(\d+)/);
	const members = mMatch ? Number(mMatch[1]) : undefined;
	const qi = clean.indexOf('"questions"');
	const arr = qi >= 0 ? clean.indexOf("[", qi) : -1;
	const out: PlanEntry[] = [];
	if (arr >= 0) {
		let depth = 0, inStr = false, esc = false, objStart = -1;
		for (let i = arr + 1; i < clean.length; i++) {
			const ch = clean[i];
			if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
			if (ch === '"') { inStr = true; continue; }
			if (ch === "{") { if (depth === 0) objStart = i; depth++; }
			else if (ch === "}") { depth--; if (depth === 0 && objStart >= 0) { try { out.push(JSON.parse(clean.slice(objStart, i + 1))); } catch { /* skip */ } objStart = -1; } }
			else if (ch === "]" && depth === 0) break;
		}
	}
	return { members, questions: out, complete: false };
}

// Structural, not the SDK's type: this module is shared with the client, and
// importing the SDK here would follow it into the browser bundle. Kept loose
// enough to accept the SDK's block union, which is a discriminated type whose
// `input` is `unknown` and whose text-bearing members vary by block.
interface ContentBlock {
	type: string;
	text?: string;
	input?: unknown;
	content?: unknown;
}

interface UnpackedContent {
	text: string;
	searches: string[];
	toolErrors: string[];
	resultCount: number;
}

// Pull the pieces out of a tool-using response by block type.
export function unpackContent(content: ContentBlock[]): UnpackedContent {
	const text = content.filter((b) => b.type === "text").map((b) => b.text || "").join("\n");
	const searches = content
		.filter((b) => b.type === "server_tool_use")
		.map((b) => (b.input as { query?: string } | undefined)?.query || "(no query)");
	const results = content.filter((b) => b.type === "web_search_tool_result");
	const toolErrors = results
		.map((r) => {
			const c = r.content as { type?: string; error_code?: string } | undefined;
			return c && !Array.isArray(c) && c.type === "web_search_tool_result_error" ? c.error_code ?? null : null;
		})
		.filter((x): x is string => Boolean(x));
	const resultCount = results.reduce((n, r) => n + (Array.isArray(r.content) ? r.content.length : 0), 0);
	return { text, searches, toolErrors, resultCount };
}

// Title case for headings. Small words stay lower unless first or last; words
// with their own capitals (AD, McCoy) are left alone.
const TC_SMALL = new Set(["a", "an", "the", "and", "but", "or", "nor", "for", "so", "yet", "at", "by", "in", "of", "on", "to", "up", "as", "per", "via", "from", "with", "into", "over", "off", "than", "its"]);
export function tc(str: string): string {
	const words = String(str).split(/(\s+)/);
	const isWord = (w: string) => /\S/.test(w);
	const idxs = words.map((w, i) => (isWord(w) ? i : -1)).filter((i) => i >= 0);
	const first = idxs[0], last = idxs[idxs.length - 1];
	return words.map((w, i) => {
		if (!isWord(w)) return w;
		if (/[A-Z]/.test(w.slice(1))) return w; // has internal capitals: leave
		const lower = w.toLowerCase();
		const cap = (x: string) => x.replace(/^([("']*)(\p{L})/u, (_, p, c) => p + c.toUpperCase());
		if (i !== first && i !== last && TC_SMALL.has(lower.replace(/[^\p{L}']/gu, ""))) return lower;
		return cap(lower).replace(/-(\p{L})/gu, (_, c) => "-" + c.toUpperCase());
	}).join("");
}

// Deterministic tidy-up of generated question and answer text. Quick and
// dirty by design: em dashes, Oxford commas, American spellings and the
// commoner throat-clearing openers. Anything subtler needs a model.
const US_UK: Record<string, string> = {
	color: "colour", colors: "colours", colored: "coloured", colorful: "colourful", honor: "honour", honors: "honours", honored: "honoured", favor: "favour", favors: "favours", favored: "favoured", favorite: "favourite", favorites: "favourites",
	labor: "labour", neighbor: "neighbour", neighbors: "neighbours", neighboring: "neighbouring", neighborhood: "neighbourhood", humor: "humour", behavior: "behaviour", behaviors: "behaviours", harbor: "harbour", harbors: "harbours", armor: "armour", flavor: "flavour", flavors: "flavours",
	rumor: "rumour", rumors: "rumours", vapor: "vapour", vigor: "vigour", valor: "valour", savior: "saviour", endeavor: "endeavour", center: "centre", centers: "centres", centered: "centred", theater: "theatre", theaters: "theatres", liter: "litre", liters: "litres", fiber: "fibre", fibers: "fibres",
	defense: "defence", defenses: "defences", offense: "offence", pretense: "pretence", gray: "grey", catalog: "catalogue", catalogs: "catalogues", dialog: "dialogue", traveled: "travelled", traveler: "traveller", travelers: "travellers", traveling: "travelling", canceled: "cancelled", canceling: "cancelling",
	jewelry: "jewellery", aluminum: "aluminium", mold: "mould", molds: "moulds", sulfur: "sulphur", pajamas: "pyjamas", cozy: "cosy", plow: "plough", skeptic: "sceptic", skeptical: "sceptical", skepticism: "scepticism", artifact: "artefact", artifacts: "artefacts", ax: "axe", math: "maths", airplane: "aeroplane", airplanes: "aeroplanes",
	mustache: "moustache", pediatric: "paediatric", specialty: "speciality", enrollment: "enrolment", fulfill: "fulfil", skillful: "skilful", installment: "instalment", judgment: "judgement", gotten: "got", railroad: "railway", railroads: "railways", gasoline: "petrol", sidewalk: "pavement", vacation: "holiday", elevator: "lift", eggplant: "aubergine", zucchini: "courgette", cilantro: "coriander", arugula: "rocket",
	movie: "film", movies: "films", diaper: "nappy", faucet: "tap", flashlight: "torch", sneakers: "trainers", freeway: "motorway", trash: "rubbish", "parking lot": "car park", whiskey: "whisky", maneuver: "manoeuvre", maneuvers: "manoeuvres", esophagus: "oesophagus", estrogen: "oestrogen", anemia: "anaemia", anesthesia: "anaesthesia", hemoglobin: "haemoglobin", leukemia: "leukaemia", archeology: "archaeology", medieval: "medieval", tumor: "tumour", tumors: "tumours"
};
const IZE_KEEP = new Set(["size", "sizes", "sized", "prize", "prizes", "prized", "seize", "seizes", "seized", "seizing", "capsize", "capsized", "resize", "resized", "downsize", "downsized", "oversize", "oversized", "assize", "assizes", "maize", "baize", "belize", "kaiser"]);
const matchCase = (src: string, repl: string): string => (src[0] === src[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl);
function britishise(t: string): string {
	t = t.replace(/\b[A-Za-z]+(?: lot)?\b/g, (w) => { const k = w.toLowerCase(); return US_UK[k] ? matchCase(w, US_UK[k]) : w; });
	t = t.replace(/\b([A-Za-z]{2,}?)(iz)(e|es|ed|ing|er|ers|ation|ations|able)\b/g, (m, stem, _z, suf) => IZE_KEEP.has(m.toLowerCase()) ? m : `${stem}is${suf}`);
	t = t.replace(/\b(anal|paral|catal|hydrol|electrol)yz(e|es|ed|ing|er)\b/gi, (_m, stem, suf) => `${stem}ys${suf}`);
	return t;
}
function fixDashes(t: string): string {
	t = t.replace(/\s*[—]\s*/g, " — ").replace(/\s+[–-]\s+/g, " — ");
	const parts = t.split(" — ");
	if (parts.length === 1) return t;
	if (parts.length === 2) return `${parts[0]}: ${parts[1]}`;
	if (parts.length === 3) {
		const tail = parts[2];
		const glue = /^[,.;:?!)]/.test(tail) ? "" : /^\p{Ll}/u.test(tail) ? ", " : " ";
		return `${parts[0]} (${parts[1]})${glue}${tail}`;
	}
	return parts.join("; ");
}
function fixOxford(t: string): string {
	return t.split(/(?<=[.?!])\s+/).map((sent) => {
		const commas = (sent.match(/,/g) || []).length;
		return commas >= 2 ? sent.replace(/,\s+(and|or)\s+/g, " $1 ") : sent;
	}).join(" ");
}
const OPENERS = /^(?:famously|notably|interestingly|curiously|remarkably|uniquely|surprisingly|perhaps surprisingly|in fact|indeed|of course|it is worth noting that|it's worth noting that|it should be noted that),?\s+/i;
export function polish(text: unknown, role: "q" | "a"): string {
	let t = String(text || "").replace(/\s+/g, " ").trim();
	if (!t) return t;
	t = fixDashes(t);
	t = britishise(t);
	t = fixOxford(t);
	if (role === "q") {
		t = t.replace(OPENERS, "");
		t = t.replace(/\s+([?!.,;:])/g, "$1");
		t = t.replace(/^(\p{Ll})/u, (c) => c.toUpperCase());
		if (!/[?.!]$/.test(t)) t += "?";
	} else {
		t = t.replace(/\s+([,;:])/g, "$1").replace(/[.]+$/, "").trim();
	}
	return t;
}

// ---------- scheduling ----------
// Question i: topic t = i % N, round r = floor(i / N). Every player reads
// exactly k questions in every mode; that is what keeps holding the phone
// cost-free. ownTopic "avoid" keeps a topic's chooser from ever answering it.
export function buildSchedule(banks: Question[][], N: number, mode: ModeKey, ownTopic: "avoid" | "allow"): ScheduleEntry[] {
	const k = Math.min(...banks.map((b) => b.length));
	const out: ScheduleEntry[] = [];
	for (let r = 0; r < k; r++) {
		for (let t = 0; t < N; t++) {
			const q = banks[t][r];
			let reader: number, answerer: number | null = null;
			if (mode === "solo") {
				reader = 0;
			} else if (mode === "turns") {
				answerer = ownTopic === "avoid" ? (t + 1 + (r % (N - 1))) % N : (t + r) % N;
				const d = N >= 3 ? 1 + ((r + 1) % (N - 1)) : 1; // reader offset varies by round so pairings rotate
				reader = (answerer + d) % N;
			} else {
				reader = ownTopic === "avoid" ? t : (t + r) % N;
			}
			out.push({ ...q, topic: t, reader, answerer, i: out.length });
		}
	}
	return out;
}

// ---------- answer and member collision (self-tested) ----------
// Same answer under different names: identical, whole-word prefix, one
// answer's tokens all inside the other's ("the steppe" vs "Pontic steppe"),
// or two single words sharing a long stem ("Greece" vs "Greek"). Short tokens
// such as regnal numerals are kept whole so "Constantine I" and "II" differ.
const stemKey = (w: string): string => (w.length >= 6 ? w.slice(0, 5) : w);
export function answersCollide(a: string, b: string): boolean {
	const na = normAnswer(a), nb = normAnswer(b);
	if (!na || !nb) return false;
	const ta = na.split(" "), tb = nb.split(" ");
	// A one-token answer that is short (a number, an initialism) only matches
	// the whole of the other answer; "one" is not inside "one tenth".
	const shortSingle = (t: string[]) => t.length === 1 && t[0].length <= 3;
	if (shortSingle(ta) || shortSingle(tb)) return na === nb;
	if (same(na, nb)) return true;
	const sa = ta.map(stemKey), sb = tb.map(stemKey);
	const sub = (x: string[], y: string[]) => x.every((st) => y.includes(st));
	if (sub(sa, sb) || sub(sb, sa)) return true;
	if (ta.length === 1 && tb.length === 1 && ta[0].length >= 5 && tb[0].length >= 5 && ta[0].slice(0, 4) === tb[0].slice(0, 4)) return true;
	return false;
}

// Choose up to `need` plan entries that pass the mechanical checks, given what
// is already kept. Entries beyond `need` that were never examined come back as
// `spare`, so a later refill can re-validate them instead of re-planning.
// `dropped` lists entries that failed downstream (write, solve, judge); the
// same member on the same angle or answer is rejected. Pure, so it can be
// tested against real plans.
const HEDGED = /^(?:about|around|roughly|approximately|nearly|almost|under|over|less than|more than|very|several|some|few|many|most|a few|a lot)\b|\b(?:or so|ish)$/i;
export function selectPlan(entries: Record<string, unknown>[], need: number, difficulty: Difficulty, kept: PlanEntry[], members: number | null, k: number, relax = 0, dropped: DroppedEntry[] = []): SelectPlanResult {
	const [lo, hi] = DIFF_BAND[difficulty];
	const allowedPerMember = (members && members < k ? Math.min(2, Math.ceil(k / members)) : 1) + relax;
	const jargonCap = 1 + relax;
	const chosen: PlanEntry[] = [], rejected: PlanRejection[] = [], spare: Record<string, unknown>[] = [];
	const all = () => [...kept, ...chosen];
	for (const e of entries) {
		if (chosen.length >= need) { spare.push(e); continue; }
		const member = String(e?.member || "").trim(), answer = String(e?.answer || "").trim(), angle = String(e?.angle || "").trim();
		const wasDropped = dropped.find((d) => same(norm(d.subject), norm(member)) && (answersCollide(d.a, answer) || same(norm(d.angle), norm(angle))));
		if (wasDropped) rejected.push({ member: member || "?", answer, why: [`already tried and dropped (${wasDropped.why})`] });
		if (wasDropped) continue;
		const lv = Number(e?.level), jargon = e?.jargon === true || String(e?.jargon).toLowerCase() === "true";
		const why: string[] = [];
		if (!member) why.push("no member");
		if (!answer) why.push("no answer");
		if (!angle) why.push("no angle");
		if (/[()[\]]/.test(member)) why.push("member has brackets");
		if (!Number.isFinite(lv) || lv < lo || lv > hi) why.push(`level ${Number.isFinite(lv) ? lv : "missing"} outside ${lo}-${hi}`);
		if (jargon && difficulty === "Easy") why.push("specialist-term answer at easy");
		else if (jargon && lv < 4) why.push(`specialist-term answer rated ${lv}`);
		else if (jargon && difficulty === "Medium" && all().filter((y) => y.jargon).length >= jargonCap) why.push(`${jargonCap === 1 ? "second" : "another"} specialist-term answer in a medium set`);
		if (answer && HEDGED.test(answer)) why.push(`hedged answer "${answer}"`);
		const dupA = all().find((y) => answersCollide(y.a, answer) || (y.alt || []).some((v) => answersCollide(v, answer)));
		if (dupA) why.push(`answer "${answer}" repeats "${dupA.a}"`);
		if (all().filter((y) => same(norm(y.subject), norm(member))).length >= allowedPerMember) why.push(`member "${member}" already used`);
		if (why.length) { rejected.push({ member: member || "?", answer, why }); continue; }
		chosen.push({ subject: member, angle, a: answer, alt: [], level: lv, jargon, q: null, verified: null });
	}
	return { chosen, rejected, spare };
}

// ---------- self-tests ----------
// Fixtures are real model outputs from earlier rounds. Run once at load; the
// results go into the dev export and a warning shows on setup if any fail.
export function runSelfTests(): SelfTestResult[] {
	const T: SelfTestResult[] = [];
	const t = (name: string, ok: unknown, detail?: string) => T.push({ name, ok: !!ok, detail: ok ? undefined : detail });
	const topicRomance = "The evolution of vulgar Latin into romance languages";
	t("same: Constantine vs Constantine I", same("constantine", "constantine i"));
	t("same: Constantine I vs II distinct", !same("constantine i", "constantine ii"));
	t("leak: Galicia from Galician", answerLeaks("...ancestor of both modern Portuguese and Galician. In which medieval kingdom did it develop?", ["Galicia", "Galicia-Portugal"], topicRomance) === "Galicia");
	t("leak: accusative case not leaked by 'case'", answerLeaks("Which Latin case survived as the base form for Romance nouns?", ["the accusative case"], topicRomance) === null);
	t("leak: single-word answer in question", answerLeaks("Italian dropped final vowels; which language is this?", ["Italian"], topicRomance) === "Italian");
	t("leak: topic words exempt", answerLeaks("What did Romans call the everyday spoken form of their language?", ["Vulgar Latin"], topicRomance) === null);
	const trunc = `{"members": 47, "questions": [{"subject":["Vulgar Latin","what-called"],"level":3,"q":"Q?","a":"Vulgar Latin","alt":["sermo vulgaris"]},{"subject":["sound change in Gallo-Romance",`;
	const s1 = salvageQuestions(trunc);
	t("salvage: recovers 1 from truncated", !s1.complete && s1.questions.length === 1 && s1.members === 47);
	const s2 = salvageQuestions(`{"members": 3, "questions": [{"subject":["x \\"q\\" }","why"],"level":4,"q":"q","a":"a","alt":[]},{"subject":["y","when"],"level":4,"q":"q","a":"a","alt":["b"]},{"sub`);
	t("salvage: escaped quotes and braces in strings", s2.questions.length === 2);
	t("salvage: complete JSON", salvageQuestions(`preamble {"members": 8, "questions": [{"q":"a","a":"b"}]}`).complete);
	const up = unpackContent([{ type: "text", text: "x" }, { type: "server_tool_use", input: { query: "q1" } }, { type: "web_search_tool_result", content: [{}, {}] }, { type: "server_tool_use", input: { query: "q2" } }, { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "{}" }]);
	t("unpack: by type, not position", up.text === "x\n{}" && up.searches.length === 2 && up.resultCount === 2 && up.toolErrors[0] === "max_uses_exceeded");
	t("overlap: same topic", topicOverlap("Roman emperors", "roman emperors") === "same");
	t("overlap: partial", topicOverlap("Roman emperors from Galba", "Emperors of Rome") === "overlap");
	t("overlap: distinct", topicOverlap("Great apes", "Planets") === null);
	t("collide: the steppe vs Pontic steppe", answersCollide("the steppe", "Pontic steppe") && answersCollide("Pontic-Caspian steppe", "Pontic steppe"));
	t("collide: Greece vs Greek", answersCollide("Greece", "Greek"));
	t("collide: number words", answersCollide("Two", "2") && answersCollide("ten", "10"));
	t("collide: short numeric token needs the whole answer", !answersCollide("one", "one tenth") && !answersCollide("one", "very little (under ten percent)") && answersCollide("two", "two") && answersCollide("1", "one") && !answersCollide("AD", "AD 476"));
	t("collide: distinct answers stay distinct", !answersCollide("Hittite", "Latin") && !answersCollide("China", "Armenian") && !answersCollide("Constantine I", "Constantine II"));
	{
		const plan = [
			{ member: "Germanic branch", angle: "where it spread from", answer: "the steppe", level: 2, jargon: false },
			{ member: "PIE homeland", angle: "where it was", answer: "Pontic steppe", level: 2, jargon: false },
			{ member: "Italic branch", angle: "parent language", answer: "Latin", level: 1, jargon: false },
			{ member: "Italic branch", angle: "a daughter", answer: "French", level: 1, jargon: false },
			{ member: "Anatolian branch", angle: "its known language", answer: "Hittite", level: 3, jargon: false },
			{ member: "Hellenic branch", angle: "a term", answer: "aorist", level: 2, jargon: true }
		];
		const r = selectPlan(plan, 6, "Easy", [], 10, 6);
		t("plan: steppe repeat rejected, member repeat rejected, level and jargon enforced", r.chosen.length === 2 && r.rejected.length === 4 && /repeats/.test(r.rejected[0].why.join()) && /already used/.test(r.rejected[1].why.join()) && /outside/.test(r.rejected[2].why.join()) && /easy/.test(r.rejected[3].why.join()));
	}
	t("parseObject: plan salvage on cut-off", parseObject(`{"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false},{"member":"d",`, "plan").obj.plan?.length === 1 && parseObject(`{"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false}]}`, "plan").complete);
	t("parseObject: reading survives a cut-off plan", ((parseObject(`{"reading":{"includes":"branches","excludes":"languages","answers":"a branch"},"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false},{"mem`, "plan").obj.reading as { excludes?: string } | undefined) || {}).excludes === "languages");
	t("enumeration giveaway: lists the four it asks to count", enumeratesAnswerCount("Ancient Greek is divided into how many major dialect groups, including Doric, Ionic, Aeolic and Arcado-Cypriot?", "four"));
	t("enumeration giveaway: not triggered by fewer items or non-numeric answers", !enumeratesAnswerCount("Sanskrit and Persian belong to the same branch. How many main sub-branches does it have?", "Two") && !enumeratesAnswerCount("Which of Doric, Ionic and Aeolic was spoken in Sparta?", "Doric"));
	t("non-latin detect", hasNonLatin("Ελληνικά") && hasNonLatin("日本") && !hasNonLatin("Café Français, naïve — ok?"));
	t("tc: small words and apostrophes", tc("how it's played") === "How It's Played" && tc("short of it") === "Short of It" && tc("the table wins") === "The Table Wins" && tc("10 of 15") === "10 of 15");
	t("tc: leaves internal capitals", tc("emperors after AD 476") === "Emperors After AD 476");
	t("polish: two dashes to parentheses", polish("When unstressed vowels dropped out — turning 'oculum' into 'oclo' — what term names this?", "q") === "When unstressed vowels dropped out (turning 'oculum' into 'oclo'), what term names this?");
	t("polish: one dash to colon", polish("Romance replaced the future by combining an infinitive with 'to have' — what is the term?", "q") === "Romance replaced the future by combining an infinitive with 'to have': what is the term?");
	t("polish: oxford comma removed, pair kept", polish("Which emperor ruled Gaul, Britain, and Spain?", "q") === "Which emperor ruled Gaul, Britain and Spain?" && polish("Was it Otho, or Galba?", "q") === "Was it Otho, or Galba?");
	t("polish: british spelling", polish("Which color did the organization favor in its center?", "q") === "Which colour did the organisation favour in its centre?" && polish("prize", "a") === "prize" && polish("Seized the capsized maize", "a") === "Seized the capsized maize");
	t("polish: openers and terminal", polish("Famously, which planet has a day longer than its year", "q") === "Which planet has a day longer than its year?");
	t("polish: answer trailing stop", polish("Venus.", "a") === "Venus" && polish(" 95 days ", "a") === "95 days");
	// schedule invariants
	for (const N of [2, 3, 4, 5]) for (const k of [2, 4]) for (const mode of ["turns", "buzzer"] as ModeKey[]) for (const own of ["avoid", "allow"] as const) {
		if (mode === "buzzer" && N < 3) continue;
		const banks: Question[][] = Array.from({ length: N }, (_, ti) => Array.from({ length: k }, (_, r) => ({ subject: "", angle: "", a: "a", alt: [], level: 1, jargon: false, verified: null, q: `${ti}-${r}` })));
		const sch = buildSchedule(banks, N, mode, own);
		const reads = Array(N).fill(0), answers = Array(N).fill(0);
		let ok = sch.length === N * k;
		for (const q of sch) {
			reads[q.reader]++;
			if (mode === "turns") { answers[q.answerer as number]++; if (q.reader === q.answerer) ok = false; if (own === "avoid" && q.answerer === q.topic) ok = false; }
			if (mode === "buzzer" && own === "avoid" && q.reader !== q.topic) ok = false;
		}
		if (reads.some((x) => x !== k)) ok = false;
		if (mode === "turns" && answers.some((x) => x !== k)) ok = false;
		if (mode === "turns" && N >= 4) {
			const pairs = new Set(sch.map((q) => `${q.answerer}>${q.reader}`));
			if (pairs.size <= N) ok = false; // pairings must vary
		}
		t(`schedule N=${N} k=${k} ${mode} ${own}`, ok, JSON.stringify({ reads, answers }));
	}
	return T;
}

// Pull a JSON object out of a text response, tolerating a cut-off; returns
// the parsed object (possibly with a salvaged array under `key`).
export function parseObject(text: string, key: string): { obj: ParsedPlanObject; complete: boolean } {
	const clean = text.replace(/```json|```/g, "").trim();
	try {
		const st = clean.indexOf("{"), en = clean.lastIndexOf("}");
		const full = JSON.parse(clean.slice(st, en + 1));
		if (Array.isArray(full[key])) return { obj: full, complete: true };
	} catch {
		/* fall through */
	}
	const sv = salvageQuestions(clean.replace(`"${key}"`, '"questions"'));
	const extra: Record<string, unknown> = Object.fromEntries((clean.match(/"(members|format)"\s*:\s*("[^"]*"|\d+)/g) || []).map((m) => { const match = m.match(/"(\w+)"\s*:\s*(.*)/) as RegExpMatchArray; const [, kk, v] = match; return [kk, v.startsWith('"') ? JSON.parse(v) : Number(v)]; }));
	const rm = clean.match(/"reading"\s*:\s*(\{[^{}]*\})/);
	if (rm) { try { extra.reading = JSON.parse(rm[1]); } catch { /* ignore */ } }
	return { obj: { ...extra, [key]: sv.questions }, complete: false };
}

export const needs = (m: ModeDef | WinDef): string => `needs ${m.min === m.max ? m.min : `${m.min} to ${m.max}`} player${m.max === 1 ? "" : "s"}`;
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
