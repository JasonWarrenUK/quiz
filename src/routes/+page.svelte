<script lang="ts">
	import { createQuizState } from "$lib/quiz-state.svelte";
	import SetupScreen from "$lib/components/phases/SetupScreen.svelte";
	import LoadingScreen from "$lib/components/phases/LoadingScreen.svelte";
	import ShortScreen from "$lib/components/phases/ShortScreen.svelte";
	import ErrorScreen from "$lib/components/phases/ErrorScreen.svelte";
	import HandoffScreen from "$lib/components/phases/HandoffScreen.svelte";
	import QuestionScreen from "$lib/components/phases/QuestionScreen.svelte";
	import DoneScreen from "$lib/components/phases/DoneScreen.svelte";

	const quiz = createQuizState();
</script>

{#if quiz.phase === "setup"}
	<SetupScreen {quiz} />
{:else if quiz.phase === "loading"}
	<LoadingScreen {quiz} />
{:else if quiz.phase === "short"}
	<ShortScreen {quiz} />
{:else if quiz.phase === "error"}
	<ErrorScreen {quiz} />
{:else if quiz.phase === "handoff"}
	<HandoffScreen {quiz} />
{:else if quiz.phase === "question"}
	<QuestionScreen {quiz} />
{:else if quiz.phase === "done"}
	<DoneScreen {quiz} />
{/if}
