<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import Shell from "../Shell.svelte";
	import Btn from "../Btn.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();
	let cur = $derived(quiz.cur);
	let r = $derived(quiz.named[cur.reader]);
</script>

<Shell>
	<div class="min-h-[72vh] flex flex-col justify-center">
		<div class="text-[13px] mb-6 nums count">Question {quiz.idx + 1} of {quiz.schedule.length}</div>
		<div class="serif-text mb-3 lede" style="font-size: 1.35rem; font-style: italic;">Pass the phone to</div>
		<div class="serif leading-[0.9] mb-10 break-words name" style="font-size: clamp(3.2rem, 15vw, 5.6rem); font-weight: 600; letter-spacing: -0.02em;">{r.name}</div>
		<p class="mb-10 text-[15px] leading-relaxed instruction" style="max-width: 36ch;">
			{quiz.legalMode === "buzzer"
				? cur.reader === cur.topic
					? "Your topic, your read. You sit this one out; the others race."
					: `You're reading ${quiz.named[cur.topic].name}'s topic. You sit this one out; the others race.`
				: `You're reading for ${quiz.named[cur.answerer as number].name}. You don't answer this one.`}
		</p>
		<Btn full onclick={() => (quiz.phase = "question")}>{r.name}, I've got it</Btn>
	</div>
</Shell>

<style>
	.count, .instruction { color: var(--color-text-muted); }
	.lede { color: var(--color-text-muted); }
	.name { color: var(--color-primary); }
</style>
