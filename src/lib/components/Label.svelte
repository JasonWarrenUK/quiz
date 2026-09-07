<script lang="ts">
	interface Props {
		children: import("svelte").Snippet;
	}
	let { children }: Props = $props();
</script>

<span class="label text-[13px] font-medium serif-text" style="font-style: italic; font-size: 1.05rem;">
	{@render children()}
</span>

<style>
	.label { color: var(--color-primary); }
</style>
