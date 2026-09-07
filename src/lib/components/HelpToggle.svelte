<script lang="ts">
	interface Props {
		open: boolean;
		onclick: () => void;
		label?: string;
	}
	let { open, onclick, label = "Help" }: Props = $props();
</script>

<button
	{onclick}
	aria-expanded={open}
	aria-label={label}
	class="help-toggle w-6 h-6 rounded-full text-[11px] font-semibold shrink-0 serif-text"
	class:help-toggle-open={open}
	style="font-style: italic;"
>?</button>

<style>
	.help-toggle {
		background: transparent;
		color: var(--color-text-muted);
		box-shadow: inset 0 0 0 1px var(--color-text-faint);
	}
	.help-toggle-open {
		background: var(--color-primary);
		color: var(--color-on-primary);
		box-shadow: none;
	}
</style>
