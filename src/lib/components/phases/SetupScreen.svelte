<script lang="ts">
	import type { QuizState } from "$lib/quiz-state.svelte";
	import type { Difficulty } from "$lib/types";
	import { DIFFS, MODES, WINS, needs } from "$lib/quiz-logic";
	import Shell from "../Shell.svelte";
	import H from "../H.svelte";
	import Field from "../Field.svelte";
	import Small from "../Small.svelte";
	import Input from "../Input.svelte";
	import Chip from "../Chip.svelte";
	import Check from "../Check.svelte";
	import Stepper from "../Stepper.svelte";
	import HelpList from "../HelpList.svelte";
	import StepBar from "./StepBar.svelte";
	import Nav from "./Nav.svelte";

	interface Props {
		quiz: QuizState;
	}
	let { quiz }: Props = $props();

	const DIFF_HELP: Record<Difficulty, string> = {
		Easy: "Things most people at the table will know or half-remember.",
		Medium: "Standard quiz. A fan of the topic gets most; everyone else gets a few.",
		Hard: "For people who chose the topic because they know it cold. Expect blanks."
	};

	let readEach = $derived(quiz.perTopic);
	let answerEach = $derived(quiz.legalMode === "buzzer" ? quiz.total - quiz.perTopic : quiz.legalMode === "solo" ? quiz.total : quiz.perTopic);
	let allSame = $derived(quiz.players.every((p) => p.difficulty === quiz.players[0].difficulty) ? quiz.players[0].difficulty : null);
</script>

