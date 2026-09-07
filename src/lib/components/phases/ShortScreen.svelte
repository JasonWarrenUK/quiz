<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import Shell from "../Shell.svelte";
	import H from "../H.svelte";
	import Small from "../Small.svelte";
	import SubHead from "../SubHead.svelte";
	import Btn from "../Btn.svelte";
	import LogToggle from "../LogToggle.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();

	let counts = $derived(quiz.banks.map((b) => b.length));
	let minK = $derived(Math.min(...counts));
	let shortIdx = $derived(counts.map((c, i) => (c < quiz.perTopic ? i : -1)).filter((i) => i >= 0));
	let previewTarget = $derived(
		quiz.legalWin !== "count" && quiz.legalWin !== "highest"
			? quiz.target !== null
				? Math.max(1, Math.min(Math.floor(quiz.maxTargetFor(minK)), Math.round((quiz.target * minK) / quiz.perTopic)))
				: quiz.defaultTargetFor(minK)
			: null
	);
</script>

<Shell>
	<H title="Some Topics Came Up Short" sub={`${shortIdx.map((i) => `${quiz.named[i].topic}: ${counts[i]} of ${quiz.perTopic}`).join(". ")}. The rest are complete.`} />
	<div class="flex flex-col gap-8 mb-8">
		<div class="pl-4 block-primary">
			<SubHead text="Play with {minK} per topic" />
			<Small>{quiz.N * minK} questions instead of {quiz.total}. Every player still reads {minK}. {previewTarget !== null ? `Target becomes ${previewTarget}.` : ""} The extra questions on the fuller topics are dropped.</Small>
			<div class="mt-3"><Btn tone="brass" onclick={() => quiz.beginGame(quiz.banks, minK)}>Play shorter round</Btn></div>
		</div>
		<div class="pl-4 block-muted">
			<SubHead text={`Try to fill the short ${shortIdx.length === 1 ? "topic" : "topics"}`} />
			<Small>Keeps everything already written and asks only for the missing questions. Usually works; sometimes a topic simply doesn't have {quiz.perTopic} distinct things to ask at this difficulty.</Small>
			<div class="mt-3"><Btn onclick={() => quiz.generate()}>Top up</Btn></div>
		</div>
	</div>
	<Btn tone="ghost" onclick={() => { quiz.setupStep = 3; quiz.phase = "setup"; }}>Back to setup</Btn>
	<LogToggle logs={quiz.genLogs} label="log" />
</Shell>

<style>
	.block-primary { border-left: 2px solid var(--color-accent-muted); }
	.block-muted { border-left: 2px solid var(--color-text-faint); }
</style>
