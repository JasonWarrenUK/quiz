<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import { fmt } from "$lib/quiz-logic";
	import { BAD_REASONS } from "$lib/quiz-logic";
	import Shell from "../Shell.svelte";
	import HelpToggle from "../HelpToggle.svelte";
	import HelpPanel from "../HelpPanel.svelte";
	import SubHead from "../SubHead.svelte";
	import Btn from "../Btn.svelte";
	import Small from "../Small.svelte";
	import Chip from "../Chip.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();

	let cur = $derived(quiz.cur);
	let reader = $derived(quiz.named[cur.reader]);
	let owner = $derived(quiz.named[cur.topic]);
	let elig = $derived(quiz.eligible(cur));
	let teamTotal = $derived(quiz.scores.reduce((a, b) => a + b, 0));

	let instruction = $derived(
		quiz.legalMode === "solo"
			? "Think, then reveal. Mark yourself honestly."
			: quiz.legalMode === "turns"
				? `Read aloud to ${quiz.named[cur.answerer as number].name}.`
				: `Read aloud. Everyone except you can answer; first to shout it takes the point.`
	);
	let thisQuestion = $derived(
		quiz.legalMode === "solo"
			? "Think of your answer, tap reveal, then mark yourself. One point if you had it."
			: quiz.legalMode === "turns"
				? `${reader.name} reads; ${quiz.named[cur.answerer as number].name} answers. ${reader.name} can't score this one.${quiz.stealsOn ? ` If ${quiz.named[cur.answerer as number].name} misses, anyone except ${reader.name} can steal it for ${fmt(quiz.stealValue)} point${quiz.stealValue === 1 ? "" : "s"}.` : " A miss scores nobody."}`
				: `${reader.name} reads${cur.reader === cur.topic ? " their own topic" : ""}. Everyone else shouts; first correct answer takes the point. ${reader.name} can't score this one.`
	);
	let progress = $derived(
		quiz.legalWin === "count"
			? `Nothing to hit. ${quiz.schedule.length - quiz.idx} left including this one; the scores just get tallied at the end.`
			: quiz.legalWin === "highest"
				? `Highest score after question ${quiz.schedule.length} wins. ${quiz.schedule.length - quiz.idx} left including this one.`
				: quiz.legalWin === "target"
					? `You need ${quiz.gameTarget} of ${quiz.schedule.length}. You have ${fmt(quiz.scores[0])}; ${fmt(Math.max(0, (quiz.gameTarget as number) - quiz.scores[0]))} to go with ${quiz.schedule.length - quiz.idx} questions left.`
					: quiz.legalWin === "race"
						? `First to ${quiz.gameTarget} wins immediately. ` + quiz.named.map((p, i) => `${p.name} needs ${fmt(Math.max(0, (quiz.gameTarget as number) - quiz.scores[i]))}`).join(", ") + "."
						: `Team needs ${quiz.gameTarget} of ${quiz.schedule.length}. You have ${fmt(teamTotal)} between you, ${fmt(Math.max(0, (quiz.gameTarget as number) - teamTotal))} to go with ${quiz.schedule.length - quiz.idx} questions left.`
	);
	let flagged = $derived(quiz.flags[quiz.idx] || []);
	let genLog = $derived(quiz.genLogs[cur.topic]);
</script>

