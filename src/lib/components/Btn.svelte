<script lang="ts">
	interface Props {
		tone?: "paper" | "brass" | "ghost" | "ember";
		disabled?: boolean;
		full?: boolean;
		small?: boolean;
		onclick?: () => void;
		children: import("svelte").Snippet;
	}
	let { tone = "paper", disabled = false, full = false, small = false, onclick, children }: Props = $props();
</script>

<button
	{onclick}
	{disabled}
	class="btn btn-{tone} {full ? 'w-full' : ''} {small ? 'px-3 py-1.5 text-[13px]' : 'px-5 py-3 text-[15px]'} rounded-[3px] font-medium transition-[transform,opacity] active:scale-[0.985] disabled:opacity-35"
>
	{@render children()}
</button>

<style>
	.btn {
		font-family: var(--font-sans);
		letter-spacing: 0.005em;
	}
	.btn-paper { background: var(--color-text); color: var(--color-surface); }
	.btn-brass { background: var(--color-primary); color: var(--color-on-primary); }
	.btn-ghost { background: transparent; color: var(--color-text); box-shadow: inset 0 0 0 1px var(--color-border-faint); }
	.btn-ember { background: var(--color-danger); color: var(--color-text); }
</style>
