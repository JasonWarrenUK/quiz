import { describe, it, expect } from "vitest";
import * as fixtures from "../../tests/fixtures/quiz-logic";
import {
	same,
	answerLeaks,
	salvageQuestions,
	topicOverlap,
	answersCollide,
	selectPlan,
	enumeratesAnswerCount,
	hasNonLatin,
	tc,
	polish,
	buildSchedule,
	parseObject,
	runSelfTests
} from "./quiz-logic";

describe("runSelfTests (ported artefact fixtures)", () => {
	it("every self-test passes", () => {
		const results = runSelfTests();
		const failed = results.filter((r) => !r.ok);
		expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
	});
});

describe("same", () => {
	it("matches a whole-word prefix", () => {
		expect(same("constantine", "constantine i")).toBe(true);
	});
	it("does not match distinct regnal numerals", () => {
		expect(same("constantine i", "constantine ii")).toBe(false);
	});
});

describe("answerLeaks", () => {
	it("catches a single-word answer restated in the question", () => {
		expect(answerLeaks("Italian dropped final vowels; which language is this?", ["Italian"], fixtures.romanceTopic)).toBe("Italian");
	});
	it("exempts topic words from the leak check", () => {
		expect(answerLeaks("What did Romans call the everyday spoken form of their language?", ["Vulgar Latin"], fixtures.romanceTopic)).toBeNull();
	});
});

describe("salvageQuestions", () => {
	it("recovers complete entries from a response truncated mid-array", () => {
		const result = salvageQuestions(fixtures.truncatedPlanResponse);
		expect(result.complete).toBe(false);
		expect(result.questions).toHaveLength(1);
		expect(result.members).toBe(47);
	});
});

describe("topicOverlap", () => {
	it("flags identical topics as same", () => {
		expect(topicOverlap("Roman emperors", "roman emperors")).toBe("same");
	});
	it("flags distinct topics as no overlap", () => {
		expect(topicOverlap("Great apes", "Planets")).toBeNull();
	});
});

describe("answersCollide", () => {
	it("treats a shared long stem as a collision", () => {
		expect(answersCollide("the steppe", "Pontic steppe")).toBe(true);
	});
	it("keeps short numeric/initialism tokens exact", () => {
		expect(answersCollide("AD", "AD 476")).toBe(false);
		expect(answersCollide("two", "two")).toBe(true);
	});
	it("keeps distinct regnal numbers distinct", () => {
		expect(answersCollide("Constantine I", "Constantine II")).toBe(false);
	});
});

describe("selectPlan", () => {
	it("rejects repeated answers, repeated members, and out-of-band levels", () => {
		const r = selectPlan(fixtures.planEntries, 6, "Easy", [], 10, 6);
		expect(r.chosen).toHaveLength(2);
		expect(r.rejected).toHaveLength(4);
	});
});

describe("enumeratesAnswerCount", () => {
	it("flags a count question that lists the very things being counted", () => {
		expect(enumeratesAnswerCount("Ancient Greek is divided into how many major dialect groups, including Doric, Ionic, Aeolic and Arcado-Cypriot?", "four")).toBe(true);
	});
	it("does not flag an unrelated numeric answer", () => {
		expect(enumeratesAnswerCount("Which of Doric, Ionic and Aeolic was spoken in Sparta?", "Doric")).toBe(false);
	});
});

describe("hasNonLatin", () => {
	it("detects non-Latin scripts", () => {
		expect(hasNonLatin("Ελληνικά")).toBe(true);
		expect(hasNonLatin("日本")).toBe(true);
	});
	it("accepts accented Latin text", () => {
		expect(hasNonLatin("Café Français, naïve — ok?")).toBe(false);
	});
});

describe("tc (title case)", () => {
	it("lowercases small words except at the edges", () => {
		expect(tc("the table wins")).toBe("The Table Wins");
	});
	it("preserves internal capitals", () => {
		expect(tc("emperors after AD 476")).toBe("Emperors After AD 476");
	});
});

describe("polish", () => {
	it("collapses a double dash into parentheses", () => {
		expect(polish("When unstressed vowels dropped out — turning 'oculum' into 'oclo' — what term names this?", "q"))
			.toBe("When unstressed vowels dropped out (turning 'oculum' into 'oclo'), what term names this?");
	});
	it("britishises spelling", () => {
		expect(polish("Which color did the organization favor in its center?", "q")).toBe("Which colour did the organisation favour in its centre?");
	});
	it("appends a question mark and strips throat-clearing openers", () => {
		expect(polish("Famously, which planet has a day longer than its year", "q")).toBe("Which planet has a day longer than its year?");
	});
	it("strips a trailing stop from an answer", () => {
		expect(polish("Venus.", "a")).toBe("Venus");
	});
});

describe("buildSchedule", () => {
	it("gives every player an equal read count in turns mode", () => {
		const banks = [0, 1, 2].map((i) => fixtures.sampleQuestionBank(i, 4));
		const sched = buildSchedule(banks, 3, "turns", "avoid");
		const reads = [0, 0, 0];
		for (const q of sched) reads[q.reader]++;
		expect(reads).toEqual([4, 4, 4]);
	});
	it("never lets the reader answer their own question in turns mode", () => {
		const banks = [0, 1, 2, 3].map((i) => fixtures.sampleQuestionBank(i, 3));
		const sched = buildSchedule(banks, 4, "turns", "avoid");
		expect(sched.every((q) => q.reader !== q.answerer)).toBe(true);
	});
	it("keeps the topic chooser off their own topic in buzzer mode when avoiding", () => {
		const banks = [0, 1, 2].map((i) => fixtures.sampleQuestionBank(i, 3));
		const sched = buildSchedule(banks, 3, "buzzer", "avoid");
		expect(sched.every((q) => q.reader === q.topic)).toBe(true);
	});
});

describe("parseObject", () => {
	it("parses a complete JSON object", () => {
		const result = parseObject(`preamble {"members": 8, "questions": [{"q":"a","a":"b"}]}`, "questions");
		expect(result.complete).toBe(true);
	});
	it("preserves a reading block salvaged alongside a cut-off plan", () => {
		const cut = `{"reading":{"includes":"branches","excludes":"languages","answers":"a branch"},"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false},{"mem`;
		const result = parseObject(cut, "plan");
		expect(result.obj.reading?.excludes).toBe("languages");
	});
});
