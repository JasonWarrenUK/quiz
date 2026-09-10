import type { Question, DroppedEntry } from "../../src/lib/types";

export const romanceTopic = "The evolution of vulgar Latin into romance languages";
export const republicTopic = "Roman republic (from the gracchi to julius caesar)";

// The first plan entry, as it would be recorded after failing at write.
export const droppedGermanic: DroppedEntry[] = [
	{ subject: "Germanic branch", angle: "where it spread from", a: "the steppe", why: "answerable from the wording" }
];

export const truncatedPlanResponse = `{"members": 47, "questions": [{"subject":["Vulgar Latin","what-called"],"level":3,"q":"Q?","a":"Vulgar Latin","alt":["sermo vulgaris"]},{"subject":["sound change in Gallo-Romance",`;

export const planEntries = [
	{ member: "Germanic branch", angle: "where it spread from", answer: "the steppe", level: 2, jargon: false },
	{ member: "PIE homeland", angle: "where it was", answer: "Pontic steppe", level: 2, jargon: false },
	{ member: "Italic branch", angle: "parent language", answer: "Latin", level: 1, jargon: false },
	{ member: "Italic branch", angle: "a daughter", answer: "French", level: 1, jargon: false },
	{ member: "Anatolian branch", angle: "its known language", answer: "Hittite", level: 3, jargon: false },
	{ member: "Hellenic branch", angle: "a term", answer: "aorist", level: 2, jargon: true }
];

export const sampleQuestionBank = (topicIndex: number, count: number): Question[] =>
	Array.from({ length: count }, (_, r) => ({
		subject: `subject-${topicIndex}`,
		angle: "angle",
		a: `answer-${topicIndex}-${r}`,
		alt: [],
		level: 2,
		jargon: false,
		verified: null,
		q: `${topicIndex}-${r}`
	}));
