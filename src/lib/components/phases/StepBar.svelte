<script lang="ts">
	interface Props {
		setupStep: number;
		onselect: (n: number) => void;
	}
	let { setupStep, onselect }: Props = $props();
	const STEPS = ["Players", "Topics", "Rules"];
</script>

<div class="flex items-baseline gap-5 mb-10 text-[13px] root">
	{#each STEPS as label, i (label)}
		{@const n = i + 1}
		{@const done = n < setupStep}
		{@const here = n === setupStep}
		<button
			onclick={() => done && onselect(n)}
			class="flex items-baseline gap-2 rounded step"
			class:step-here={here}
			class:step-done={done}
			style:cursor={done ? "pointer" : "default"}
		>
			<span class="serif-text step-num" class:step-num-here={here} style="font-size: 1.15rem; font-style: italic;">{n}</span>
			<span class:font-medium={here}>{label}</span>
		</button>
	{/each}
</div>

<style>
	.root { font-family: var(--font-sans); }
	.step { color: var(--color-text-faint); }
	.step-done { color: var(--color-primary); }
	.step-here { color: var(--color-text); }
	.step-num-here { color: var(--color-primary); }
</style>
