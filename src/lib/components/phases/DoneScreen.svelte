<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import { fmt } from "$lib/quiz-logic";
	import Shell from "../Shell.svelte";
	import H from "../H.svelte";
	import Small from "../Small.svelte";
	import LogToggle from "../LogToggle.svelte";
	import ExportBar from "../ExportBar.svelte";
	import Btn from "../Btn.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();

	let teamTotal = $derived(quiz.scores.reduce((a, b) => a + b, 0));
	let top = $derived(Math.max(...quiz.scores));
	let winners = $derived(quiz.named.filter((_, i) => quiz.scores[i] === top));
	let played = $derived(quiz.plays.filter((p) => !p.void).length);
	let voided = $derived(quiz.plays.filter((p) => p.void).length);
	let unasked = $derived(quiz.schedule.length - quiz.plays.length);
	let tail = $derived(quiz.endedBy === "table" ? ` Ended by the table with ${unasked} unasked.` : unasked > 0 ? ` ${unasked} unasked.` : "");

	let result = $derived.by(() => {
		let headline: string, sub: string, highlight = true;
		if (quiz.legalWin === "count") {
			headline = quiz.N === 1 ? `${fmt(quiz.scores[0])} of ${played}` : "Final Tally";
			highlight = false;
			sub = quiz.N === 1
				? (played === 0 ? "Nothing played." : quiz.scores[0] === played ? "Every one. Pick a harder level next time." : quiz.scores[0] >= played * 0.7 ? "A good round." : quiz.scores[0] >= played * 0.4 ? "Middling, honestly." : "Rough. The topic may have been the problem, or the difficulty.") + tail
				: `${fmt(teamTotal)} correct between you out of ${played}. No winner declared; argue about it yourselves.${tail}`;
		} else if (quiz.legalWin === "target") {
			const hit = quiz.scores[0] >= (quiz.gameTarget as number);
			highlight = false;
			headline = hit ? "Target Hit" : "Short of It";
			sub = `${fmt(quiz.scores[0])} of ${played}, target was ${quiz.gameTarget}.${tail}`;
		} else if (quiz.legalWin === "coop") {
			const hit = teamTotal >= (quiz.gameTarget as number);
			highlight = false;
			headline = hit ? "The Table Wins" : "The Quiz Wins";
			sub = `${fmt(teamTotal)} between you${quiz.endedBy === "coop" ? `, with ${unasked} questions to spare` : ` of a possible ${played}`}. Target was ${quiz.gameTarget}.${quiz.endedBy === "table" ? tail : ""}`;
		} else if (quiz.legalWin === "race") {
			if (quiz.raceWinner !== null) {
				headline = `${quiz.named[quiz.raceWinner].name} Takes It`;
				sub = `First to ${quiz.gameTarget}, with ${unasked} questions unasked.`;
			} else {
				headline = "No One Got There";
				highlight = false;
				sub = `Target was ${quiz.gameTarget}; the highest was ${fmt(top)} (${winners.map((w) => w.name).join(", ")}). No winner under race rules.${tail}`;
			}
		} else {
			headline = winners.length > 1 ? "A Draw" : `${winners[0].name} Wins`;
			sub = (winners.length > 1 ? `${winners.map((w) => w.name).join(" and ")} on ${fmt(top)}.` : `${fmt(top)} points.`) + tail;
		}
		return { headline, sub, highlight };
	});

	let order = $derived(quiz.named.map((p, i) => ({ ...p, i })).sort((a, b) => quiz.scores[b.i] - quiz.scores[a.i]));
	let readCount = $derived(quiz.named.map((_, i) => quiz.plays.filter((e) => !e.void && quiz.schedule[e.i].reader === i).length));
	let evenSplit = $derived(quiz.endedBy === "questions" && voided === 0);
</script>

<Shell>
	<H title={result.headline} sub={result.sub} />
	<div class="flex flex-col">
		{#each order as p (p.i)}
			<div class="grid grid-cols-[4rem_1fr_auto] gap-x-3 items-baseline py-4 row">
				<span class="serif nums leading-none score" class:score-top={result.highlight && quiz.scores[p.i] === top} style="font-size: 2.6rem; font-weight: 300; letter-spacing: -0.02em;">{fmt(quiz.scores[p.i])}</span>
				<div class="min-w-0">
					<div class="font-medium text-[15px]">{p.name}</div>
					<Small>{quiz.faced[p.i]} {quiz.legalMode === "buzzer" ? "raced" : "asked"}{quiz.legalMode !== "solo" ? `, read ${readCount[p.i]}` : ""}</Small>
				</div>
				<span class="text-[13px] truncate max-w-[9rem] topic-name">{p.topic}</span>
			</div>
		{/each}
	</div>
	{#if quiz.legalMode !== "solo"}
		<Small class="mt-4">
			{evenSplit
				? "Everyone read and was asked the same number of questions, so raw points compare fairly."
				: voided && quiz.endedBy === "questions"
					? `${voided} question${voided === 1 ? "" : "s"} voided, so the split is slightly uneven.`
					: "Ended early, so reading and answering weren't split evenly."}
		</Small>
	{/if}
	{#if Object.keys(quiz.flags).length > 0}
		<Small class="mt-2" tone="accent">{Object.keys(quiz.flags).length} question{Object.keys(quiz.flags).length === 1 ? "" : "s"} flagged as bad; they're in the dev log.</Small>
	{/if}

	<LogToggle logs={quiz.genLogs} />
	<ExportBar {quiz} />
	<div class="flex flex-wrap gap-2 mt-10">
		<Btn tone="brass" onclick={() => quiz.generate({ force: true })}>Same setup, new questions</Btn>
		<Btn tone="ghost" onclick={() => quiz.undo()} disabled={!quiz.history.length}>Undo last marking</Btn>
		<Btn tone="ghost" onclick={() => { quiz.setupStep = 1; quiz.phase = "setup"; }}>Change setup</Btn>
	</div>
	<Small class="mt-4">Replaying the same questions isn't available yet; "new questions" writes a fresh set. Copy the questions above if you want to keep this one.</Small>
</Shell>

<style>
	.row { border-bottom: 1px solid var(--color-border); }
	.score { color: var(--color-text); }
	.score-top { color: var(--color-primary); }
	.topic-name { color: var(--color-text-muted); }
</style>
