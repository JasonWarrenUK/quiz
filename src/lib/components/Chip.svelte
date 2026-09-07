<script lang="ts">
	interface Props {
		active?: boolean;
		dim?: boolean;
		small?: boolean;
		onclick?: () => void;
		children: import("svelte").Snippet;
	}
	let { active = false, dim = false, small = false, onclick, children }: Props = $props();
</script>

<button
	{onclick}
	aria-disabled={dim}
	class="chip {small ? 'px-2 py-1 text-[12px]' : 'px-3 py-1.5 text-[14px]'} rounded-[3px] font-medium transition-colors"
	class:chip-active={active}
	style:opacity={dim ? 0.3 : 1}
>
	{@render children()}
</button>

<style>
	.chip {
		font-family: var(--font-sans);
		background: transparent;
		color: var(--color-text);
		box-shadow: inset 0 0 0 1px var(--color-text-faint);
	}
	.chip-active {
		background: var(--color-primary);
		color: var(--color-on-primary);
		box-shadow: none;
	}
</style>
