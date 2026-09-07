<script lang="ts">
	import { tc } from "$lib/quiz-logic";
	import Label from "./Label.svelte";
	import HelpToggle from "./HelpToggle.svelte";
	import HelpPanel from "./HelpPanel.svelte";

	interface Props {
		label: string;
		children: import("svelte").Snippet;
		help?: import("svelte").Snippet;
		note?: string;
		warn?: string | null;
	}
	let { label, children, help, note, warn }: Props = $props();
	let open = $state(false);
</script>

<div class="mb-9">
	<div class="flex items-center gap-2 mb-3">
		<Label>{tc(label)}</Label>
		{#if help}
			<HelpToggle {open} onclick={() => (open = !open)} label={`Help: ${label}`} />
		{/if}
	</div>
	{@render children()}
	{#if note}
		<div class="field-note text-[13px] mt-3 leading-relaxed">{note}</div>
	{/if}
	{#if warn}
		<div class="field-warn text-[13px] mt-3 leading-relaxed pl-3">{warn}</div>
	{/if}
	{#if help && open}
		<HelpPanel>{@render help()}</HelpPanel>
	{/if}
</div>

<style>
	.field-note { color: var(--color-text-muted); }
	.field-warn { color: var(--color-danger); border-left: 2px solid var(--color-danger); }
</style>
