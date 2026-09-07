<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import Shell from "../Shell.svelte";
	import H from "../H.svelte";
	import Btn from "../Btn.svelte";
	import Small from "../Small.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();
</script>

<Shell>
	<H
		title="Sharpening Pencils"
		sub={`Writing ${quiz.total} questions across ${quiz.N} ${quiz.N === 1 ? "topic" : "topics"}${quiz.useSearch ? ", checking each answer against the web" : ""}, then checking each set against its topic. ${quiz.useSearch ? "A minute or two" : "Half a minute or so"}; longer with more players.`}
	/>
	<div class="flex flex-col mb-8">
		{#each quiz.named as p, i (i)}
			{@const raw = quiz.topicStatus[i] || "queued"}
			{@const finished = raw === "done" || raw === "kept from last time"}
			{@const st = quiz.cancelling && !finished && raw !== "failed" ? "stopping" : raw}
			<div class="grid grid-cols-[2rem_1fr_auto] gap-x-3 items-baseline py-3 row">
				<span class="serif-text nums index" class:breathe={!finished && st !== "failed"} class:index-finished={finished} class:index-failed={st === "failed"} style="font-size: 1.4rem; font-style: italic; line-height: 1;">{i + 1}</span>
				<span class="font-medium truncate">{p.topic}</span>
				<span class="text-[13px] shrink-0 status" class:status-finished={finished} class:status-failed={st === "failed"}>{st}</span>
			</div>
		{/each}
	</div>
	<Btn tone="ghost" disabled={quiz.cancelling} onclick={() => quiz.cancelGeneration()}>{quiz.cancelling ? "Stopping" : "Cancel"}</Btn>
	<Small class="mt-4">{quiz.cancelling ? "Stopping now. Anything already written is kept." : "Cancelling keeps any topic already finished; the next attempt with the same setup starts from there."}</Small>
</Shell>

<style>
	.row { border-bottom: 1px solid var(--color-border); }
	.index { color: var(--color-text-muted); }
	.index-finished { color: var(--color-primary); }
	.index-failed { color: var(--color-danger); }
	.status { color: var(--color-text-muted); }
	.status-finished { color: var(--color-primary); }
	.status-failed { color: var(--color-danger); }
</style>
