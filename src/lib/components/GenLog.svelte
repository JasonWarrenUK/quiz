<script lang="ts">
	import type { GenLog } from "$lib/types";

	interface Props {
		logs: GenLog[];
	}
	let { logs }: Props = $props();
</script>

<div class="flex flex-col gap-4 text-[12px] root">
	{#each logs as l, i (i)}
		<div class="pl-3 entry">
			<div class="font-semibold text-[13px] mb-1 serif-text" style="font-size: 1rem;">{l.topic}</div>
			<div class="muted">
				model: none · members: {l.members ?? "?"} · web check {l.search ? "on" : "off"}{l.difficulty ? ` · ${l.difficulty.toLowerCase()}` : ""}{l.format ? ` · fixed format: ${l.format}` : l.formatDecided ? ` · format: ${l.formatDecided}` : ""}
				{#if l.reused}<span class="accent"> · kept from last time</span>{/if}
				{#if l.toppedUp !== undefined}<span class="accent"> · topped up from {l.toppedUp}</span>{/if}
				{#if l.shortfall && l.shortfall > 0}<span class="danger"> · short by {l.shortfall}</span>{/if}
				{#if l.memberNote}<span class="accent"> · {l.memberNote}</span>{/if}
				{#if l.reading}<div class="mt-1">reading — includes: {l.reading.includes}; excludes: {l.reading.excludes}; answers are: {l.reading.answers}</div>{/if}
				{#if l.judgeConstraints}<div class="mt-1">judge's constraints: {l.judgeConstraints.join("; ")}</div>{/if}
				{#if l.totals && l.totals.calls}<div class="mt-1">run total: {l.totals.calls} call{l.totals.calls === 1 ? "" : "s"} · {l.totals.inputTokens.toLocaleString()} in / {l.totals.outputTokens.toLocaleString()} out{l.totals.cacheReadTokens ? ` · ${l.totals.cacheReadTokens.toLocaleString()} from cache` : ""}{l.totals.cacheWriteTokens ? ` · ${l.totals.cacheWriteTokens.toLocaleString()} written to cache` : ""}{l.totals.searches ? ` · ${l.totals.searches} search${l.totals.searches === 1 ? "" : "es"}` : ""} · {(l.totals.ms / 1000).toFixed(1)}s in calls</div>{/if}
				{#if l.acceptedWithProblems}<span class="accent"> · {l.acceptedWithProblems}</span>{/if}
				{#if l.fatal}<span class="danger"> · {l.fatal}</span>{/if}
				{#if l.cancelled}<span class="danger"> · cancelled</span>{/if}
			</div>
			{#each l.attempts || [] as a, j (j)}
				<div class="mt-2 pt-2 attempt">
					<div>{a.stage || "call"} {a.call}{a.asked ? ` (${a.stage === "plan" ? "needed" : a.stage === "write" ? "asked for" : "checked"} ${a.asked})` : ""} · {a.model} · HTTP {a.status ?? "—"}{a.stopReason ? ` · stop: ${a.stopReason}` : ""}{a.usage ? ` · ${a.usage}` : ""}{a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ""}{a.rateWaits ? ` · waited out ${a.rateWaits} rate limit${a.rateWaits === 1 ? "" : "s"}` : ""}</div>
					{#if a.searches}<div class="muted">searches: {a.searches}</div>{/if}
					{#if a.toolErrors}<div class="danger">search errors: {a.toolErrors}</div>{/if}
					{#if a.sourceNote}<div class="accent">sources: {a.sourceNote}</div>{/if}
					{#if a.pauses}<div class="accent">paused and resumed {a.pauses}×</div>{/if}
					{#if a.batchNote}<div class="accent">{a.batchNote}</div>{/if}
					{#if a.relaxNote}<div class="accent">{a.relaxNote}</div>{/if}
					{#if a.transportRetry}<div class="accent">transport: {a.transportRetry}</div>{/if}
					{#if a.apiError}<div class="danger">api: {a.apiError}</div>{/if}
					{#if a.parse}<div class={a.parse.startsWith("failed") ? "danger" : a.parse.startsWith("ok") ? "muted" : "accent"}>parse: {a.parse}</div>{/if}
					{#if a.validation}<div class={/^all /.test(a.validation) ? "muted" : "accent"}>validation: {a.validation}</div>{/if}
					{#if a.subjects}<div class="muted">subjects: {a.subjects.join(" / ")}</div>{/if}
					{#if a.rawHead}<pre class="mt-1 whitespace-pre-wrap break-words muted">{a.rawHead}</pre>{/if}
				</div>
			{/each}
		</div>
	{/each}
</div>

<style>
	.root { color: var(--color-text); }
	.entry { border-left: 2px solid var(--color-text-faint); }
	.attempt { border-top: 1px solid var(--color-border); }
	.muted { color: var(--color-text-muted); }
	.accent { color: var(--color-primary); }
	.danger { color: var(--color-danger); }
</style>
