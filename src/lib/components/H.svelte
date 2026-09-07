<script lang="ts">
	import { tc } from "$lib/quiz-logic";
	interface Props {
		title: string;
		sub?: string;
	}
	let { title, sub }: Props = $props();
</script>

<div class="mb-9">
	<h1 class="serif leading-[0.95]" style="font-size: clamp(2.6rem, 9vw, 3.8rem); font-weight: 500; letter-spacing: -0.015em;">{tc(title)}</h1>
	{#if sub}
		<p class="sub mt-4 text-[15px] leading-relaxed" style="max-width: 38ch;">{sub}</p>
	{/if}
</div>

<style>
	.sub { color: var(--color-text-muted); }
</style>
