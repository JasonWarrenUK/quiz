<script lang="ts">
	import './layout.css';
	import '$lib/styles/tokens.css';
	import '$lib/styles/quiz.css';
	import favicon from '$lib/assets/favicon.svg';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<ThemeToggle />
{@render children()}