<Shell>
	<div class="flex items-baseline justify-between gap-3 mb-8 text-[13px] top-row">
		<span class="shrink-0 whitespace-nowrap nums">Question {quiz.idx + 1} of {quiz.schedule.length}</span>
		<div class="flex items-baseline gap-3 min-w-0">
			<span class="truncate">{owner.topic}, {owner.difficulty.toLowerCase()}</span>
			<HelpToggle open={quiz.gameHelp} onclick={() => (quiz.gameHelp = !quiz.gameHelp)} label="Rules for this question" />
		</div>
	</div>

	{#if quiz.gameHelp}
		<HelpPanel>
			<SubHead text="This question" />
			{#if genLog?.reading}
				<p class="mb-2 muted">The topic was read as: {genLog.reading.includes}; excluding {genLog.reading.excludes}; answers are {genLog.reading.answers}.</p>
			{/if}
			{#if quiz.named[cur.topic].format || genLog?.formatDecided?.startsWith("fixed")}
				<p class="mb-2 muted">Fixed format for this topic: {quiz.named[cur.topic].format || genLog?.formatDecided?.replace(/^fixed:\s*/, "")}</p>
			{/if}
			<p class="mb-3 muted">{thisQuestion}{quiz.revealed && cur.subject ? ` Subject: ${cur.subject}${cur.angle ? ` (${cur.angle})` : ""}${cur.level ? `, rated ${cur.level} of 5` : ""}${cur.jargon ? ", specialist term" : ""}${cur.solved === "in" ? ", solved blind to the same answer" : ""}${cur.judged === "in" ? ", checked against the topic" : cur.judged === "unjudged" ? ", not checked against the topic" : ""}.` : ""}</p>
			<SubHead text="Winning" />
			<p class="mb-3 muted">{progress}</p>
			{#if quiz.legalMode !== "solo"}
				<SubHead text="Fairness" />
				<p class="mb-3 muted">Every player reads {quiz.gameK} questions and is eligible to answer {quiz.legalMode === "buzzer" ? quiz.schedule.length - (quiz.gameK as number) : quiz.gameK}, so raw points compare directly.</p>
			{/if}
			<SubHead text="Table controls" />
			<div class="flex flex-wrap gap-2 mt-2">
				<Btn tone="ghost" small onclick={() => quiz.undo()} disabled={!quiz.history.length}>Undo last marking</Btn>
				<Btn tone="ghost" small onclick={() => quiz.voidQuestion()}>Void this question</Btn>
				{#if !quiz.confirmEnd}
					<Btn tone="ghost" small onclick={() => (quiz.confirmEnd = true)}>End round</Btn>
				{:else}
					<Btn tone="ember" small onclick={() => quiz.endRound()}>End now and tally</Btn>
					<Btn tone="ghost" small onclick={() => (quiz.confirmEnd = false)}>Keep playing</Btn>
				{/if}
			</div>
			<Small class="mt-3">Void drops a bad question with no score change and no one charged with it. End round tallies what's been played so far. Nothing is saved if the page reloads.</Small>
		</HelpPanel>
	{/if}

	<div class="mb-6 text-[14px] serif-text instruction" style="font-style: italic; font-size: 1.05rem;">{quiz.legalMode !== "solo" ? `${reader.name} is reading. ` : ""}{instruction}</div>

	<div class="serif nums leading-none mb-3 idx-num" style="font-size: 4.5rem; font-weight: 300; letter-spacing: -0.03em;">{quiz.idx + 1}</div>
	<div class="serif-text leading-[1.25] mb-10" style="font-size: clamp(1.55rem, 5.6vw, 2.05rem); font-weight: 400; min-height: 5rem; letter-spacing: -0.005em;">{cur.q}</div>

	{#if quiz.legalMode === "buzzer" && quiz.buzzerTimer > 0 && !quiz.revealed}
		<div class="mb-5">
			{#if quiz.clock === null}
				<Btn tone="ghost" small onclick={() => (quiz.clock = quiz.buzzerTimer)}>Start {quiz.buzzerTimer}s clock</Btn>
			{:else if quiz.clock > 0}
				<div class="serif nums leading-none clock" style="font-size: 3.5rem; font-weight: 300;">{quiz.clock}</div>
			{:else}
				<div class="font-medium timeout">Time. Reveal and mark "no one" if nobody had it.</div>
			{/if}
		</div>
	{/if}

	{#if !quiz.revealed}
		<Btn full onclick={() => (quiz.revealed = true)}>Reveal answer</Btn>
	{:else}
		<div class="pl-4 py-1 mb-5 reveal answer-block">
			<div class="flex items-baseline justify-between gap-3 text-[12.5px] answer-row">
				<span>Answer</span>
				{#if cur.verified !== null && cur.verified !== undefined}
					<span class="truncate max-w-[60%]" class:verified={cur.verified} class:unverified={!cur.verified}>{cur.verified ? `checked: ${cur.source}` : "not confirmed by a search; trust with care"}</span>
				{/if}
			</div>
			<div class="serif-text mt-1 answer-text" style="font-size: 1.7rem; font-weight: 500; line-height: 1.15;">{cur.a}</div>
			{#if cur.alt?.length > 0}
				<div class="text-[13.5px] mt-2 muted">Also fine: {cur.alt.join(", ")}</div>
			{/if}
		</div>

		<div class="mb-7">
			<button onclick={() => (quiz.flagOpen = !quiz.flagOpen)} class="flag-toggle text-[12.5px] underline underline-offset-4 decoration-1" class:flag-toggle-active={flagged.length > 0}>
				{flagged.length ? `Flagged: ${flagged.join(", ")}` : "Bad question? Flag it"}
			</button>
			{#if quiz.flagOpen}
				<div class="flex flex-wrap gap-1.5 mt-2">
					{#each BAD_REASONS as reason (reason)}
						<Chip small active={flagged.includes(reason)} onclick={() => quiz.toggleFlag(quiz.idx, reason)}>{reason}</Chip>
					{/each}
				</div>
				<Small class="mt-2">Flagging records it in the dev log; it doesn't change the score. Use "void" in the help panel for that.</Small>
			{/if}
		</div>

		{#if quiz.legalMode === "solo"}
			<div class="grid grid-cols-2 gap-2">
				<Btn tone="brass" onclick={() => quiz.finish(0, false)}>Got it</Btn>
				<Btn tone="ghost" onclick={() => quiz.finish(null, false)}>Missed it</Btn>
			</div>
		{/if}
		{#if quiz.legalMode === "turns" && !quiz.stealPrompt}
			<div class="grid grid-cols-2 gap-2">
				<Btn tone="brass" onclick={() => quiz.finish(cur.answerer, false)}>{quiz.named[cur.answerer as number].name} got it</Btn>
				<Btn tone="ghost" onclick={() => quiz.onWrongInTurns()}>Wrong</Btn>
			</div>
		{/if}
		{#if quiz.legalMode === "turns" && quiz.stealPrompt}
			<div class="text-[13.5px] mb-2 muted">Did anyone steal it? (worth {fmt(quiz.stealValue)})</div>
			<div class="flex flex-col gap-2">
				{#each quiz.named as p, i (i)}
					{#if i !== cur.reader && i !== cur.answerer}
						<Btn full onclick={() => quiz.finish(i, true)}>{p.name}</Btn>
					{/if}
				{/each}
				<Btn tone="ghost" full onclick={() => quiz.finish(null, false)}>No one</Btn>
			</div>
		{/if}
		{#if quiz.legalMode === "buzzer"}
			<div class="text-[13.5px] mb-2 muted">Who got it first?</div>
			<div class="flex flex-col gap-2">
				{#each elig as i (i)}
					<Btn full onclick={() => quiz.finish(i, false)}>{quiz.named[i].name}</Btn>
				{/each}
				<Btn tone="ghost" full onclick={() => quiz.finish(null, false)}>No one</Btn>
			</div>
		{/if}
	{/if}

	<div class="mt-12 flex flex-wrap gap-x-5 gap-y-1 text-[13px] scoreboard">
		{#each quiz.named as p, i (i)}
			<span>{p.name} <span class="serif-text nums score-num" style="font-size: 1rem;">{fmt(quiz.scores[i])}</span></span>
		{/each}
		{#if quiz.gameTarget !== null}
			<span class="ml-auto">Target {quiz.gameTarget}</span>
		{/if}
	</div>
</Shell>

<style>
	.top-row, .muted, .scoreboard { color: var(--color-text-muted); }
	.instruction { color: var(--color-primary); }
	.idx-num { color: var(--color-accent-muted); }
	.clock { color: var(--color-primary); }
	.timeout { color: var(--color-danger); }
	.answer-block { border-left: 2px solid var(--color-primary); }
	.answer-row { color: var(--color-text-muted); }
	.answer-text { color: var(--color-primary); }
	.verified { color: var(--color-text-muted); }
	.unverified { color: var(--color-primary); }
	.flag-toggle { color: var(--color-text-muted); text-decoration-color: var(--color-text-faint); }
	.flag-toggle-active { color: var(--color-primary); }
	.score-num { color: var(--color-text); }
</style>
