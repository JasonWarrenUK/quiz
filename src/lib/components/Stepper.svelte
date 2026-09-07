<script lang="ts">
	interface Props {
		value: number;
		min: number;
		max: number;
		onchange: (v: number) => void;
		suffix?: string;
	}
	let { value, min, max, onchange, suffix = "" }: Props = $props();
</script>

<div class="stepper inline-flex items-stretch rounded-[3px]">
	<button onclick={() => onchange(Math.max(min, value - 1))} class="px-3 text-lg" aria-label="fewer">−</button>
	<span class="px-3 py-2 min-w-[6rem] text-center nums value-label">
		<span class="serif-text value-num" style="font-size: 1.25rem;">{value}</span>{suffix}
	</span>
	<button onclick={() => onchange(Math.min(max, value + 1))} class="px-3 text-lg" aria-label="more">+</button>
</div>

<style>
	.stepper { box-shadow: inset 0 0 0 1px var(--color-text-faint); }
	.stepper button { color: var(--color-text-muted); }
	.value-label { color: var(--color-text); font-family: var(--font-sans); font-weight: 500; }
	.value-num { color: var(--color-primary); }
</style>
