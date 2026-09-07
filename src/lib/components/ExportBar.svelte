<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import Btn from "./Btn.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();
</script>

<div class="flex flex-wrap gap-2 mt-6">
	<Btn tone="ghost" small onclick={() => quiz.doCopy("text")}>{quiz.copied === "text" ? "Copied" : "Copy questions & answers"}</Btn>
	<Btn tone="ghost" small onclick={() => quiz.doDownload()}>Download dev log</Btn>
	<Btn tone="ghost" small onclick={() => quiz.doCopy("json")}>{quiz.copied === "json" ? "Copied" : quiz.copied === "failed" ? "Copy failed" : "Copy dev log"}</Btn>
</div>
