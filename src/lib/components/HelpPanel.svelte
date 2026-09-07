<script lang="ts">
	interface Props {
		children: import("svelte").Snippet;
	}
	let { children }: Props = $props();
</script>

<div class="help-panel text-[14px] mt-3 pl-4 py-1 leading-relaxed reveal">
	{@render children()}
</div>

<style>
	.help-panel {
		border-left: 2px solid var(--color-accent-muted);
		color: var(--color-text);
	}
</style>
