import type {
	Difficulty,
	ModeKey,
	WinKey,
	Player,
	Question,
	ScheduleEntry,
	GenLog,
	Flags,
	PlayEvent,
	HistorySnapshot,
	EndedBy,
	Phase,
	SelfTestResult
} from "./types";
import { MODES, WINS, buildSchedule, topicOverlap, hasNonLatin, clamp, runSelfTests } from "./quiz-logic";
import { fetchBankViaApi } from "./client/fetch-bank";
import { download, copyText } from "./client/export";

const VERSION = "2026-09-06";
const emptyPlayer = (): Player => ({ name: "", topic: "", difficulty: "Medium", format: "" });

export function createQuizState() {
	// ---------- setup ----------
	let phase = $state<Phase>("setup");
	let players = $state<Player[]>([emptyPlayer(), emptyPlayer(), emptyPlayer()]);
	let perTopic = $state(5);
	let modeRaw = $state<ModeKey>("turns");
	let winRaw = $state<WinKey>("count");
	let steals = $state(true);
	let stealValue = $state(0.5);
	let ownTopic = $state<"avoid" | "allow">("avoid");
	let buzzerTimer = $state(0);
	let useSearch = $state(true);
	let target = $state<number | null>(null);
	let notice = $state("");
	let setupStep = $state(1);
	let formatOpen = $state<Record<number, boolean>>({});
	let errMsg = $state("");

	// ---------- generation ----------
	let banks = $state<Question[][]>([]);
	let banksKey = $state("");
	let genLogs = $state<GenLog[]>([]);
	let topicStatus = $state<string[]>([]);
	let abortCtrl: AbortController | null = null; // plain box, not reactive: mirrors the artefact's useRef
	let cancelling = $state(false);

	// ---------- game ----------
	let gameK = $state<number | null>(null);
	let gameTarget = $state<number | null>(null);
	let schedule = $state<ScheduleEntry[]>([]);
	let idx = $state(0);
	let revealed = $state(false);
	let stealPrompt = $state(false);
	let scores = $state<number[]>([]);
	let faced = $state<number[]>([]);
	let plays = $state<PlayEvent[]>([]);
	let flags = $state<Flags>({});
	let flagOpen = $state(false);
	let history = $state<HistorySnapshot[]>([]);
	let endedBy = $state<EndedBy>(null);
	let raceWinner = $state<number | null>(null);
	let gameHelp = $state(false);
	let showLog = $state(false);
	let confirmEnd = $state(false);
	let clock = $state<number | null>(null);
	let copied = $state("");
	let markedIdx = -1; // plain box: double-tap guard, not reactive by design (useRef equivalent)
	let startedAt: string | null = null; // plain box: useRef equivalent

	const selfTests: SelfTestResult[] = runSelfTests();

	const N = $derived(players.length);
	const legalMode = $derived(MODES[modeRaw].min <= N && N <= MODES[modeRaw].max ? modeRaw : (N === 1 ? "solo" : "turns"));
	const legalWin = $derived(WINS[winRaw].min <= N && N <= WINS[winRaw].max ? winRaw : (N === 1 ? "count" : "highest"));
	const stealsOn = $derived(steals && legalMode === "turns" && N >= 3);
	const inGame = $derived(phase === "handoff" || phase === "question" || phase === "done");
	const kNow = $derived(inGame && gameK ? gameK : perTopic);
	const total = $derived(N * kNow);

	const named = $derived(players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}`, topic: p.topic.trim(), format: (p.format || "").trim() })));
	const ready = $derived(named.every((p) => p.topic.length > 0));

	const overlapWarn = $derived.by(() => {
		const out: string[] = [];
		for (let i = 0; i < named.length; i++) {
			for (let j = i + 1; j < named.length; j++) {
				const o = topicOverlap(named[i].topic, named[j].topic);
				if (o === "same") out.push(`${named[i].name} and ${named[j].name} have the same topic; both banks will be written separately and will overlap.`);
				else if (o === "overlap") out.push(`${named[i].name}'s and ${named[j].name}'s topics overlap; each will be told to keep off the other's ground, but expect some near-duplicates.`);
			}
		}
		return out;
	});
	const nonLatinWarn = $derived(named.some((p) => hasNonLatin(p.topic)) ? "A topic uses a non-Latin script. Duplicate checking only understands Latin letters for now, so questions on that topic may be wrongly rejected as repeats." : null);
	const failedTests = $derived(selfTests.filter((t) => !t.ok));

	const defaultTargetFor = (k: number): number | null => {
		const tot = N * k;
		if (legalWin === "target") return Math.ceil(tot * 0.7);
		if (legalWin === "coop") return Math.ceil(tot * 0.6);
		if (legalWin === "race") return Math.max(1, Math.ceil((legalMode === "buzzer" ? tot - k : k) * 0.6));
		return null;
	};
	const maxTargetFor = (k: number): number => {
		const tot = N * k;
		if (legalWin === "race") return legalMode === "buzzer" ? tot - k : k + (stealsOn ? (tot - k) * stealValue : 0);
		return tot;
	};
	const maxTarget = $derived(Math.max(1, Math.floor(maxTargetFor(perTopic))));
	const setupTarget = $derived(legalWin === "count" || legalWin === "highest" ? null : clamp(target ?? defaultTargetFor(perTopic) ?? 1, 1, maxTarget));
	const effTarget = $derived(inGame ? gameTarget : setupTarget);

	function setMode(k: ModeKey) { modeRaw = k; target = null; }
	function setWin(k: WinKey) { winRaw = k; target = null; }
	function setCount(n: number) {
		const next = players.slice(0, n);
		while (next.length < n) next.push(emptyPlayer());
		players = next;
		target = null;
	}
	function upd<K extends keyof Player>(i: number, key: K, v: Player[K]) {
		players = players.map((x, j) => (j === i ? { ...x, [key]: v } : x));
	}
	function setAllDiff(d: Difficulty) { players = players.map((x) => ({ ...x, difficulty: d })); }
	function keyFor(): string {
		return JSON.stringify({ t: named.map((p) => [p.topic, p.difficulty, p.format]), k: perTopic, s: useSearch });
	}

	// ---------- generation flow ----------
	async function generate({ force = false }: { force?: boolean } = {}) {
		const key = keyFor();
		const reuse = !force && key === banksKey ? banks : [];
		banksKey = key;
		phase = "loading";
		errMsg = "";
		const ctrl = new AbortController();
		abortCtrl = ctrl;
		cancelling = false;
		const status = named.map((_, i) => (reuse[i] && reuse[i].length >= perTopic ? "kept from last time" : "queued"));
		topicStatus = status;
		const setOne = (i: number, v: string) => { topicStatus = topicStatus.map((x, j) => (j === i ? v : x)); };
		const results: (Question[] | undefined)[] = new Array(N);
		const logs: (GenLog | undefined)[] = new Array(N);
		let cancelled = false;
		let next = 0;
		const worker = async () => {
			while (next < N && !cancelled) {
				const i = next++;
				const existing = reuse[i] || [];
				if (existing.length >= perTopic) { results[i] = existing; logs[i] = genLogs[i] || { topic: named[i].topic, attempts: [] }; continue; }
				try {
					const r = await fetchBankViaApi(named[i].topic, perTopic, named[i].difficulty, {
						onStatus: (v) => setOne(i, v),
						useSearch,
						signal: ctrl.signal,
						otherTopics: named.filter((_, j) => j !== i).map((p) => p.topic),
						existing,
						format: named[i].format
					});
					results[i] = r.bank;
					logs[i] = existing.length ? { ...r.log, toppedUp: existing.length } : r.log;
				} catch (e) {
					if (e instanceof Error && e.name === "AbortError") { cancelled = true; results[i] = existing; logs[i] = genLogs[i] || { topic: named[i].topic, attempts: [], cancelled: true }; setOne(i, "cancelled"); return; }
					results[i] = existing;
					logs[i] = { topic: named[i].topic, attempts: [], fatal: e instanceof Error ? e.message : String(e) };
					setOne(i, "failed");
				}
			}
		};
		await Promise.all([worker(), worker()]);
		abortCtrl = null;
		cancelling = false;
		const finalBanks = results.map((r) => r || []);
		banks = finalBanks;
		genLogs = logs.map((l, i) => l || { topic: named[i].topic, attempts: [], cancelled: true });
		if (cancelled) { setupStep = 3; phase = "setup"; notice = "Cancelled. Anything already written is kept for the next attempt with the same setup."; return; }
		const counts = finalBanks.map((b) => b.length);
		if (counts.some((c) => c === 0)) {
			errMsg = named.filter((_, i) => counts[i] === 0).map((p) => `No usable questions for "${p.topic}".`).join(" ");
			phase = "error";
			return;
		}
		if (counts.some((c) => c < perTopic)) { phase = "short"; return; }
		beginGame(finalBanks, perTopic);
	}

	function cancelGeneration() { cancelling = true; abortCtrl?.abort(); }

	function beginGame(bks: Question[][], k: number) {
		const trimmed = bks.map((b) => b.slice(0, k));
		const sched = buildSchedule(trimmed, N, legalMode, ownTopic);
		let gt: number | null = null;
		if (legalWin !== "count" && legalWin !== "highest") {
			const mx = Math.max(1, Math.floor(maxTargetFor(k)));
			gt = target !== null ? clamp(Math.round((target * k) / perTopic), 1, mx) : clamp(defaultTargetFor(k) ?? 1, 1, mx);
		}
		gameK = k; gameTarget = gt;
		schedule = sched; idx = 0; revealed = false; stealPrompt = false;
		scores = Array(N).fill(0); faced = Array(N).fill(0); plays = []; flags = {}; history = [];
		endedBy = null; raceWinner = null; confirmEnd = false; clock = null; flagOpen = false;
		markedIdx = -1; startedAt = new Date().toISOString();
		phase = legalMode === "solo" ? "question" : "handoff";
	}

	const cur = $derived(schedule[idx]);
	function eligible(q: ScheduleEntry): number[] {
		return legalMode === "solo" ? [0] : legalMode === "turns" ? [q.answerer as number] : named.map((_, i) => i).filter((i) => i !== q.reader);
	}

	function snapshot(): HistorySnapshot { return { idx, scores, faced, plays, endedBy, raceWinner }; }

	// `prevCur` is captured by the caller BEFORE idx advances: reading `cur`
	// (a $derived off `idx`) after `idx` has already been bumped would silently
	// give the new question instead of the one just answered, breaking the
	// reader-changed check below. See the React original's stale-closure
	// equivalent (`cur` captured at render time), which this must reproduce.
	function advance(prevCur: ScheduleEntry, nextPlays: PlayEvent[], nextScores: number[], nextFaced: number[], ended: EndedBy) {
		plays = nextPlays; scores = nextScores; faced = nextFaced;
		const last = idx + 1 >= schedule.length;
		if (ended || last) { endedBy = ended || "questions"; phase = "done"; return; }
		idx = idx + 1;
		revealed = false; stealPrompt = false;
		const nextQ = schedule[idx];
		phase = legalMode !== "solo" && nextQ.reader !== prevCur.reader ? "handoff" : "question";
	}

	function finish(who: number | null, viaSteal: boolean) {
		if (markedIdx === idx) return; // double-tap guard
		const prevCur = cur;
		markedIdx = idx;
		history = [...history, snapshot()];
		const pts = who === null ? 0 : viaSteal ? stealValue : 1;
		const nextScores = scores.slice();
		if (who !== null) nextScores[who] += pts;
		const nextFaced = faced.slice();
		eligible(prevCur).forEach((i) => (nextFaced[i] += 1));
		const nextPlays: PlayEvent[] = [...plays, { i: idx, who, pts, viaSteal, at: new Date().toISOString() }];
		let ended: EndedBy = null;
		if (legalWin === "race" && who !== null && nextScores[who] >= (gameTarget as number)) { ended = "race"; raceWinner = who; }
		if (legalWin === "coop" && nextScores.reduce((a, b) => a + b, 0) >= (gameTarget as number)) ended = "coop";
		advance(prevCur, nextPlays, nextScores, nextFaced, ended);
	}
	function voidQuestion() {
		if (markedIdx === idx) return;
		const prevCur = cur;
		markedIdx = idx;
		history = [...history, snapshot()];
		advance(prevCur, [...plays, { i: idx, void: true, at: new Date().toISOString() }], scores, faced, null);
	}
	function undo() {
		const prev = history[history.length - 1];
		if (!prev) return;
		history = history.slice(0, -1);
		idx = prev.idx; scores = prev.scores; faced = prev.faced; plays = prev.plays;
		endedBy = prev.endedBy; raceWinner = prev.raceWinner;
		revealed = true; stealPrompt = false; confirmEnd = false;
		markedIdx = -1;
		phase = "question";
	}
	function endRound() { endedBy = "table"; phase = "done"; confirmEnd = false; }
	function onWrongInTurns() {
		const others = named.map((_, i) => i).filter((i) => i !== cur.reader && i !== cur.answerer);
		if (stealsOn && others.length > 0) stealPrompt = true;
		else finish(null, false);
	}
	function toggleFlag(i: number, reason: string) {
		const curSet = new Set(flags[i] || []);
		if (curSet.has(reason)) curSet.delete(reason); else curSet.add(reason);
		const next = { ...flags };
		if (curSet.size) next[i] = [...curSet]; else delete next[i];
		flags = next;
	}

	// ---------- export ----------
	function roundText(): string {
		const lines: string[] = [];
		named.forEach((p, t) => {
			const b = banks[t] || [];
			if (!b.length) return;
			lines.push(`${p.topic} (${p.difficulty})`);
			b.forEach((q, r) => {
				const i = schedule.find((s) => s.topic === t && s.q === q.q)?.i;
				const fl = i !== undefined && flags[i] ? ` [flagged: ${flags[i].join(", ")}]` : "";
				lines.push(`${r + 1}. ${q.q}`);
				lines.push(`   → ${q.a}${q.alt?.length ? ` (also: ${q.alt.join(", ")})` : ""}${fl}`);
			});
			lines.push("");
		});
		return lines.join("\n");
	}
	function devExport(): Record<string, unknown> {
		return {
			app: "quiz-night", version: VERSION, exportedAt: new Date().toISOString(), userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
			setup: { players: named.map((p) => ({ name: p.name, topic: p.topic, difficulty: p.difficulty, format: p.format || null })), perTopic, gameK, mode: legalMode, win: legalWin, target, gameTarget, steals: stealsOn, stealValue, ownTopic, useSearch, buzzerTimer },
			generation: genLogs,
			banks: named.map((p, t) => ({ topic: p.topic, difficulty: p.difficulty, questions: banks[t] || [] })),
			play: { startedAt, schedule: schedule.map((s) => ({ i: s.i, topic: s.topic, reader: s.reader, answerer: s.answerer, subject: s.subject, angle: s.angle, level: s.level, jargon: s.jargon, verified: s.verified, source: s.source || null, solved: s.solved || null, solverBest: s.solverBest || null, solverCandidates: s.solverCandidates || null, rivalVerdicts: s.rivalVerdicts || null, judged: s.judged || null, judgeNote: s.judgeNote || null })), events: plays, flags, scores, faced, endedBy, raceWinner, current: idx, phase },
			selfTests,
			text: roundText()
		};
	}
	function exportJson(): string {
		return JSON.stringify(devExport(), null, 2).replace(/^\{\n\s+"app": ("[^"]*"),\n\s+"version": ("[^"]*"),/, '{ "app": $1, "version": $2,');
	}
	async function doCopy(what: "text" | "json") {
		const ok = await copyText(what === "text" ? roundText() : exportJson());
		copied = ok ? what : "failed";
		setTimeout(() => { copied = ""; }, 2000);
	}
	function doDownload() {
		download(`quiz-night-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, exportJson());
	}

	// Reset the double-tap lock and the clock whenever the question changes.
	$effect(() => { void idx; clock = null; flagOpen = false; });
	$effect(() => {
		if (clock === null || clock <= 0) return;
		const id = setTimeout(() => { clock = clock === null ? null : clock - 1; }, 1000);
		return () => clearTimeout(id);
	});

	return {
		get phase() { return phase; }, set phase(v) { phase = v; },
		get players() { return players; }, set players(v) { players = v; },
		get perTopic() { return perTopic; }, set perTopic(v) { perTopic = v; },
		get modeRaw() { return modeRaw; },
		get winRaw() { return winRaw; },
		get steals() { return steals; }, set steals(v) { steals = v; },
		get stealValue() { return stealValue; }, set stealValue(v) { stealValue = v; },
		get ownTopic() { return ownTopic; }, set ownTopic(v) { ownTopic = v; },
		get buzzerTimer() { return buzzerTimer; }, set buzzerTimer(v) { buzzerTimer = v; },
		get useSearch() { return useSearch; }, set useSearch(v) { useSearch = v; },
		get target() { return target; }, set target(v) { target = v; },
		get notice() { return notice; }, set notice(v) { notice = v; },
		get setupStep() { return setupStep; }, set setupStep(v) { setupStep = v; },
		get formatOpen() { return formatOpen; }, set formatOpen(v) { formatOpen = v; },
		get errMsg() { return errMsg; },
		get banks() { return banks; },
		get banksKey() { return banksKey; },
		get genLogs() { return genLogs; },
		get topicStatus() { return topicStatus; },
		get cancelling() { return cancelling; },
		get gameK() { return gameK; },
		get gameTarget() { return gameTarget; },
		get schedule() { return schedule; },
		get idx() { return idx; },
		get revealed() { return revealed; }, set revealed(v) { revealed = v; },
		get stealPrompt() { return stealPrompt; },
		get scores() { return scores; },
		get faced() { return faced; },
		get plays() { return plays; },
		get flags() { return flags; },
		get flagOpen() { return flagOpen; }, set flagOpen(v) { flagOpen = v; },
		get history() { return history; },
		get endedBy() { return endedBy; },
		get raceWinner() { return raceWinner; },
		get gameHelp() { return gameHelp; }, set gameHelp(v) { gameHelp = v; },
		get showLog() { return showLog; }, set showLog(v) { showLog = v; },
		get confirmEnd() { return confirmEnd; }, set confirmEnd(v) { confirmEnd = v; },
		get clock() { return clock; }, set clock(v) { clock = v; },
		get copied() { return copied; }, set copied(v) { copied = v; },
		get selfTests() { return selfTests; },
		get N() { return N; },
		get legalMode() { return legalMode; },
		get legalWin() { return legalWin; },
		get stealsOn() { return stealsOn; },
		get inGame() { return inGame; },
		get kNow() { return kNow; },
		get total() { return total; },
		get named() { return named; },
		get ready() { return ready; },
		get overlapWarn() { return overlapWarn; },
		get nonLatinWarn() { return nonLatinWarn; },
		get failedTests() { return failedTests; },
		get maxTarget() { return maxTarget; },
		get setupTarget() { return setupTarget; },
		get effTarget() { return effTarget; },
		get cur() { return cur; },
		get startedAt() { return startedAt; },
		defaultTargetFor,
		maxTargetFor,
		setMode,
		setWin,
		setCount,
		upd,
		setAllDiff,
		keyFor,
		generate,
		cancelGeneration,
		beginGame,
		eligible,
		finish,
		voidQuestion,
		undo,
		endRound,
		onWrongInTurns,
		toggleFlag,
		roundText,
		devExport,
		exportJson,
		doCopy,
		doDownload
	};
}

export type QuizState = ReturnType<typeof createQuizState>;
