<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import Shell from "../Shell.svelte";
	import H from "../H.svelte";
	import Btn from "../Btn.svelte";
	import GenLog from "../GenLog.svelte";
	import ExportBar from "../ExportBar.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();

	let okCount = $derived(quiz.banks.filter((b) => b && b.length >= quiz.perTopic).length);
</script>

<Shell>
	<H title="That Didn't Work" sub={quiz.errMsg} />
	<div class="mb-8"><GenLog logs={quiz.genLogs} /></div>
	<div class="flex flex-wrap gap-2">
		<Btn tone="brass" onclick={() => quiz.generate()}>{okCount ? `Retry the failed topic${quiz.N - okCount === 1 ? "" : "s"} (${okCount} kept)` : "Try again"}</Btn>
		<Btn tone="ghost" onclick={() => { quiz.setupStep = 2; quiz.phase = "setup"; }}>Back to setup</Btn>
	</div>
	<ExportBar {quiz} />
</Shell>
