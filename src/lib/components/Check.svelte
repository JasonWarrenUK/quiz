<script lang="ts">
	interface Props {
		checked: boolean;
		onchange: (v: boolean) => void;
		children: import("svelte").Snippet;
	}
	let { checked, onchange, children }: Props = $props();
</script>

<label class="flex items-start gap-3 mt-3 text-[14px] cursor-pointer select-none">
	<span class="box mt-[3px] w-4 h-4 rounded-[2px] shrink-0 inline-flex items-center justify-center" class:box-checked={checked}>
		{#if checked}
			<svg width="10" height="8" viewBox="0 0 10 8" fill="none">
				<path d="M1 4l2.6 2.6L9 1" stroke="var(--color-on-primary)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
			</svg>
		{/if}
	</span>
	<input type="checkbox" class="sr-only" {checked} onchange={(e) => onchange(e.currentTarget.checked)} />
	<span>{@render children()}</span>
</label>

<style>
	.box { background: transparent; box-shadow: inset 0 0 0 1px var(--color-text-faint); }
	.box-checked { background: var(--color-primary); box-shadow: none; }
</style>
