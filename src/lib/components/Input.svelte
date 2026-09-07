<script lang="ts">
	interface Props {
		value: string;
		onchange: (v: string) => void;
		placeholder?: string;
		accent?: boolean;
	}
	let { value, onchange, placeholder = "", accent = false }: Props = $props();
</script>

<input
	{value}
	oninput={(e) => onchange(e.currentTarget.value)}
	{placeholder}
	class="qn-input w-full bg-transparent px-0 py-2 text-[16px] transition-colors"
	class:qn-input-accent={accent}
/>

<style>
	.qn-input { color: var(--color-text); border-bottom: 1px solid var(--color-text-faint); font-family: var(--font-sans); }
	.qn-input-accent { border-bottom-color: var(--color-primary); }
</style>
