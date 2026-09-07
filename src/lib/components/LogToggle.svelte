<script lang="ts">
	import type { GenLog } from "$lib/types";
	import GenLogView from "./GenLog.svelte";

	interface Props {
		logs: GenLog[];
		label?: string;
	}
	let { logs, label = "how the questions were made" }: Props = $props();
	let show = $state(false);
</script>

<div class="mt-6">
	<button onclick={() => (show = !show)} class="toggle text-[13px] underline underline-offset-4 decoration-1">
		{show ? "Hide" : "Show"} {label}
	</button>
	{#if show}
		<div class="mt-4"><GenLogView {logs} /></div>
	{/if}
</div>

<style>
	.toggle { color: var(--color-text-muted); text-decoration-color: var(--color-text-faint); }
</style>