<Shell>
	<StepBar setupStep={quiz.setupStep} onselect={(n) => (quiz.setupStep = n)} />

	{#if quiz.setupStep === 1}
		<H title="Quiz Night" sub="A quiz on one phone, passed round the table. Whoever's holding it reads; the rules make sure that costs nobody anything." />
		<Field label="How many are playing" help={helpPlayerCount}>
			<div class="flex gap-2">
				{#each [1, 2, 3, 4, 5] as n (n)}
					<button
						onclick={() => { quiz.setCount(n); quiz.notice = ""; }}
						class="count-btn w-12 h-12 rounded-[3px] serif-text nums transition-colors"
						class:count-btn-active={quiz.N === n}
						style="font-size: 1.5rem;"
					>{n}</button>
				{/each}
			</div>
		</Field>
		<Small>
			{quiz.N === 1 ? "Solo: you read, answer and mark yourself." : quiz.N === 2 ? "Two players take turns; one reads while the other answers." : `${quiz.N} players: turns or a shouting race, your choice on the last step.`}
		</Small>
		{#if quiz.failedTests.length > 0}
			<Small tone="danger" class="mt-4">
				{quiz.failedTests.length} internal self-check{quiz.failedTests.length === 1 ? "" : "s"} failed at load: {quiz.failedTests.map((t) => t.name).join("; ")}. The app will run, but validation may misbehave; the dev log has details.
			</Small>
		{/if}
		<Nav setupStep={quiz.setupStep} nextLabel="Next: topics" onnext={() => (quiz.setupStep = 2)} />
	{/if}

	{#if quiz.setupStep === 2}
		<Field label={quiz.N === 1 ? "Your name, topic and difficulty" : "One topic each, with its difficulty"} warn={[...quiz.overlapWarn, quiz.nonLatinWarn].filter(Boolean).join(" ") || null} help={helpTopics}>
			<div class="flex flex-col gap-7">
				{#each quiz.players as p, i (i)}
					<div class="grid grid-cols-[2rem_1fr] gap-x-3">
						<div class="index-num serif-text nums pt-1" style="font-size: 1.6rem; font-style: italic; line-height: 1;">{i + 1}</div>
						<div>
							<Input value={p.name} onchange={(v) => quiz.upd(i, "name", v)} placeholder={`Player ${i + 1}`} />
							<div class="mt-2"><Input value={p.topic} onchange={(v) => quiz.upd(i, "topic", v)} placeholder="Topic" accent={!!p.topic} /></div>
							<div class="flex items-center gap-2 mt-3 text-[12.5px] diff-row">
								<span class="mr-auto">Difficulty</span>
								{#each DIFFS as d (d)}
									<Chip small active={p.difficulty === d} onclick={() => quiz.upd(i, "difficulty", d)}>{d}</Chip>
								{/each}
							</div>
							<div class="mt-2">
								<button
									onclick={() => (quiz.formatOpen = { ...quiz.formatOpen, [i]: !quiz.formatOpen[i] })}
									class="format-toggle text-[12.5px] underline underline-offset-4 decoration-1"
									class:format-toggle-active={!!p.format}
								>
									{p.format ? `Fixed format: ${p.format}` : quiz.formatOpen[i] ? "Fixed question format (leave blank for mixed)" : "Fix the question format?"}
								</button>
								{#if quiz.formatOpen[i]}
									<div class="mt-1"><Input value={p.format || ""} onchange={(v) => quiz.upd(i, "format", v)} placeholder={"e.g. Which country's flag has..."} accent={!!p.format} /></div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>
			{#if quiz.N > 1}
				<div class="flex items-center gap-2 mt-6 text-[12.5px] set-all" style="padding-left: 2.75rem;">
					<span>Set all to</span>
					{#each DIFFS as d (d)}
						<Chip small active={allSame === d} onclick={() => quiz.setAllDiff(d)}>{d}</Chip>
					{/each}
				</div>
			{/if}
		</Field>
		<Nav setupStep={quiz.setupStep} nextLabel={quiz.ready ? "Next: rules" : "Give everyone a topic first"} onnext={() => (quiz.setupStep = 3)} onback={() => (quiz.setupStep = 1)} nextDisabled={!quiz.ready} />
	{/if}

	{#if quiz.setupStep === 3}
		<Field
			label="Length"
			note={`${quiz.total} questions in total.${quiz.N === 1 ? "" : ` Each player reads ${readEach} and can answer ${answerEach}.`}`}
			help={helpLength}
		>
			<Stepper value={quiz.perTopic} min={2} max={10} onchange={(v) => { quiz.perTopic = v; quiz.target = null; }} suffix=" per topic" />
			<Check checked={quiz.useSearch} onchange={(v) => (quiz.useSearch = v)}>Check answers against the web: slower, fewer wrong answers</Check>
		</Field>

		<Field label="How it's played" note={MODES[quiz.legalMode].blurb} help={helpMode}>
			<div class="flex gap-2 flex-wrap">
				{#each Object.entries(MODES) as [k, m] (k)}
					{@const ok = m.min <= quiz.N && quiz.N <= m.max}
					<Chip active={quiz.legalMode === k} dim={!ok} onclick={() => (ok ? (quiz.setMode(k as never), (quiz.notice = "")) : (quiz.notice = `${m.label} ${needs(m)}.`))}>{m.label}</Chip>
				{/each}
			</div>
			{#if quiz.N >= 2}
				<div class="mt-4 pl-4 own-topic-block">
					<Check checked={quiz.ownTopic === "allow"} onchange={(v) => (quiz.ownTopic = v ? "allow" : "avoid")}>Players can be asked questions from their own topic</Check>
					{#if quiz.legalMode === "turns" && quiz.N >= 3}
						<Check checked={quiz.steals} onchange={(v) => (quiz.steals = v)}>Allow steals: if the answerer misses, anyone but the reader can take it</Check>
						{#if quiz.steals}
							<div class="flex items-center gap-2 mt-3 ml-7 text-[12.5px] steal-row">
								<span>A steal is worth</span>
								<Chip small active={quiz.stealValue === 0.5} onclick={() => { quiz.stealValue = 0.5; quiz.target = null; }}>½ point</Chip>
								<Chip small active={quiz.stealValue === 1} onclick={() => { quiz.stealValue = 1; quiz.target = null; }}>1 point</Chip>
							</div>
						{/if}
					{/if}
					{#if quiz.legalMode === "buzzer"}
						<div class="flex items-center gap-2 mt-4 text-[12.5px] flex-wrap steal-row">
							<span>Shout clock</span>
							{#each [0, 10, 20, 30] as sec (sec)}
								<Chip small active={quiz.buzzerTimer === sec} onclick={() => (quiz.buzzerTimer = sec)}>{sec === 0 ? "Off" : `${sec}s`}</Chip>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</Field>

		<Field label="How you win" note={WINS[quiz.legalWin].blurb} help={helpWin}>
			<div class="flex gap-2 flex-wrap">
				{#each Object.entries(WINS) as [k, w] (k)}
					{@const ok = w.min <= quiz.N && quiz.N <= w.max}
					<Chip active={quiz.legalWin === k} dim={!ok} onclick={() => (ok ? (quiz.setWin(k as never), (quiz.notice = "")) : (quiz.notice = `${w.label} ${needs(w)}.`))}>{w.label}</Chip>
				{/each}
			</div>
			{#if quiz.setupTarget !== null}
				<div class="mt-4">
					<Stepper value={quiz.setupTarget} min={1} max={quiz.maxTarget} onchange={(v) => (quiz.target = v)} suffix={quiz.legalWin === "coop" ? ` of ${quiz.total}` : " points"} />
				</div>
			{/if}
		</Field>

		{#if quiz.notice}
			<div class="text-[13px] mb-4 pl-3 notice">{quiz.notice}</div>
		{/if}
		<Nav
			setupStep={quiz.setupStep}
			nextTone="brass"
			nextLabel={quiz.banksKey === quiz.keyFor() && quiz.banks.some((b) => b?.length) ? "Write the questions (reusing what's kept)" : "Write the questions"}
			onnext={() => quiz.generate()}
			onback={() => (quiz.setupStep = 2)}
			nextDisabled={!quiz.ready}
		/>
		<Small class="mt-4">Rounds aren't saved: refreshing or closing this page loses one in progress.</Small>
	{/if}
</Shell>

{#snippet helpPlayerCount()}
	Player count sets which modes and win conditions are available; greyed options say why when you tap them. One person plays solo and marks themselves; two can only take turns, because a race with one runner isn't a race.
{/snippet}

{#snippet helpTopics()}
	<p class="mb-2">Anything goes: Roman roads, 90s indie B-sides, the Bundesliga, your mum's garden. Sharper topics get sharper questions. Questions are split equally across topics{quiz.N === 1 ? "." : ", and each topic's questions are told to keep off the other topics' ground."}</p>
	<p class="mb-2">Difficulty is per topic. {quiz.N === 1 ? "" : "Everyone answers everyone else's topic, so the expert's topic can be hard while a lighter one stays easy."}</p>
	<p class="mb-2">A fixed question format makes every question in that topic follow one pattern ("Which country's flag has..."), with the variety in the answers. Left blank, the quiz decides: most topics get mixed angles; a few, like flags or capitals, are given one pattern because the repetition suits them.</p>
	<HelpList items={DIFFS.map((d) => ({ title: d, body: DIFF_HELP[d] }))} />
{/snippet}

{#snippet helpLength()}
	<p class="mb-2">The total is always players × questions per topic, which is what keeps the reading fair: every player reads exactly {quiz.perTopic}, whatever the mode.</p>
	<p>Checking answers against the web makes the model confirm each answer with a search before it's used. It roughly doubles the writing time and the questions are written one or two at a time; turn it off for a quick round. Each answer shows whether it was checked.</p>
{/snippet}

{#snippet helpMode()}
	<HelpList items={Object.values(MODES).map((m) => ({ title: m.label, body: m.blurb, unavailable: m.min <= quiz.N && quiz.N <= m.max ? null : needs(m) }))} />
	<p class="mt-3 muted">In every mode the reader sees the answer and can't take the point. The schedule rotates so everyone reads the same number of times, and in Turns the reader and answerer pairings change from round to round.</p>
	<p class="mt-2 muted">"Own topic" decides whether a player can ever be asked a question from the topic they chose. Off, the chooser reads their own topic in First to shout and is never the answerer in Turns. On, topics rotate freely and the chooser is treated like anyone else.</p>
	{#if quiz.legalMode === "buzzer"}
		<p class="mt-2 muted">The clock, if on, is started by the reader after reading. It's a prompt, not a rule: the reader can reveal early if someone shouts, or press "no one" when it runs out.</p>
	{/if}
{/snippet}

{#snippet helpWin()}
	<HelpList items={Object.values(WINS).map((w) => ({ title: w.label, body: w.blurb, unavailable: w.min <= quiz.N && quiz.N <= w.max ? null : needs(w) }))} />
	<p class="mt-3 muted">Targets start at a sensible default for this length and mode; adjust with the stepper. Race and team target can end the quiz early. If a round has to be played shorter than planned, a target you set is scaled down with it.</p>
{/snippet}

<style>
	.count-btn { background: transparent; color: var(--color-text); box-shadow: inset 0 0 0 1px var(--color-text-faint); }
	.count-btn-active { background: var(--color-primary); color: var(--color-on-primary); box-shadow: none; }
	.index-num { color: var(--color-primary); }
	.diff-row, .set-all { color: var(--color-text-muted); }
	.format-toggle { color: var(--color-text-muted); text-decoration-color: var(--color-text-faint); }
	.format-toggle-active { color: var(--color-primary); }
	.own-topic-block { border-left: 2px solid var(--color-text-faint); }
	.steal-row { color: var(--color-text-muted); }
	.notice { color: var(--color-primary); border-left: 2px solid var(--color-accent-muted); }
	.muted { color: var(--color-text-muted); }
</style>
