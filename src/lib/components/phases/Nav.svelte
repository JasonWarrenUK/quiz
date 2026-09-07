<script lang="ts">
	import Btn from "../Btn.svelte";

	interface Props {
		setupStep: number;
		nextLabel: string;
		onnext: () => void;
		onback?: () => void;
		nextDisabled?: boolean;
		nextTone?: "paper" | "brass" | "ghost" | "ember";
	}
	let { setupStep, nextLabel, onnext, onback, nextDisabled = false, nextTone = "paper" }: Props = $props();
</script>

<div class="flex gap-2 mt-10">
	{#if setupStep > 1 && onback}
		<Btn tone="ghost" onclick={onback}>Back</Btn>
	{/if}
	<Btn tone={nextTone} onclick={onnext} disabled={nextDisabled} full>{nextLabel}</Btn>
</div>
