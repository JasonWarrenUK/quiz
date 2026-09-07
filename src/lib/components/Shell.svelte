<script lang="ts">
	interface Props {
		children: import("svelte").Snippet;
	}
	let { children }: Props = $props();
</script>

<div class="qn min-h-screen w-full flex justify-center">
	<div class="w-full max-w-[34rem] px-6 pt-10 pb-16">
		{@render children()}
	</div>
</div>
