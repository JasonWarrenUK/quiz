<script lang="ts">
	interface Props {
		tone?: "muted" | "accent" | "danger";
		class?: string;
		children: import("svelte").Snippet;
	}
	let { tone = "muted", class: className = "", children }: Props = $props();
</script>

<div class="small tone-{tone} text-[12.5px] leading-relaxed {className}">
	{@render children()}
</div>

<style>
	.tone-muted { color: var(--color-text-muted); }
	.tone-accent { color: var(--color-primary); }
	.tone-danger { color: var(--color-danger); }
</style>
