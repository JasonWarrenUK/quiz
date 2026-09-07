<script lang="ts">
	import './layout.css';
	import '$lib/styles/tokens.css';
	import '$lib/styles/quiz.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
{@render children()}
