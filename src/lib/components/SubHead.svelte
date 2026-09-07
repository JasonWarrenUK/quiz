<script lang="ts">
	import { tc } from "$lib/quiz-logic";
	interface Props {
		text: string;
	}
	let { text }: Props = $props();
</script>

<div class="font-semibold mb-1 serif-text" style="font-size: 1rem;">{tc(text)}</div>
