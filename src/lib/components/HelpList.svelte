<script lang="ts">
	interface Item {
		title: string;
		body: string;
		unavailable?: string | null;
	}
	interface Props {
		items: Item[];
	}
	let { items }: Props = $props();
</script>

<ul class="flex flex-col gap-2">
	{#each items as item (item.title)}
		<li style:opacity={item.unavailable ? 0.55 : 1}>
			<span class="font-semibold">{item.title}</span>
			{#if item.unavailable}
				<span class="unavailable"> ({item.unavailable})</span>
			{/if}
			<div class="body">{item.body}</div>
		</li>
	{/each}
</ul>

<style>
	.unavailable { color: var(--color-primary); }
	.body { color: var(--color-text-muted); }
</style>
