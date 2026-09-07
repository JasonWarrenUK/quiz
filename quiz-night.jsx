import { useState, useMemo, useRef, useEffect } from "react";

const VERSION = "2026-09-06";

// ---------- palette & type ----------
// Evening indigo, unbleached paper, brass. Fraunces carries the voice (titles,
// questions, names, scores); Instrument Sans does the quiet work of controls.
const C = {
  ink: "#1C2140",
  inkDeep: "#141833",
  paper: "#EFEAE0",
  paperDim: "rgba(239,234,224,0.62)",
  paperFaint: "rgba(239,234,224,0.34)",
  brass: "#D6AA52",
  brassDim: "rgba(214,170,82,0.55)",
  ember: "#D2603F",
  line: "rgba(239,234,224,0.16)",
};
const SERIF = "'Fraunces', 'Iowan Old Style', Georgia, serif";
const SANS = "'Instrument Sans', system-ui, sans-serif";

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Instrument+Sans:wght@400;500;600&display=swap');
.qn { font-family: ${SANS}; color: ${C.paper}; background: ${C.ink}; -webkit-font-smoothing: antialiased; }
.qn ::selection { background: ${C.brass}; color: ${C.ink}; }
.qn input::placeholder { color: ${C.paperFaint}; }
.qn button:focus-visible, .qn input:focus-visible { outline: 2px solid ${C.brass}; outline-offset: 3px; }
.qn .serif { font-family: ${SERIF}; font-variation-settings: "opsz" 144, "SOFT" 0, "WONK" 0; }
.qn .serif-text { font-family: ${SERIF}; font-variation-settings: "opsz" 24; }
.qn .nums { font-variant-numeric: tabular-nums lining-nums; }
@keyframes qn-reveal { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.qn .reveal { animation: qn-reveal 360ms cubic-bezier(.2,.7,.2,1) both; }
@keyframes qn-breathe { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
.qn .breathe { animation: qn-breathe 1.8s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .qn .reveal, .qn .breathe { animation: none; } }
`;

const MODES = {
  solo:   { label: "Solo",           min: 1, max: 1, blurb: "You read, you answer, you mark yourself. No cheating; nobody's watching." },
  turns:  { label: "Turns",          min: 2, max: 5, blurb: "One player answers each question while another reads it. Pairings rotate." },
  buzzer: { label: "First to shout", min: 3, max: 5, blurb: "One player reads; everyone else races to answer. Needs three so the race is a race." },
};

const WINS = {
  count:   { label: "Just count",    min: 1, max: 5, blurb: "No target, no winner declared. Play the questions and see how you did." },
  target:  { label: "Hit a target",  min: 1, max: 1, blurb: "Reach a set number of correct answers." },
  highest: { label: "Highest score", min: 2, max: 5, blurb: "Most points when the questions run out." },
  race:    { label: "Race to a score", min: 2, max: 5, blurb: "First to reach the target wins on the spot. The quiz may end early." },
  coop:    { label: "Team target",   min: 2, max: 5, blurb: "Everyone against the quiz. Pooled score must reach the target." },
};

const DIFFS = ["Easy", "Medium", "Hard"];
const BAD_REASONS = ["Wrong answer", "Off topic", "Too easy", "Too hard", "Answer given away", "Ambiguous", "Other"];

// ---------- pure helpers (self-tested below) ----------
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const same = (a, b) => a === b || (b.startsWith(a) && b[a.length] === " ") || (a.startsWith(b) && a[b.length] === " ");
const hasNonLatin = s => /[^\u0000-\u024F\u1E00-\u1EFF\s\p{P}\p{N}]/u.test(String(s || ""));
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));

const STOP = new Set(["the","and","of","in","a","an","to","for","with","from","by","on","at","or","is","was","were","its","into","that","this","which","what","who","how","when","where","why","did","does","do","as","are","be","been","it","not","one","two","first","early","late","new","old","north","south","east","west","between","their","them","they","about","most","more","some","very","also","than","then","only","just","over","under"]);
const sigWords = t => norm(t).split(" ").filter(w => w && w.length >= 4 && !STOP.has(w));

// Does the question give the whole answer away? Every distinctive word of the
// answer (stem-matched) present in the question. Topic words are exempt.
function answerLeaks(q, answers, topic) {
  const topicStems = new Set(sigWords(topic).map(w => w.slice(0, 5)));
  const qStems = new Set(norm(q).split(" ").filter(Boolean).map(w => w.slice(0, 5)));
  for (const ans of answers) {
    const sig = sigWords(ans).map(w => w.slice(0, 5)).filter(st => !topicStems.has(st));
    if (!sig.length) continue;
    if (sig.every(st => qStems.has(st))) return ans;
  }
  return null;
}

// A numeric answer whose question lists at least that many items is a
// counting exercise, not a question. "How many groups, including A, B, C and
// D?" → four. Items are taken from the clause after including/such as/namely,
// or from any run of comma-separated capitalised terms.
const numericValue = a => { const n = normAnswer(a); const m = n.match(/^(\d+)(?: |$)/); return m ? Number(m[1]) : null; };
function enumeratesAnswerCount(q, a) {
  const n = numericValue(a);
  if (n === null || n < 2) return false;
  const text = String(q || "");
  const clause = (text.match(/(?:including|such as|namely|like|comprising|consisting of)\s+([^?.;:]+)/i) || [])[1];
  const count = str => str.split(/,|\band\b|\bor\b|&/).map(x => x.trim()).filter(Boolean).length;
  if (clause && count(clause) >= n) return true;
  const runs = text.match(/(?:[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*)(?:,\s*(?:[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*))+(?:,?\s*(?:and|or)\s*[A-Z][\w'-]+(?:\s[A-Z][\w'-]+)*)?/g) || [];
  return runs.some(r => count(r) >= n);
}

// Two topics that are the same or largely overlap.
function topicOverlap(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return null;
  if (na === nb) return "same";
  const sa = new Set(sigWords(a).map(w => w.slice(0, 5))), sb = new Set(sigWords(b).map(w => w.slice(0, 5)));
  if (!sa.size || !sb.size) return null;
  const inter = [...sa].filter(x => sb.has(x)).length;
  const smaller = Math.min(sa.size, sb.size);
  return inter / smaller >= 0.5 ? "overlap" : null;
}

// Recover complete question objects from a JSON response that may have been cut
// off. String-aware bracket scan; each complete top-level object is parsed.
function salvageQuestions(text) {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const st = clean.indexOf("{"), en = clean.lastIndexOf("}");
    const full = JSON.parse(clean.slice(st, en + 1));
    if (Array.isArray(full.questions)) return { members: full.members, questions: full.questions, complete: true };
  } catch { /* fall through */ }
  const mMatch = clean.match(/"members"\s*:\s*(\d+)/);
  const members = mMatch ? Number(mMatch[1]) : undefined;
  const qi = clean.indexOf('"questions"');
  const arr = qi >= 0 ? clean.indexOf("[", qi) : -1;
  const out = [];
  if (arr >= 0) {
    let depth = 0, inStr = false, esc = false, objStart = -1;
    for (let i = arr + 1; i < clean.length; i++) {
      const ch = clean[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') { inStr = true; continue; }
      if (ch === "{") { if (depth === 0) objStart = i; depth++; }
      else if (ch === "}") { depth--; if (depth === 0 && objStart >= 0) { try { out.push(JSON.parse(clean.slice(objStart, i + 1))); } catch { /* skip */ } objStart = -1; } }
      else if (ch === "]" && depth === 0) break;
    }
  }
  return { members, questions: out, complete: false };
}

// Pull the pieces out of a tool-using response by block type.
function unpackContent(content) {
  const text = content.filter(b => b.type === "text").map(b => b.text || "").join("\n");
  const searches = content.filter(b => b.type === "server_tool_use").map(b => b.input?.query || "(no query)");
  const results = content.filter(b => b.type === "web_search_tool_result");
  const toolErrors = results
    .map(r => (r.content && !Array.isArray(r.content) && r.content.type === "web_search_tool_result_error") ? r.content.error_code : null)
    .filter(Boolean);
  const resultCount = results.reduce((n, r) => n + (Array.isArray(r.content) ? r.content.length : 0), 0);
  return { text, searches, toolErrors, resultCount };
}


// Title case for headings. Small words stay lower unless first or last; words
// with their own capitals (AD, McCoy) are left alone.
const TC_SMALL = new Set(["a","an","the","and","but","or","nor","for","so","yet","at","by","in","of","on","to","up","as","per","via","from","with","into","over","off","than","its"]);
function tc(str) {
  const words = String(str).split(/(\s+)/);
  const isWord = w => /\S/.test(w);
  const idxs = words.map((w, i) => (isWord(w) ? i : -1)).filter(i => i >= 0);
  const first = idxs[0], last = idxs[idxs.length - 1];
  return words.map((w, i) => {
    if (!isWord(w)) return w;
    if (/[A-Z]/.test(w.slice(1))) return w;                     // has internal capitals: leave
    const lower = w.toLowerCase();
    const cap = x => x.replace(/^([("']*)(\p{L})/u, (_, p, c) => p + c.toUpperCase());
    if (i !== first && i !== last && TC_SMALL.has(lower.replace(/[^\p{L}']/gu, ""))) return lower;
    return cap(lower).replace(/-(\p{L})/gu, (_, c) => "-" + c.toUpperCase());
  }).join("");
}

// Deterministic tidy-up of generated question and answer text. Quick and
// dirty by design: em dashes, Oxford commas, American spellings and the
// commoner throat-clearing openers. Anything subtler needs a model.
const US_UK = {
  color: "colour", colors: "colours", colored: "coloured", colorful: "colourful", honor: "honour", honors: "honours", honored: "honoured", favor: "favour", favors: "favours", favored: "favoured", favorite: "favourite", favorites: "favourites",
  labor: "labour", neighbor: "neighbour", neighbors: "neighbours", neighboring: "neighbouring", neighborhood: "neighbourhood", humor: "humour", behavior: "behaviour", behaviors: "behaviours", harbor: "harbour", harbors: "harbours", armor: "armour", flavor: "flavour", flavors: "flavours",
  rumor: "rumour", rumors: "rumours", vapor: "vapour", vigor: "vigour", valor: "valour", savior: "saviour", endeavor: "endeavour", center: "centre", centers: "centres", centered: "centred", theater: "theatre", theaters: "theatres", liter: "litre", liters: "litres", fiber: "fibre", fibers: "fibres",
  defense: "defence", defenses: "defences", offense: "offence", pretense: "pretence", gray: "grey", catalog: "catalogue", catalogs: "catalogues", dialog: "dialogue", traveled: "travelled", traveler: "traveller", travelers: "travellers", traveling: "travelling", canceled: "cancelled", canceling: "cancelling",
  jewelry: "jewellery", aluminum: "aluminium", mold: "mould", molds: "moulds", sulfur: "sulphur", pajamas: "pyjamas", cozy: "cosy", plow: "plough", skeptic: "sceptic", skeptical: "sceptical", skepticism: "scepticism", artifact: "artefact", artifacts: "artefacts", ax: "axe", math: "maths", airplane: "aeroplane", airplanes: "aeroplanes",
  mustache: "moustache", pediatric: "paediatric", specialty: "speciality", enrollment: "enrolment", fulfill: "fulfil", skillful: "skilful", installment: "instalment", judgment: "judgement", gotten: "got", railroad: "railway", railroads: "railways", gasoline: "petrol", sidewalk: "pavement", vacation: "holiday", elevator: "lift", eggplant: "aubergine", zucchini: "courgette", cilantro: "coriander", arugula: "rocket",
  movie: "film", movies: "films", diaper: "nappy", faucet: "tap", flashlight: "torch", sneakers: "trainers", freeway: "motorway", trash: "rubbish", "parking lot": "car park", whiskey: "whisky", maneuver: "manoeuvre", maneuvers: "manoeuvres", esophagus: "oesophagus", estrogen: "oestrogen", anemia: "anaemia", anesthesia: "anaesthesia", hemoglobin: "haemoglobin", leukemia: "leukaemia", archeology: "archaeology", medieval: "medieval", tumor: "tumour", tumors: "tumours",
};
const IZE_KEEP = new Set(["size","sizes","sized","prize","prizes","prized","seize","seizes","seized","seizing","capsize","capsized","resize","resized","downsize","downsized","oversize","oversized","assize","assizes","maize","baize","belize","kaiser"]);
const matchCase = (src, repl) => (src[0] === src[0].toUpperCase() ? repl[0].toUpperCase() + repl.slice(1) : repl);
function britishise(t) {
  t = t.replace(/\b[A-Za-z]+(?: lot)?\b/g, w => { const k = w.toLowerCase(); return US_UK[k] ? matchCase(w, US_UK[k]) : w; });
  t = t.replace(/\b([A-Za-z]{2,}?)(iz)(e|es|ed|ing|er|ers|ation|ations|able)\b/g, (m, stem, _z, suf) => IZE_KEEP.has(m.toLowerCase()) ? m : `${stem}is${suf}`);
  t = t.replace(/\b(anal|paral|catal|hydrol|electrol)yz(e|es|ed|ing|er)\b/gi, (m, stem, suf) => `${stem}ys${suf}`);
  return t;
}
function fixDashes(t) {
  t = t.replace(/\s*[—]\s*/g, " — ").replace(/\s+[–-]\s+/g, " — ");
  const parts = t.split(" — ");
  if (parts.length === 1) return t;
  if (parts.length === 2) return `${parts[0]}: ${parts[1]}`;
  if (parts.length === 3) {
    const tail = parts[2];
    const glue = /^[,.;:?!)]/.test(tail) ? "" : /^\p{Ll}/u.test(tail) ? ", " : " ";
    return `${parts[0]} (${parts[1]})${glue}${tail}`;
  }
  return parts.join("; ");
}
function fixOxford(t) {
  return t.split(/(?<=[.?!])\s+/).map(sent => {
    const commas = (sent.match(/,/g) || []).length;
    return commas >= 2 ? sent.replace(/,\s+(and|or)\s+/g, " $1 ") : sent;
  }).join(" ");
}
const OPENERS = /^(?:famously|notably|interestingly|curiously|remarkably|uniquely|surprisingly|perhaps surprisingly|in fact|indeed|of course|it is worth noting that|it's worth noting that|it should be noted that),?\s+/i;
function polish(text, role) {
  let t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return t;
  t = fixDashes(t);
  t = britishise(t);
  t = fixOxford(t);
  if (role === "q") {
    t = t.replace(OPENERS, "");
    t = t.replace(/\s+([?!.,;:])/g, "$1");
    t = t.replace(/^(\p{Ll})/u, c => c.toUpperCase());
    if (!/[?.!]$/.test(t)) t += "?";
  } else {
    t = t.replace(/\s+([,;:])/g, "$1").replace(/[.]+$/, "").trim();
  }
  return t;
}

// ---------- scheduling ----------
// Question i: topic t = i % N, round r = floor(i / N). Every player reads
// exactly k questions in every mode; that is what keeps holding the phone
// cost-free. ownTopic "avoid" keeps a topic's chooser from ever answering it.
function buildSchedule(banks, N, mode, ownTopic) {
  const k = Math.min(...banks.map(b => b.length));
  const out = [];
  for (let r = 0; r < k; r++) {
    for (let t = 0; t < N; t++) {
      const q = banks[t][r];
      let reader, answerer = null;
      if (mode === "solo") {
        reader = 0;
      } else if (mode === "turns") {
        answerer = ownTopic === "avoid" ? (t + 1 + (r % (N - 1))) % N : (t + r) % N;
        const d = N >= 3 ? 1 + ((r + 1) % (N - 1)) : 1;   // reader offset varies by round so pairings rotate
        reader = (answerer + d) % N;
      } else {
        reader = ownTopic === "avoid" ? t : (t + r) % N;
      }
      out.push({ ...q, topic: t, reader, answerer, i: out.length });
    }
  }
  return out;
}

// ---------- self-tests ----------
// Fixtures are real model outputs from earlier rounds. Run once at load; the
// results go into the dev export and a warning shows on setup if any fail.
function runSelfTests() {
  const T = [];
  const t = (name, ok, detail) => T.push({ name, ok: !!ok, detail: ok ? undefined : detail });
  const topicRomance = "The evolution of vulgar Latin into romance languages";
  t("same: Constantine vs Constantine I", same("constantine", "constantine i"));
  t("same: Constantine I vs II distinct", !same("constantine i", "constantine ii"));
  t("leak: Galicia from Galician", answerLeaks("...ancestor of both modern Portuguese and Galician. In which medieval kingdom did it develop?", ["Galicia", "Galicia-Portugal"], topicRomance) === "Galicia");
  t("leak: accusative case not leaked by 'case'", answerLeaks("Which Latin case survived as the base form for Romance nouns?", ["the accusative case"], topicRomance) === null);
  t("leak: single-word answer in question", answerLeaks("Italian dropped final vowels; which language is this?", ["Italian"], topicRomance) === "Italian");
  t("leak: topic words exempt", answerLeaks("What did Romans call the everyday spoken form of their language?", ["Vulgar Latin"], topicRomance) === null);
  const trunc = `{"members": 47, "questions": [{"subject":["Vulgar Latin","what-called"],"level":3,"q":"Q?","a":"Vulgar Latin","alt":["sermo vulgaris"]},{"subject":["sound change in Gallo-Romance",`;
  const s1 = salvageQuestions(trunc);
  t("salvage: recovers 1 from truncated", !s1.complete && s1.questions.length === 1 && s1.members === 47);
  const s2 = salvageQuestions(`{"members": 3, "questions": [{"subject":["x \\"q\\" }","why"],"level":4,"q":"q","a":"a","alt":[]},{"subject":["y","when"],"level":4,"q":"q","a":"a","alt":["b"]},{"sub`);
  t("salvage: escaped quotes and braces in strings", s2.questions.length === 2);
  t("salvage: complete JSON", salvageQuestions(`preamble {"members": 8, "questions": [{"q":"a","a":"b"}]}`).complete);
  const up = unpackContent([{ type: "text", text: "x" }, { type: "server_tool_use", input: { query: "q1" } }, { type: "web_search_tool_result", content: [{}, {}] }, { type: "server_tool_use", input: { query: "q2" } }, { type: "web_search_tool_result", content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" } }, { type: "text", text: "{}" }]);
  t("unpack: by type, not position", up.text === "x\n{}" && up.searches.length === 2 && up.resultCount === 2 && up.toolErrors[0] === "max_uses_exceeded");
  t("overlap: same topic", topicOverlap("Roman emperors", "roman emperors") === "same");
  t("overlap: partial", topicOverlap("Roman emperors from Galba", "Emperors of Rome") === "overlap");
  t("overlap: distinct", topicOverlap("Great apes", "Planets") === null);
  t("collide: the steppe vs Pontic steppe", answersCollide("the steppe", "Pontic steppe") && answersCollide("Pontic-Caspian steppe", "Pontic steppe"));
  t("collide: Greece vs Greek", answersCollide("Greece", "Greek"));
  t("collide: number words", answersCollide("Two", "2") && answersCollide("ten", "10"));
  t("collide: short numeric token needs the whole answer", !answersCollide("one", "one tenth") && !answersCollide("one", "very little (under ten percent)") && answersCollide("two", "two") && answersCollide("1", "one") && !answersCollide("AD", "AD 476"));
  t("collide: distinct answers stay distinct", !answersCollide("Hittite", "Latin") && !answersCollide("China", "Armenian") && !answersCollide("Constantine I", "Constantine II"));
  {
    const plan = [
      { member: "Germanic branch", angle: "where it spread from", answer: "the steppe", level: 2, jargon: false },
      { member: "PIE homeland", angle: "where it was", answer: "Pontic steppe", level: 2, jargon: false },
      { member: "Italic branch", angle: "parent language", answer: "Latin", level: 1, jargon: false },
      { member: "Italic branch", angle: "a daughter", answer: "French", level: 1, jargon: false },
      { member: "Anatolian branch", angle: "its known language", answer: "Hittite", level: 3, jargon: false },
      { member: "Hellenic branch", angle: "a term", answer: "aorist", level: 2, jargon: true },
    ];
    const r = selectPlan(plan, 6, "Easy", [], 10, 6);
    t("plan: steppe repeat rejected, member repeat rejected, level and jargon enforced", r.chosen.length === 2 && r.rejected.length === 4 && /repeats/.test(r.rejected[0].why.join()) && /already used/.test(r.rejected[1].why.join()) && /outside/.test(r.rejected[2].why.join()) && /easy/.test(r.rejected[3].why.join()));
  }
  t("parseObject: plan salvage on cut-off", parseObject(`{"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false},{"member":"d",`, "plan").obj.plan.length === 1 && parseObject(`{"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false}]}`, "plan").complete);
  t("parseObject: reading survives a cut-off plan", (parseObject(`{"reading":{"includes":"branches","excludes":"languages","answers":"a branch"},"members":10,"format":"mixed","plan":[{"member":"a","angle":"b","answer":"c","level":2,"jargon":false},{"mem`, "plan").obj.reading || {}).excludes === "languages");
  t("enumeration giveaway: lists the four it asks to count", enumeratesAnswerCount("Ancient Greek is divided into how many major dialect groups, including Doric, Ionic, Aeolic and Arcado-Cypriot?", "four"));
  t("enumeration giveaway: not triggered by fewer items or non-numeric answers", !enumeratesAnswerCount("Sanskrit and Persian belong to the same branch. How many main sub-branches does it have?", "Two") && !enumeratesAnswerCount("Which of Doric, Ionic and Aeolic was spoken in Sparta?", "Doric"));
  t("non-latin detect", hasNonLatin("Ελληνικά") && hasNonLatin("日本") && !hasNonLatin("Café Français, naïve — ok?"));
  t("tc: small words and apostrophes", tc("how it's played") === "How It's Played" && tc("short of it") === "Short of It" && tc("the table wins") === "The Table Wins" && tc("10 of 15") === "10 of 15");
  t("tc: leaves internal capitals", tc("emperors after AD 476") === "Emperors After AD 476");
  t("polish: two dashes to parentheses", polish("When unstressed vowels dropped out — turning 'oculum' into 'oclo' — what term names this?", "q") === "When unstressed vowels dropped out (turning 'oculum' into 'oclo'), what term names this?");
  t("polish: one dash to colon", polish("Romance replaced the future by combining an infinitive with 'to have' — what is the term?", "q") === "Romance replaced the future by combining an infinitive with 'to have': what is the term?");
  t("polish: oxford comma removed, pair kept", polish("Which emperor ruled Gaul, Britain, and Spain?", "q") === "Which emperor ruled Gaul, Britain and Spain?" && polish("Was it Otho, or Galba?", "q") === "Was it Otho, or Galba?");
  t("polish: british spelling", polish("Which color did the organization favor in its center?", "q") === "Which colour did the organisation favour in its centre?" && polish("prize", "a") === "prize" && polish("Seized the capsized maize", "a") === "Seized the capsized maize");
  t("polish: openers and terminal", polish("Famously, which planet has a day longer than its year", "q") === "Which planet has a day longer than its year?");
  t("polish: answer trailing stop", polish("Venus.", "a") === "Venus" && polish(" 95 days ", "a") === "95 days");
  // schedule invariants
  for (const N of [2, 3, 4, 5]) for (const k of [2, 4]) for (const mode of ["turns", "buzzer"]) for (const own of ["avoid", "allow"]) {
    if (mode === "buzzer" && N < 3) continue;
    const banks = Array.from({ length: N }, (_, ti) => Array.from({ length: k }, (_, r) => ({ q: `${ti}-${r}`, a: "a" })));
    const sch = buildSchedule(banks, N, mode, own);
    const reads = Array(N).fill(0), answers = Array(N).fill(0);
    let ok = sch.length === N * k;
    for (const q of sch) {
      reads[q.reader]++;
      if (mode === "turns") { answers[q.answerer]++; if (q.reader === q.answerer) ok = false; if (own === "avoid" && q.answerer === q.topic) ok = false; }
      if (mode === "buzzer" && own === "avoid" && q.reader !== q.topic) ok = false;
    }
    if (reads.some(x => x !== k)) ok = false;
    if (mode === "turns" && answers.some(x => x !== k)) ok = false;
    if (mode === "turns" && N >= 4) {
      const pairs = new Set(sch.map(q => `${q.answerer}>${q.reader}`));
      if (pairs.size <= N) ok = false; // pairings must vary
    }
    t(`schedule N=${N} k=${k} ${mode} ${own}`, ok, JSON.stringify({ reads, answers }));
  }
  return T;
}

// ---------- prompt pieces ----------
const BOUNDARY = (topic, others) => `The topic is: "${topic}".
Treat the topic as a boundary, not a theme. Read it the way the person who typed it meant it: a short, specific topic is a specification, and every question must sit inside it.
The test is the ANSWER, not the question. If the answer is a thing, person, place, date, term or number that belongs to the topic itself, the question is in. If the question merely mentions the topic on the way to an answer from a neighbouring subject, it is out. A question that names the topic and then asks who designed it, what happened next door, or which wider movement it belonged to is out, because the answer lives outside the topic.
Never widen a narrow topic to find variety.${others.length ? `\nOther players' topics in this same quiz, which your questions must not stray into and must not duplicate: ${others.map(o => `"${o}"`).join(", ")}. Where this topic and one of those overlap, stay on the part that is only this topic.` : ""}

Read the topic in the present tense unless it names a period or is inherently historical. A topic phrased as a thing (a drink, a cuisine, a sport, a craft, a city, a species) means that thing as it exists now: how it is made or done, what it is like, where it is found, what varieties and terms it has, who and what are associated with it today. Origins and history are one strand among several, not the default. Unless the topic names a period, no more than a quarter of the questions may be about how the topic began, who founded or invented it, or what it used to be.

Decide how many distinct members the topic has: people, works, events, places, terms. A range, a list, a period or a category is a set, however narrowly it is phrased.
If the topic has at least as many members as questions, each question must be about a different member. Distribute across the whole span, not the most famous or best-documented members.
If the topic has fewer members than questions, spread the questions across the members as evenly as you can, and vary what is asked about each.
Every answer in the set must be a different thing. Two questions whose answers are the same place, person, term or number under different names are one question asked twice.`;

const CRAFT = `What makes a question worth asking:
- It gives a foothold proportionate to the difficulty. At easy, most of the table should be able to reason towards it. At hard, a narrow route in is enough, and only the enthusiast needs to be able to find it. At no level should a question be a bare memory test with no route in at all.
- The answer is satisfying when revealed. Either "of course" or "I didn't know that", never "if you say so". Prefer facts with a story, a surprise, a connection or a why behind them over bare dates and figures.
- It carries its own interest. Fold the striking detail into the question rather than saving it for the answer, so even the person who misses it learns something worth hearing read aloud.
- It asks one thing, in one sentence, and the answer is one thing. No "name both", no "and in what year".
- Numbers only when the number is the famous part. Nobody enjoys guessing the exact figure of a fact they had never heard of.
- Prefer the specific to the superlative. "Which planet's day is longer than its year?" beats "Which is the smallest planet?"
- The answer must not appear in the question in any form: not the word, not a word sharing its root, not an adjective made from it, not a translation of it. Naming the people to ask for their country, or the language to ask for its region, gives the answer away. Before finishing each question, check every word of the answer against the question and rewrite if any match.
- Do not state the complement of the answer, and do not set the answer up as the odd one out of a property you name. "Unlike the others, which still have speakers, this branch is...?" hands the answer over without using the word. If the reader could deduce the answer from the wording alone, it is not a question.
- Exactly one defensible answer. If several members share the property you are asking about, add the detail that singles one out, or ask something else. "Which branch stands alone with no close relative?" fails when three branches do.
- Never ask for the size of an open or debated set: how many languages, species, countries, works, members. Such counts depend on where lines are drawn and will be wrong for someone at the table. A count is acceptable only when it is fixed by definition (planets in the Solar System, players in a side) or is itself the famous fact.
- Specialist vocabulary counts toward difficulty. An answer is "jargon" if a general-interest newspaper would need to explain it to its readers (a technical term, a term of art, a name known only within the field); a jargon answer is never below level 4.`;

const FORMAT_GUIDE = (userFormat) => userFormat
  ? `QUESTION FORMAT, FIXED BY THE PLAYER: every question must follow this pattern: "${userFormat}". Keep the pattern's wording and shape; vary only what it asks about. Report "format" as exactly the player's pattern.`
  : `QUESTION FORMAT. Decide, for this topic, whether the questions should be mixed in shape or should all follow one fixed pattern. Some topics are better with one pattern (flags: "which country's flag..."; capital cities: "what is the capital of..."; verb forms: "what is the ... of ..."), because the repetition lets the table settle into a rhythm and the variety lives in the answers. Most topics are better mixed: different angles (where, when, who, why, how many, what it is called, what it does) across the set, with no angle used for more than about a third of the questions. Report "format" as either "mixed" or "fixed: <the pattern>". Choose fixed only when you can name the pattern.`;

const DIFF_BAND = { Easy: [1, 2], Medium: [2, 4], Hard: [4, 5] };
const bandText = d => { const [lo, hi] = DIFF_BAND[d]; return d === "Medium" ? "between 2 and 4, with 3 the most common" : `${lo} or ${hi}`; };
const DIFF_PROMPT = {
  Easy: `DIFFICULTY: EASY. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Easy means at least four of the five get it. These are the topic's headline facts: what a short encyclopedia entry on this exact topic states in its opening paragraphs, plus anything about it that has entered general culture. If a question requires having read about the topic, it is too hard for this level. No answer may be a specialist term: every answer must be a word or name that appears in general-interest newspapers without explanation. Rate each question 1 or 2 on a 1-5 scale; do not write anything you would rate 3 or above.`,
  Medium: `DIFFICULTY: MEDIUM. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Medium means the person who chose it gets about seven in ten and the others get about two in ten. These are facts a genuine enthusiast knows without looking up and a casual observer does not: the topic's own working detail rather than its headlines. Most answers must be everyday words, names, places or numbers. An answer that is a specialist term (one a general-interest newspaper would have to explain) is automatically a 4, never a 3, and there should be at most one such answer in the set; if you want to test the concept behind a specialist term at level 3, describe the concept and ask for something plain about it instead of asking for its name. Rate each question on a 1-5 scale. Most should be 3; a 2 or a 4 is fine where the topic offers a natural one, but 3 must be the most common rating in the set, and nothing may be 1 or 5.`,
  Hard: `DIFFICULTY: HARD. Calibrate every question against this table: five adults in a British pub, one of whom chose the topic. Hard means the person who chose it gets about half and the others get almost none. These are the facts that reward having spent real time on this exact topic: the less-visited members, the detail behind the headlines, the thing a devotee is pleased to be asked. Harder means deeper into the same topic, never wider. Every answer must still be a single, verifiable, unambiguous fact; obscurity that cannot be checked is not difficulty. Rate each question 4 or 5 on a 1-5 scale; do not write anything you would rate 3 or below. If you find yourself writing a headline fact, replace it.`,
};

const MODELS = ["claude-sonnet-4-6"];
const SPARES = 3;

// ---------- answer and member collision (self-tested) ----------
const NUM_WORDS = { zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12", thirteen: "13", fourteen: "14", fifteen: "15", sixteen: "16", seventeen: "17", eighteen: "18", nineteen: "19", twenty: "20" };
const normAnswer = a => norm(a).split(" ").filter(Boolean).map(w => NUM_WORDS[w] || w).filter(w => !STOP.has(w)).join(" ");
// Same answer under different names: identical, whole-word prefix, one
// answer's tokens all inside the other's ("the steppe" vs "Pontic steppe"),
// or two single words sharing a long stem ("Greece" vs "Greek"). Short tokens
// such as regnal numerals are kept whole so "Constantine I" and "II" differ.
const stemKey = w => (w.length >= 6 ? w.slice(0, 5) : w);
function answersCollide(a, b) {
  const na = normAnswer(a), nb = normAnswer(b);
  if (!na || !nb) return false;
  const ta = na.split(" "), tb = nb.split(" ");
  // A one-token answer that is short (a number, an initialism) only matches
  // the whole of the other answer; "one" is not inside "one tenth".
  const shortSingle = t => t.length === 1 && t[0].length <= 3;
  if (shortSingle(ta) || shortSingle(tb)) return na === nb;
  if (same(na, nb)) return true;
  const sa = ta.map(stemKey), sb = tb.map(stemKey);
  const sub = (x, y) => x.every(st => y.includes(st));
  if (sub(sa, sb) || sub(sb, sa)) return true;
  if (ta.length === 1 && tb.length === 1 && ta[0].length >= 5 && tb[0].length >= 5 && ta[0].slice(0, 4) === tb[0].slice(0, 4)) return true;
  return false;
}

// Choose up to `need` plan entries that pass the mechanical checks, given what
// is already kept. Pure, so it can be tested against real plans.
const HEDGED = /^(?:about|around|roughly|approximately|nearly|almost|under|over|less than|more than|very|several|some|few|many|most|a few|a lot)\b|\b(?:or so|ish)$/i;
function selectPlan(entries, need, difficulty, kept, members, k, relax = 0) {
  const [lo, hi] = DIFF_BAND[difficulty];
  const allowedPerMember = (members && members < k ? Math.min(2, Math.ceil(k / members)) : 1) + relax;
  const jargonCap = 1 + relax;
  const chosen = [], rejected = [];
  const all = () => [...kept, ...chosen];
  for (const e of entries) {
    if (chosen.length >= need) break;
    const member = String(e?.member || "").trim(), answer = String(e?.answer || "").trim(), angle = String(e?.angle || "").trim();
    const lv = Number(e?.level), jargon = e?.jargon === true || String(e?.jargon).toLowerCase() === "true";
    const why = [];
    if (!member) why.push("no member");
    if (!answer) why.push("no answer");
    if (!angle) why.push("no angle");
    if (/[()\[\]]/.test(member)) why.push("member has brackets");
    if (!Number.isFinite(lv) || lv < lo || lv > hi) why.push(`level ${Number.isFinite(lv) ? lv : "missing"} outside ${lo}-${hi}`);
    if (jargon && difficulty === "Easy") why.push("specialist-term answer at easy");
    else if (jargon && lv < 4) why.push(`specialist-term answer rated ${lv}`);
    else if (jargon && difficulty === "Medium" && all().filter(y => y.jargon).length >= jargonCap) why.push(`${jargonCap === 1 ? "second" : "another"} specialist-term answer in a medium set`);
    if (answer && HEDGED.test(answer)) why.push(`hedged answer "${answer}"`);
    const dupA = all().find(y => answersCollide(y.a, answer) || (y.alt || []).some(v => answersCollide(v, answer)));
    if (dupA) why.push(`answer "${answer}" repeats "${dupA.a}"`);
    if (all().filter(y => same(norm(y.subject), norm(member))).length >= allowedPerMember) why.push(`member "${member}" already used`);
    if (why.length) { rejected.push({ member: member || "?", answer, why }); continue; }
    chosen.push({ subject: member, angle, a: answer, alt: [], level: lv, jargon, q: null, verified: null });
  }
  return { chosen, rejected };
}

const BATCH_PLAIN = 5;
const BATCH_SEARCH = 2;
// Resolve or reject with the promise, or reject the moment the signal aborts.
// The artifact's fetch may be proxied and ignore `signal`; this makes cancel
// take effect immediately regardless.
const abortErr = () => Object.assign(new Error("cancelled"), { name: "AbortError" });
const withAbort = (promise, signal) => {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortErr());
  return new Promise((res, rej) => {
    const onAbort = () => rej(abortErr());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(v => { signal.removeEventListener("abort", onAbort); res(v); }, e => { signal.removeEventListener("abort", onAbort); rej(e); });
  });
};
const sleep = (ms, signal) => new Promise((res, rej) => {
  const id = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(id); rej(Object.assign(new Error("cancelled"), { name: "AbortError" })); }, { once: true });
});

// One API round trip with the transport handling this endpoint has needed:
// 429 backoff, a retry when a 200 arrives with its first bytes missing, and
// pause_turn continuation for long search loops. Records into `a`.
async function callModel(prompt, { useSearch, maxUses, signal, onStatus, a }) {
  for (const m of MODELS) {
    a.model = m;
    let rateTries = 0;
    try {
      const reqBody = (msgs) => JSON.stringify({ model: m, max_tokens: 1000, messages: msgs, ...(useSearch ? { tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }] } : {}) });
      const post = (msgs) => withAbort(fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: reqBody(msgs), signal }), signal);
      const readText = (r) => withAbort(r.text(), signal);
      let messages = [{ role: "user", content: prompt }];
      let res;
      while (true) {
        res = await post(messages);
        if (res.status !== 429 || rateTries >= 4) break;
        rateTries += 1; a.rateWaits = rateTries;
        onStatus(`rate limited, waiting (${rateTries})`);
        await sleep(1500 * Math.pow(2, rateTries - 1), signal);
      }
      a.status = res.status;
      let rawText = await readText(res);
      let body = null; try { body = JSON.parse(rawText); } catch { body = null; }
      for (let t = 1; t <= 2 && res.ok && body === null; t++) {
        a.transportRetry = `body not JSON (started "${rawText.slice(0, 40)}"), retried ${t}×`;
        await sleep(800 * t, signal);
        const res2 = await post(messages);
        a.status = res2.status; rawText = await readText(res2);
        try { body = JSON.parse(rawText); } catch { body = null; }
        res = res2;
      }
      if (!res.ok || !body || body.type === "error" || !Array.isArray(body.content)) {
        a.apiError = body?.error ? `${body.error.type}: ${body.error.message}` : body === null ? `HTTP ${res.status}, body is not JSON` : `HTTP ${res.status}, JSON has no content array (keys: ${Object.keys(body).join(", ") || "none"})`;
        a.rawHead = rawText.slice(0, 400);
        continue;
      }
      let pauses = 0, accumulated = body.content;
      while (body.stop_reason === "pause_turn" && pauses < 2) {
        pauses += 1; a.pauses = pauses; onStatus(`still checking (${pauses})`);
        messages = [...messages, { role: "assistant", content: body.content }];
        const resP = await post(messages); const rawP = await readText(resP);
        let bodyP = null; try { bodyP = JSON.parse(rawP); } catch { bodyP = null; }
        if (!resP.ok || !bodyP || bodyP.type === "error" || !Array.isArray(bodyP.content)) { a.apiError = `continuation after pause_turn failed: ${bodyP?.error ? `${bodyP.error.type}: ${bodyP.error.message}` : `HTTP ${resP.status}`}`; break; }
        body = bodyP; accumulated = [...accumulated, ...bodyP.content];
      }
      a.stopReason = body.stop_reason;
      const su = body.usage?.server_tool_use?.web_search_requests;
      a.usage = body.usage ? `${body.usage.input_tokens} in / ${body.usage.output_tokens} out${Number.isFinite(su) ? ` / ${su} search${su === 1 ? "" : "es"}` : ""}` : null;
      return { ...body, content: accumulated };
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      a.apiError = `network: ${e.message}`;
    }
  }
  return null;
}

// Pull a JSON object out of a text response, tolerating a cut-off; returns
// the parsed object (possibly with a salvaged array under `key`).
function parseObject(text, key) {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const st = clean.indexOf("{"), en = clean.lastIndexOf("}");
    const full = JSON.parse(clean.slice(st, en + 1));
    if (Array.isArray(full[key])) return { obj: full, complete: true };
  } catch { /* fall through */ }
  const sv = salvageQuestions(clean.replace(`"${key}"`, '"questions"'));
  const extra = Object.fromEntries((clean.match(/"(members|format)"\s*:\s*("[^"]*"|\d+)/g) || []).map(m => { const [, kk, v] = m.match(/"(\w+)"\s*:\s*(.*)/); return [kk, v.startsWith('"') ? JSON.parse(v) : Number(v)]; }));
  const rm = clean.match(/"reading"\s*:\s*(\{[^{}]*\})/);
  if (rm) { try { extra.reading = JSON.parse(rm[1]); } catch { /* ignore */ } }
  return { obj: { ...extra, [key]: sv.questions }, complete: false };
}

// ---------- generation: plan, then write ----------
// Phase 1 plans the whole set in one call: member, angle, answer, level,
// jargon for k+spares entries, with no question text. Answers and members are
// checked mechanically. Phase 2 writes questions for approved entries in
// batches, with search if on; each written question is checked for leaks and
// the answer is held to the plan. Returns { bank, log } (bank may be short).
async function fetchBank(topic, k, difficulty, opts = {}) {
  const { onStatus = () => {}, useSearch = true, signal, otherTopics = [], existing = [], format = "" } = opts;
  const log = { topic, difficulty, attempts: [], search: useSearch, format: format || null, startedAt: new Date().toISOString() };
  const [lo, hi] = DIFF_BAND[difficulty];
  const kept = existing.slice();           // finished questions
  let pending = [];                        // approved plan entries awaiting a question
  let members = null, relax = 0;
  let planCalls = 0, writeCalls = 0, emptyCalls = 0;
  const abort = () => { if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" }); };
  const newAttempt = (stage, asked) => { const a = { stage, call: log.attempts.length + 1, asked, model: MODELS[0], status: null, apiError: null, stopReason: null, usage: null, rawHead: null, parse: null, validation: null, rateWaits: 0, startedAt: Date.now() }; log.attempts.push(a); return a; };
  const finishAttempt = a => { a.ms = Date.now() - a.startedAt; };
  const summary = () => [...kept, ...pending].map(x => `${x.subject} · ${x.angle} · L${x.level}${x.jargon ? " · jargon" : ""}${x.q ? "" : " · planned"}${x.verified === false ? " · unverified" : ""}${x.solved === "in" ? " · solved" : x.solved === "unsolved" ? " · unsolved" : ""}${x.judged === "in" ? (x.judgeUnsure ? " · in (judge unsure of answer)" : " · in") : x.judged === "unjudged" ? " · unjudged" : ""}`);

  // ---- phase 1: plan ----
  async function plan(need) {
    abort();
    planCalls += 1;
    const used = [...kept, ...pending];
    const a = newAttempt("plan", need);
    onStatus(used.length ? `planning (${used.length}/${k})` : "planning");
    const readingBlock = log.reading
      ? `THE READING OF THE TOPIC, already fixed for this round; plan against it exactly:
includes: ${log.reading.includes}
excludes: ${log.reading.excludes}
every answer must be: ${log.reading.answers}`
      : `FIRST, READ THE TOPIC AS A SPECIFICATION. Before planning anything, restate it in three lines as "reading": what it includes, what it explicitly or implicitly excludes (a parenthetical, a range, a qualifier, a "not ..." is a hard exclusion), and what kind of thing every answer must be (a branch, a person, a place, a term...). The reading describes the topic as typed and nothing else: not this call, not the questions already written. Plan only inside that reading. If the topic says "branches, not individual languages", no answer may be a language and no question may turn on one.`;
    const prompt = `PLAN a quiz round. Do not write the questions yet.
${DIFF_PROMPT[difficulty]}

${BOUNDARY(topic, otherTopics)}

${readingBlock}

${FORMAT_GUIDE(format)}

Produce ${need + SPARES} candidate entries for a set of ${k} questions (${need} are needed; the rest are spares in case some are rejected). Each entry must have exactly one defensible answer: if several members share the property, add the detail that singles one out, or choose another angle. Do not plan a count of an open or debated set. Do not plan two entries that rest on the same fact. For each entry give:
- "member": the member of the topic it is about, as a bare name with nothing in brackets
- "angle": in five words or fewer, what is being asked about that member (its location, when it split off, what it is called, why it happened...)
- "answer": the single, short, factual answer, exactly as it should be revealed. It must be a specific thing: a hedged or approximate answer ("very little", "about a tenth", "several") is not an answer and will be rejected
- "level": your honest 1-5 rating for the table above; every level must be ${bandText(difficulty)}
- "jargon": true if a general-interest newspaper would need to explain the answer, else false
Every answer must be a different thing; the same place, person or number under two names is a repeat.${used.length ? `\nAlready in the set, which you must not repeat (answer): ${used.map(u => `${u.subject} → ${u.a}`).join("; ")}.${relax ? " The topic's members are nearly used up, so a second question about an already-used member is allowed if it asks something different." : " Do not reuse a member already listed."}` : ""}
Also give "members", your estimate of how many distinct members the topic has, and "format" as instructed above${log.reading ? "" : ', and "reading" as instructed above'}.
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{${log.reading ? "" : '"reading":{"includes":"...","excludes":"...","answers":"..."},'}"members":<int>,"format":"mixed" or "fixed: <pattern>","plan":[{"member":"...","angle":"...","answer":"...","level":<1-5>,"jargon":<true|false>}]}`;
    const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a });
    finishAttempt(a);
    if (!data) { emptyCalls += 1; return; }
    const { text } = unpackContent(data.content || []);
    const { obj, complete } = parseObject(text, "plan");
    const entries = Array.isArray(obj.plan) ? obj.plan : [];
    a.parse = complete ? `ok (${entries.length} entries)` : data.stop_reason === "max_tokens" ? `salvaged ${entries.length} entries from a response cut off at the token limit` : `partial: ${entries.length} entries recovered from a response that was not valid JSON`;
    if (members === null && Number.isFinite(obj.members)) { members = obj.members; log.members = members; if (members < k) log.memberNote = `model estimated ${members} members for ${k} questions; repeats capped at ${Math.min(2, Math.ceil(k / members))} per member`; }
    if (obj.format && !log.formatDecided) log.formatDecided = String(obj.format);
    if (!log.reading && obj.reading && typeof obj.reading === "object") {
      const r = obj.reading;
      log.reading = { includes: String(r.includes || "").slice(0, 300), excludes: String(r.excludes || "").slice(0, 300), answers: String(r.answers || "").slice(0, 200) };
    }
    if (!entries.length) { a.rawHead = text.slice(0, 400); return; }
    const { chosen, rejected } = selectPlan(entries, need, difficulty, [...kept, ...pending], members, k, relax);
    pending = [...pending, ...chosen];
    // Every entry rejected, and only on caps: the topic is exhausted at this
    // cap. Loosen one notch for the next plan rather than let the round die.
    if (!chosen.length && rejected.length && rejected.every(r => r.why.every(w => /already used|specialist-term answer/.test(w))) && relax < 1) {
      relax += 1;
      log.acceptedWithProblems = [log.acceptedWithProblems, `topic exhausted at one question per member; allowing a second (and a second specialist term at medium) for the refill`].filter(Boolean).join("; ");
      a.relaxNote = "caps loosened for the next plan";
    }
    a.validation = rejected.length ? `rejected ${rejected.length}: ${rejected.map(r => `${r.member}: ${r.why.join(", ")}`).join(" | ")}` : "all accepted";
    const angles = new Set([...kept, ...pending].map(x => norm(x.angle)));
    if (!format && log.formatDecided === "mixed" && angles.size < Math.min(3, k)) log.acceptedWithProblems = [log.acceptedWithProblems, `plan declared mixed but uses ${angles.size} angle${angles.size === 1 ? "" : "s"}`].filter(Boolean).join("; ");
    a.subjects = summary();
  }

  // ---- phase 2: write ----
  const initialBatch = useSearch ? BATCH_SEARCH : BATCH_PLAIN;
  let batch = initialBatch;
  async function write() {
    abort();
    writeCalls += 1;
    const items = pending.slice(0, batch);
    const a = newAttempt("write", items.length);
    onStatus(`writing (${kept.length}/${k})`);
    const prompt = `WRITE quiz questions for a plan that has already been approved.
${DIFF_PROMPT[difficulty]}

${BOUNDARY(topic, otherTopics)}

${CRAFT}

${log.reading ? `THE READING OF THE TOPIC for this round:
includes: ${log.reading.includes}
excludes: ${log.reading.excludes}
every answer must be: ${log.reading.answers}
` : ""}
${format ? `QUESTION FORMAT, FIXED BY THE PLAYER: every question must follow this pattern: "${format}".` : log.formatDecided && log.formatDecided !== "mixed" ? `QUESTION FORMAT for this round: ${log.formatDecided}. Every question follows that pattern.` : "QUESTION FORMAT: mixed. Each entry's angle tells you what shape its question takes."}

${useSearch ? `VERIFY. You have a web search tool. For each entry, run at most one brief search to confirm the planned answer is correct and unambiguous. If the search shows the planned answer is wrong, contested, or one of several equally good answers, do not write a question for it: return that entry with "ok": false and a short "note". When you do confirm an answer, give "verified": true and "source": the title or URL of the page that confirmed it; "verified": true without a source will be treated as unverified. Keep your text between searches to a bare minimum; the JSON is the only thing that should appear in your final message.\n` : ""}Write one question for each entry below. The question must be about the given member, from the given angle, and its answer must be the planned answer: you may correct capitalisation or add acceptable alternate answers, but not change what the answer is. Keep each question under 35 words, one sentence, one thing asked. Use British spelling. The answer must not appear in the question in any form.
Entries:
${items.map((it, i) => `${i + 1}. member: ${it.subject}; angle: ${it.angle}; answer: ${it.a}; level ${it.level}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"questions":[{"id":<entry number>,"ok":<true|false>,"q":"question text","a":"the answer","alt":["acceptable alternates or empty"]${useSearch ? `,"verified":<true|false>,"source":"title or URL, only when verified"` : ""},"note":"only if ok is false"}]}`;
    const data = await callModel(prompt, { useSearch, maxUses: items.length * 2, signal, onStatus, a });
    finishAttempt(a);
    if (!data) { emptyCalls += 1; return; }
    const { text, searches, toolErrors, resultCount } = unpackContent(data.content || []);
    if (useSearch) { a.searches = searches.length ? `${searches.length} (${searches.map(q => `"${q}"`).join(", ")}) → ${resultCount} results` : "none run"; if (toolErrors.length) a.toolErrors = toolErrors.join(", "); }
    const { obj, complete } = parseObject(text, "questions");
    const qs = Array.isArray(obj.questions) ? obj.questions : [];
    const cutOff = data.stop_reason === "max_tokens";
    a.parse = complete ? `ok (${qs.length} returned)` : cutOff ? `salvaged ${qs.length} from a response cut off at the token limit` : `partial: ${qs.length} recovered from a response that was not valid JSON`;
    if (cutOff) { const nb = Math.max(1, Math.min(batch - 1, qs.length || 1)); if (nb !== batch) { a.batchNote = `batch ${batch} → ${nb} (cut off)`; batch = nb; } }
    else if (complete && batch < initialBatch) { a.batchNote = `batch ${batch} → ${batch + 1} (clean call)`; batch += 1; }
    if (!qs.length) { a.rawHead = text.slice(0, 400); return; }

    const dropped = [], done = new Set();
    for (const x of qs) {
      const id = Number(x.id); const it = items[id - 1];
      if (!it || done.has(id)) continue;
      done.add(id);
      const why = [];
      if (x.ok === false || String(x.ok).toLowerCase() === "false") why.push(`writer rejected: ${x.note || "no reason given"}`);
      const q = polish(x.q, "q"), aTxt = polish(x.a || it.a, "a");
      const alt = (Array.isArray(x.alt) ? x.alt : []).map(v => polish(v, "a")).filter(Boolean);
      if (!why.length) {
        if (!q || q.length < 12) why.push("no question text");
        if (q.split(/\s+/).length > 45) why.push("over length");
        if (!answersCollide(aTxt, it.a)) why.push(`answer changed from plan ("${it.a}" → "${aTxt}")`);
        const leak = answerLeaks(q, [aTxt, ...alt], topic);
        if (leak) why.push(`answer "${leak}" is given away by the question`);
        if (enumeratesAnswerCount(q, aTxt)) why.push("the question lists the things it asks to count");
      }
      // alternates must not collide with any other kept answer
      const others = [...kept, ...pending.filter(p => p !== it)];
      const cleanAlt = alt.filter(v => !others.some(o => answersCollide(o.a, v)));
      if (why.length) { dropped.push(`${it.subject}: ${why.join(", ")}`); pending = pending.filter(p => p !== it); continue; }
      const source = String(x.source || "").trim().slice(0, 160) || null;
      const claimed = x.verified === true || String(x.verified).toLowerCase() === "true";
      const verified = useSearch ? (claimed && !!source) : null;
      if (useSearch && claimed && !source) a.sourceNote = [a.sourceNote, `${it.subject}: claimed verified with no source; recorded as unverified`].filter(Boolean).join("; ");
      kept.push({ ...it, q, a: aTxt, alt: cleanAlt, verified, source: verified ? source : null });
      pending = pending.filter(p => p !== it);
    }
    // entries the writer ignored stay pending for the next write call
    a.validation = dropped.length ? `dropped ${dropped.length}: ${dropped.join(" | ")}` : "all kept";
    a.subjects = summary();
  }

  // ---- phase 3: judge ----
  // One cheap call over the written questions not yet judged. The test is the
  // topic as typed, not the words in it: a question passes only if its answer
  // belongs to the topic as the person who wrote the topic meant it.
  let judgeCalls = 0;
  async function judge() {
    abort();
    judgeCalls += 1;
    const items = kept.filter(x => !x.judged);
    if (!items.length) return;
    const a = newAttempt("judge", items.length);
    onStatus(`checking against the topic (${kept.length}/${k})`);
    const prompt = `JUDGE a set of quiz questions against their topic. You are not writing or improving anything; you are deciding, for each question, whether it belongs and whether it works. You have no search; answer from knowledge, and say when you are unsure.
The topic, exactly as the player typed it: "${topic}".${otherTopics.length ? `\nOther players' topics in the same quiz, which this topic's questions must not stray into: ${otherTopics.map(o => `"${o}"`).join(", ")}.` : ""}${format ? `\nThe player fixed the question format: every question must follow the pattern "${format}".` : ""}
${log.reading ? `The reading of the topic used to write these questions:\nincludes: ${log.reading.includes}\nexcludes: ${log.reading.excludes}\nevery answer must be: ${log.reading.answers}\nCheck that reading against the topic as typed first; if the reading missed an exclusion the topic states, apply the topic, not the reading.` : `First, read the topic as a specification: what it includes, what it explicitly or implicitly excludes (a parenthetical, a range, a qualifier, a "not ..." is a hard exclusion), and what kind of thing every answer must be.`}
STEP 1. Write out the topic's constraints as a numbered list, "constraints", one per line, each a single testable statement (C1 "the answer is a branch, not a language", C2 "the question is about a difference between branches", C3 "no answer is a count of an open set"...). Include a constraint for every exclusion the topic states and for the kind of thing an answer must be.
STEP 2. For every question, go through every constraint in turn and list in "fails" the ids of the constraints it breaks. Do this constraint by constraint; do not form an overall impression first.
STEP 3. Also give:
- "correct": "yes", "no" or "unsure". Say "no" when you are confident the given answer is wrong, or when it rests on a contested definition.
- "countFixed": for a numeric answer only: true if the count is fixed by definition or is itself the famous fact, false if it depends on where lines are drawn (how many languages, dialects, species, works). A false here is a failure.
- "duplicateOf": the id of an earlier question this one rests on the same fact as, or is answered by the same reasoning as; otherwise null. Only the later of a pair is marked.
- "rivals": some questions list candidate answers that a blind solver produced without seeing ours. For each, say "same" (another name or wording for our answer), "real" (a genuinely different answer the question as worded does not rule out, so the question is ambiguous), or "wrong" (not a defensible answer). Where the solver's own best answer differs from ours, treat it as a candidate too.
Be strict about the constraints, correctness and real rivals; lenient about style, difficulty and phrasing. On a broad topic, a question on any part of it is in.
Questions:
${items.map((it, i) => `${i + 1}. Q: ${it.q} A: ${it.a}${it.alt?.length ? ` (also: ${it.alt.join(", ")})` : ""}${(it.solverRivals?.length || it.solverDiffers) ? ` | candidates from a blind solver: ${[...(it.solverDiffers ? [it.solverBest] : []), ...(it.solverRivals || [])].filter(Boolean).join("; ")}` : ""}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"constraints":["C1 ...","C2 ..."],"verdicts":[{"id":<number>,"fails":["C2"],"correct":"yes"|"no"|"unsure","countFixed":<true|false|null>,"duplicateOf":<number or null>,"rivals":[{"name":"...","verdict":"same"|"real"|"wrong"}],"why":"twelve words at most, only when something fails"}]}`;
    const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a });
    finishAttempt(a);
    if (!data) { emptyCalls += 1; return; }
    const { text } = unpackContent(data.content || []);
    const { obj, complete } = parseObject(text, "verdicts");
    const vs = Array.isArray(obj.verdicts) ? obj.verdicts : [];
    a.parse = complete ? `ok (${vs.length} verdicts)` : `partial: ${vs.length} verdicts recovered`;
    if (!vs.length) { a.rawHead = text.slice(0, 400); items.forEach(it => { it.judged = "unjudged"; }); a.validation = "no verdicts; questions kept unjudged"; return; }
    if (Array.isArray(obj.constraints) && obj.constraints.length && !log.judgeConstraints) log.judgeConstraints = obj.constraints.map(String).slice(0, 8);
    const out = [];
    const bool = v => v === true || String(v).toLowerCase() === "true";
    for (const v of vs) {
      const it = items[Number(v.id) - 1];
      if (!it) continue;
      const fails = [];
      const broke = (Array.isArray(v.fails) ? v.fails : []).map(String).filter(Boolean);
      if (broke.length) fails.push(`breaks ${broke.join(", ")}`);
      if (v.in !== undefined && !bool(v.in)) fails.push("outside the topic");
      if (String(v.correct || "").toLowerCase() === "no") fails.push("answer judged wrong");
      if (numericValue(it.a) !== null && v.countFixed !== undefined && v.countFixed !== null && !bool(v.countFixed)) fails.push("count of an open set");
      const dup = Number(v.duplicateOf);
      if (Number.isFinite(dup) && dup > 0 && dup < Number(v.id) && items[dup - 1]) fails.push(`duplicate of ${items[dup - 1].subject}`);
      const rv = (Array.isArray(v.rivals) ? v.rivals : []).map(r => ({ name: String(r?.name || ""), verdict: String(r?.verdict || "").toLowerCase() }));
      const real = rv.filter(r => r.verdict === "real").map(r => r.name).filter(Boolean);
      if (real.length) fails.push(`ambiguous; also defensible: ${real.slice(0, 3).join(", ")}`);
      // The solver's own answer differed and the judge did not call it wrong or the same: treat as contested.
      if (it.solverDiffers && !rv.some(r => answersCollide(r.name, it.solverBest) && r.verdict !== "real") && String(v.correct || "").toLowerCase() !== "yes") fails.push(`blind solver answered "${it.solverBest}" and the judge did not confirm ours`);
      it.rivalVerdicts = rv;
      it.judged = fails.length ? "out" : "in";
      if (String(v.correct || "").toLowerCase() === "unsure") it.judgeUnsure = true;
      if (fails.length) { it.judgeNote = `${fails.join("; ")}${v.why ? `: ${String(v.why).slice(0, 120)}` : ""}`; out.push(`${it.subject}: ${it.judgeNote}`); }
    }
    items.filter(it => !it.judged).forEach(it => { it.judged = "unjudged"; });
    const before = kept.length;
    for (let i = kept.length - 1; i >= 0; i--) if (kept[i].judged === "out") kept.splice(i, 1);
    a.validation = out.length ? `out ${before - kept.length}: ${out.join(" | ")}` : "all in";
    a.subjects = summary();
  }

  // ---- phase 3a: solve ----
  // Questions only, no answers. The model is asked what the answers are, not
  // whether ours is right: listing rivals is a task it does well, certifying
  // uniqueness is one it does badly. Comparison to the plan is mechanical.
  let solveCalls = 0;
  async function solve() {
    abort();
    solveCalls += 1;
    const items = kept.filter(x => !x.solved);
    if (!items.length) return;
    const a = newAttempt("solve", items.length);
    onStatus(`solving blind (${kept.length}/${k})`);
    const prompt = `SOLVE these quiz questions. You are given the questions only. For each one:
- "best": the answer you would give, as briefly as it would be said at a table
- "candidates": every MATERIALLY DIFFERENT answer a well-informed person could defend for the question as worded, including "best". Two names for the same thing are one candidate: list the thing once, under its commonest name. A candidate is something that would make a different player right. Include one only if the wording fails to rule it out
- "fromWording": true if the answer can be worked out from the question's own wording without knowing the subject (the items are listed and you are asked to count them, the answer's complement is stated, the answer is described in other words)
- "confidence": "high", "medium" or "low" that "best" is correct
Answer from knowledge; you have no search. Do not comment on the questions. Topic, for context only: "${topic}".
Questions:
${items.map((it, i) => `${i + 1}. ${it.q}`).join("\n")}
Respond with ONLY a JSON object, compact, no prose, no markdown fences:
{"solutions":[{"id":<number>,"best":"...","candidates":["..."],"fromWording":<true|false>,"confidence":"high"|"medium"|"low"}]}`;
    const data = await callModel(prompt, { useSearch: false, maxUses: 0, signal, onStatus, a });
    finishAttempt(a);
    if (!data) { emptyCalls += 1; return; }
    const { text } = unpackContent(data.content || []);
    const { obj, complete } = parseObject(text, "solutions");
    const sols = Array.isArray(obj.solutions) ? obj.solutions : [];
    a.parse = complete ? `ok (${sols.length} solutions)` : `partial: ${sols.length} solutions recovered`;
    if (!sols.length) { a.rawHead = text.slice(0, 400); items.forEach(it => { it.solved = "unsolved"; }); a.validation = "no solutions; questions kept unsolved"; return; }
    const bool = v => v === true || String(v).toLowerCase() === "true";
    const out = [], noted = [];
    for (const v of sols) {
      const it = items[Number(v.id) - 1];
      if (!it) continue;
      const mine = [it.a, ...(it.alt || [])];
      const best = String(v.best || "").trim();
      const cands = (Array.isArray(v.candidates) ? v.candidates : []).map(c => String(c).trim()).filter(Boolean);
      const matches = x => mine.some(m => answersCollide(m, x));
      const rivals = cands.filter(c => !matches(c));
      // The solver only drops on the one thing it can see for itself: the
      // answer being in the wording. Rivals and a differing best answer are
      // recorded and handed to the judge, which has the planned answer and
      // can tell a synonym from a second answer.
      const fails = [];
      if (bool(v.fromWording)) fails.push("answerable from the wording");
      it.solved = fails.length ? "out" : "in";
      it.solverBest = best; it.solverCandidates = cands; it.solverRivals = rivals.slice(0, 4); it.solverDiffers = !!best && !matches(best); it.solverConfidence = String(v.confidence || "");
      if (fails.length) { it.judgeNote = fails.join("; "); out.push(`${it.subject}: ${it.judgeNote}`); }
      else if (rivals.length || it.solverDiffers) noted.push(`${it.subject}: ${it.solverDiffers ? `solver said "${best}"` : ""}${rivals.length ? `${it.solverDiffers ? "; " : ""}possible rivals ${rivals.slice(0, 3).join(", ")}` : ""} (for the judge)`);
    }
    items.filter(it => !it.solved).forEach(it => { it.solved = "unsolved"; });
    const before = kept.length;
    for (let i = kept.length - 1; i >= 0; i--) if (kept[i].solved === "out") kept.splice(i, 1);
    a.validation = [out.length ? `out ${before - kept.length}: ${out.join(" | ")}` : "all solvable", noted.length ? `noted: ${noted.join(" | ")}` : ""].filter(Boolean).join(" · ");
    a.subjects = summary();
  }

  const maxPlan = 4, maxWrite = Math.ceil(k / initialBatch) + 6, maxEmpty = 4, maxJudge = 3, maxSolve = 3;
  while (emptyCalls < maxEmpty) {
    if (kept.length < k) {
      if (!pending.length) {
        if (planCalls >= maxPlan) break;
        await plan(k - kept.length);
        if (!pending.length) continue;
      }
      if (writeCalls >= maxWrite) break;
      await write();
      continue;
    }
    // full set written: solve blind, then judge against the topic; loop if either shrank it
    if (kept.some(x => !x.solved) && solveCalls < maxSolve) { await solve(); continue; }
    if (kept.some(x => !x.judged) && judgeCalls < maxJudge) { await judge(); continue; }
    break;
  }
  // If the budget ran out before the checks, run each once more if allowed.
  if (kept.some(x => !x.solved) && solveCalls < maxSolve && emptyCalls < maxEmpty) await solve();
  if (kept.some(x => !x.judged) && judgeCalls < maxJudge && emptyCalls < maxEmpty) await judge();

  if (difficulty === "Medium" && k >= 3 && kept.length >= 3) {
    const cnt = l => kept.filter(x => x.level === l).length;
    if (cnt(3) < cnt(2) || cnt(3) < cnt(4)) log.acceptedWithProblems = [log.acceptedWithProblems, `medium set is not mostly level 3 (${cnt(2)}×2, ${cnt(3)}×3, ${cnt(4)}×4)`].filter(Boolean).join("; ");
  }
  log.shortfall = Math.max(0, k - kept.length);
  log.finishedAt = new Date().toISOString();
  onStatus(kept.length >= k ? "done" : kept.length ? `short (${kept.length}/${k})` : "failed");
  return { bank: kept.slice(0, k), log };
}

const SELF_TESTS = runSelfTests();

// ---------- export ----------
function download(name, text, type = "application/json") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const el = document.createElement("a");
  el.href = url; el.download = name; document.body.appendChild(el); el.click();
  setTimeout(() => { document.body.removeChild(el); URL.revokeObjectURL(url); }, 0);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    try { const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); return true; }
    catch { return false; }
  }
}

// ---------- UI pieces ----------
const Btn = ({ children, onClick, tone = "paper", disabled, full, small }) => {
  const styles = {
    paper: { background: C.paper, color: C.ink },
    brass: { background: C.brass, color: C.ink },
    ghost: { background: "transparent", color: C.paper, boxShadow: `inset 0 0 0 1px ${C.paperFaint}` },
    ember: { background: C.ember, color: C.paper },
  }[tone];
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${full ? "w-full" : ""} ${small ? "px-3 py-1.5 text-[13px]" : "px-5 py-3 text-[15px]"} rounded-[3px] font-medium transition-[transform,opacity] active:scale-[0.985] disabled:opacity-35`}
      style={{ ...styles, fontFamily: SANS, letterSpacing: "0.005em" }}>
      {children}
    </button>
  );
};

const Chip = ({ active, onClick, children, dim, small }) => (
  <button onClick={onClick} aria-disabled={dim}
    className={`${small ? "px-2 py-1 text-[12px]" : "px-3 py-1.5 text-[14px]"} rounded-[3px] font-medium transition-colors`}
    style={{ fontFamily: SANS, opacity: dim ? 0.3 : 1, background: active ? C.brass : "transparent", color: active ? C.ink : C.paper, boxShadow: active ? "none" : `inset 0 0 0 1px ${C.paperFaint}` }}>
    {children}
  </button>
);

const Stepper = ({ value, min, max, onChange, suffix }) => (
  <div className="inline-flex items-stretch rounded-[3px]" style={{ boxShadow: `inset 0 0 0 1px ${C.paperFaint}` }}>
    <button onClick={() => onChange(Math.max(min, value - 1))} className="px-3 text-lg" style={{ color: C.paperDim }} aria-label="fewer">−</button>
    <span className="px-3 py-2 min-w-[6rem] text-center nums" style={{ color: C.paper, fontFamily: SANS, fontWeight: 500 }}><span className="serif-text" style={{ fontSize: "1.25rem", color: C.brass }}>{value}</span>{suffix}</span>
    <button onClick={() => onChange(Math.min(max, value + 1))} className="px-3 text-lg" style={{ color: C.paperDim }} aria-label="more">+</button>
  </div>
);

const HelpToggle = ({ open, onClick, label = "Help" }) => (
  <button onClick={onClick} aria-expanded={open} aria-label={label}
    className="w-6 h-6 rounded-full text-[11px] font-semibold shrink-0 serif-text"
    style={{ background: open ? C.brass : "transparent", color: open ? C.ink : C.paperDim, boxShadow: open ? "none" : `inset 0 0 0 1px ${C.paperFaint}`, fontStyle: "italic" }}>?</button>
);
const HelpPanel = ({ children }) => (
  <div className="text-[14px] mt-3 pl-4 py-1 leading-relaxed reveal" style={{ borderLeft: `2px solid ${C.brassDim}`, color: C.paper }}>{children}</div>
);
const Label = ({ children }) => <span className="text-[13px] font-medium serif-text" style={{ color: C.brass, fontStyle: "italic", fontSize: "1.05rem" }}>{children}</span>;
const Field = ({ label, children, help, note, warn }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-9">
      <div className="flex items-center gap-2 mb-3">
        <Label>{tc(label)}</Label>
        {help && <HelpToggle open={open} onClick={() => setOpen(o => !o)} label={`Help: ${label}`} />}
      </div>
      {children}
      {note && <div className="text-[13px] mt-3 leading-relaxed" style={{ color: C.paperDim }}>{note}</div>}
      {warn && <div className="text-[13px] mt-3 leading-relaxed pl-3" style={{ color: C.ember, borderLeft: `2px solid ${C.ember}` }}>{warn}</div>}
      {help && open && <HelpPanel>{help}</HelpPanel>}
    </div>
  );
};
const HelpList = ({ items }) => (
  <ul className="flex flex-col gap-2">
    {items.map(({ title, body, unavailable }, i) => (
      <li key={i} style={{ opacity: unavailable ? 0.55 : 1 }}>
        <span className="font-semibold">{title}</span>
        {unavailable && <span style={{ color: C.brass }}> ({unavailable})</span>}
        <div style={{ color: C.paperDim }}>{body}</div>
      </li>
    ))}
  </ul>
);
const Check = ({ checked, onChange, children }) => (
  <label className="flex items-start gap-3 mt-3 text-[14px] cursor-pointer select-none">
    <span className="mt-[3px] w-4 h-4 rounded-[2px] shrink-0 inline-flex items-center justify-center" style={{ background: checked ? C.brass : "transparent", boxShadow: checked ? "none" : `inset 0 0 0 1px ${C.paperFaint}` }}>
      {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4l2.6 2.6L9 1" stroke={C.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
    </span>
    <input type="checkbox" className="sr-only" checked={checked} onChange={e => onChange(e.target.checked)} />
    <span>{children}</span>
  </label>
);
const Small = ({ children, tone = C.paperDim, className = "" }) => <div className={`text-[12.5px] leading-relaxed ${className}`} style={{ color: tone }}>{children}</div>;
const SubHead = ({ children }) => <div className="font-semibold mb-1 serif-text" style={{ fontSize: "1rem" }}>{tc(children)}</div>;
const Input = ({ value, onChange, placeholder, accent }) => (
  <input value={value} onChange={onChange} placeholder={placeholder}
    className="w-full bg-transparent px-0 py-2 text-[16px] transition-colors"
    style={{ color: C.paper, borderBottom: `1px solid ${accent ? C.brass : C.paperFaint}`, fontFamily: SANS }} />
);
const needs = m => `needs ${m.min === m.max ? m.min : `${m.min} to ${m.max}`} player${m.max === 1 ? "" : "s"}`;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---------- main ----------
export default function QuizNight() {
  const [phase, setPhase] = useState("setup"); // setup | loading | short | handoff | question | done | error
  const [players, setPlayers] = useState([
    { name: "", topic: "", difficulty: "Medium", format: "" },
    { name: "", topic: "", difficulty: "Medium", format: "" },
    { name: "", topic: "", difficulty: "Medium", format: "" },
  ]);
  const [perTopic, setPerTopic] = useState(5);
  const [modeRaw, setModeRaw] = useState("turns");
  const [winRaw, setWinRaw] = useState("count");
  const [steals, setSteals] = useState(true);
  const [stealValue, setStealValue] = useState(0.5);
  const [ownTopic, setOwnTopic] = useState("avoid");
  const [buzzerTimer, setBuzzerTimer] = useState(0);
  const [useSearch, setUseSearch] = useState(true);
  const [target, setTarget] = useState(null);
  const [notice, setNotice] = useState("");
  const [setupStep, setSetupStep] = useState(1);
  const [formatOpen, setFormatOpen] = useState({});
  const [errMsg, setErrMsg] = useState("");

  // generation
  const [banks, setBanks] = useState([]);        // per player index: array of questions (may be short) or undefined
  const [banksKey, setBanksKey] = useState("");
  const [genLogs, setGenLogs] = useState([]);
  const [topicStatus, setTopicStatus] = useState([]);
  const abortRef = useRef(null);
  const [cancelling, setCancelling] = useState(false);

  // game
  const [gameK, setGameK] = useState(null);
  const [gameTarget, setGameTarget] = useState(null);
  const [schedule, setSchedule] = useState([]);
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [stealPrompt, setStealPrompt] = useState(false);
  const [scores, setScores] = useState([]);
  const [faced, setFaced] = useState([]);
  const [plays, setPlays] = useState([]);
  const [flags, setFlags] = useState({});
  const [flagOpen, setFlagOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [endedBy, setEndedBy] = useState(null); // 'questions' | 'race' | 'coop' | 'table'
  const [raceWinner, setRaceWinner] = useState(null);
  const [gameHelp, setGameHelp] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [clock, setClock] = useState(null);
  const [copied, setCopied] = useState("");
  const markedRef = useRef(-1);
  const startedAtRef = useRef(null);

  const N = players.length;
  const legalMode = MODES[modeRaw].min <= N && N <= MODES[modeRaw].max ? modeRaw : (N === 1 ? "solo" : "turns");
  const legalWin = WINS[winRaw].min <= N && N <= WINS[winRaw].max ? winRaw : (N === 1 ? "count" : "highest");
  const stealsOn = steals && legalMode === "turns" && N >= 3;
  const inGame = phase === "handoff" || phase === "question" || phase === "done";
  const kNow = inGame && gameK ? gameK : perTopic;
  const total = N * kNow;

  const defaultTargetFor = (k) => {
    const tot = N * k;
    if (legalWin === "target") return Math.ceil(tot * 0.7);
    if (legalWin === "coop") return Math.ceil(tot * 0.6);
    if (legalWin === "race") return Math.max(1, Math.ceil((legalMode === "buzzer" ? tot - k : k) * 0.6));
    return null;
  };
  const maxTargetFor = (k) => {
    const tot = N * k;
    if (legalWin === "race") return legalMode === "buzzer" ? tot - k : k + (stealsOn ? (tot - k) * stealValue : 0);
    return tot;
  };
  const maxTarget = Math.max(1, Math.floor(maxTargetFor(perTopic)));
  const setupTarget = legalWin === "count" || legalWin === "highest" ? null : clamp(target ?? defaultTargetFor(perTopic), 1, maxTarget);
  const effTarget = inGame ? gameTarget : setupTarget;

  const setMode = k => { setModeRaw(k); setTarget(null); };
  const setWin = k => { setWinRaw(k); setTarget(null); };
  const setCount = n => {
    setPlayers(p => { const next = p.slice(0, n); while (next.length < n) next.push({ name: "", topic: "", difficulty: "Medium", format: "" }); return next; });
    setTarget(null);
  };
  const upd = (i, key, v) => setPlayers(p => p.map((x, j) => (j === i ? { ...x, [key]: v } : x)));
  const setAllDiff = d => setPlayers(p => p.map(x => ({ ...x, difficulty: d })));

  const named = players.map((p, i) => ({ ...p, name: p.name.trim() || `Player ${i + 1}`, topic: p.topic.trim(), format: (p.format || "").trim() }));
  const ready = named.every(p => p.topic.length > 0);
  const keyFor = () => JSON.stringify({ t: named.map(p => [p.topic, p.difficulty, p.format]), k: perTopic, s: useSearch });

  // setup warnings
  const overlapWarn = useMemo(() => {
    const out = [];
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
      const o = topicOverlap(named[i].topic, named[j].topic);
      if (o === "same") out.push(`${named[i].name} and ${named[j].name} have the same topic; both banks will be written separately and will overlap.`);
      else if (o === "overlap") out.push(`${named[i].name}'s and ${named[j].name}'s topics overlap; each will be told to keep off the other's ground, but expect some near-duplicates.`);
    }
    return out;
  }, [players]);
  const nonLatinWarn = named.some(p => hasNonLatin(p.topic)) ? "A topic uses a non-Latin script. Duplicate checking only understands Latin letters for now, so questions on that topic may be wrongly rejected as repeats." : null;
  const failedTests = SELF_TESTS.filter(t => !t.ok);

  // ---------- generation flow ----------
  async function generate({ force = false } = {}) {
    const key = keyFor();
    const reuse = !force && key === banksKey ? banks : [];
    setBanksKey(key);
    setPhase("loading");
    setErrMsg("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setCancelling(false);
    const status = named.map((_, i) => (reuse[i] && reuse[i].length >= perTopic ? "kept from last time" : "queued"));
    setTopicStatus(status);
    const setOne = (i, v) => setTopicStatus(st => st.map((x, j) => (j === i ? v : x)));
    const results = new Array(N);
    const logs = new Array(N);
    let cancelled = false;
    let next = 0;
    const worker = async () => {
      while (next < N && !cancelled) {
        const i = next++;
        const existing = reuse[i] || [];
        if (existing.length >= perTopic) { results[i] = existing; logs[i] = genLogs[i] || { topic: named[i].topic, attempts: [], reused: true }; continue; }
        try {
          const r = await fetchBank(named[i].topic, perTopic, named[i].difficulty, { onStatus: v => setOne(i, v), useSearch, signal: ctrl.signal, otherTopics: named.filter((_, j) => j !== i).map(p => p.topic), existing, format: named[i].format });
          results[i] = r.bank; logs[i] = existing.length ? { ...r.log, toppedUp: existing.length } : r.log;
        } catch (e) {
          if (e?.name === "AbortError") { cancelled = true; results[i] = existing; logs[i] = genLogs[i] || { topic: named[i].topic, attempts: [], cancelled: true }; setOne(i, "cancelled"); return; }
          results[i] = existing; logs[i] = { topic: named[i].topic, attempts: [], fatal: e.message }; setOne(i, "failed");
        }
      }
    };
    await Promise.all([worker(), worker()]);
    abortRef.current = null;
    setCancelling(false);
    const finalBanks = results.map(r => r || []);
    setBanks(finalBanks);
    setGenLogs(logs.map((l, i) => l || { topic: named[i].topic, attempts: [], cancelled: true }));
    if (cancelled) { setSetupStep(3); setPhase("setup"); setNotice("Cancelled. Anything already written is kept for the next attempt with the same setup."); return; }
    const counts = finalBanks.map(b => b.length);
    if (counts.some(c => c === 0)) {
      setErrMsg(named.filter((_, i) => counts[i] === 0).map(p => `No usable questions for "${p.topic}".`).join(" "));
      setPhase("error");
      return;
    }
    if (counts.some(c => c < perTopic)) { setPhase("short"); return; }
    beginGame(finalBanks, perTopic);
  }

  function beginGame(bks, k) {
    const trimmed = bks.map(b => b.slice(0, k));
    const sched = buildSchedule(trimmed, N, legalMode, ownTopic);
    // Target: a manual target scales with the shortened round; a default is recomputed.
    let gt = null;
    if (legalWin !== "count" && legalWin !== "highest") {
      const mx = Math.max(1, Math.floor(maxTargetFor(k)));
      gt = target !== null ? clamp(Math.round(target * k / perTopic), 1, mx) : clamp(defaultTargetFor(k), 1, mx);
    }
    setGameK(k); setGameTarget(gt);
    setSchedule(sched); setIdx(0); setRevealed(false); setStealPrompt(false);
    setScores(Array(N).fill(0)); setFaced(Array(N).fill(0)); setPlays([]); setFlags({}); setHistory([]);
    setEndedBy(null); setRaceWinner(null); setConfirmEnd(false); setClock(null); setFlagOpen(false);
    markedRef.current = -1; startedAtRef.current = new Date().toISOString();
    setPhase(legalMode === "solo" ? "question" : "handoff");
  }

  const cur = schedule[idx];
  const eligible = q => legalMode === "solo" ? [0] : legalMode === "turns" ? [q.answerer] : named.map((_, i) => i).filter(i => i !== q.reader);

  // reset the double-tap lock and the clock whenever the question changes
  useEffect(() => { setClock(null); setFlagOpen(false); }, [idx]);
  useEffect(() => {
    if (clock === null || clock <= 0) return;
    const id = setTimeout(() => setClock(c => (c === null ? null : c - 1)), 1000);
    return () => clearTimeout(id);
  }, [clock]);

  function snapshot() { return { idx, scores, faced, plays, endedBy, raceWinner }; }
  function advance(nextPlays, nextScores, nextFaced, ended) {
    setPlays(nextPlays); setScores(nextScores); setFaced(nextFaced);
    const last = idx + 1 >= schedule.length;
    if (ended || last) { setEndedBy(ended || "questions"); setPhase("done"); return; }
    setIdx(idx + 1); setRevealed(false); setStealPrompt(false);
    const nextQ = schedule[idx + 1];
    setPhase(legalMode !== "solo" && nextQ.reader !== cur.reader ? "handoff" : "question");
  }

  function finish(who, viaSteal) {
    if (markedRef.current === idx) return;   // double-tap guard
    markedRef.current = idx;
    setHistory(h => [...h, snapshot()]);
    const pts = who === null ? 0 : viaSteal ? stealValue : 1;
    const nextScores = scores.slice();
    if (who !== null) nextScores[who] += pts;
    const nextFaced = faced.slice();
    eligible(cur).forEach(i => (nextFaced[i] += 1));
    const nextPlays = [...plays, { i: idx, who, pts, viaSteal, at: new Date().toISOString() }];
    let ended = null;
    if (legalWin === "race" && who !== null && nextScores[who] >= gameTarget) { ended = "race"; setRaceWinner(who); }
    if (legalWin === "coop" && nextScores.reduce((a, b) => a + b, 0) >= gameTarget) ended = "coop";
    advance(nextPlays, nextScores, nextFaced, ended);
  }
  function voidQuestion() {
    if (markedRef.current === idx) return;
    markedRef.current = idx;
    setHistory(h => [...h, snapshot()]);
    advance([...plays, { i: idx, void: true, at: new Date().toISOString() }], scores, faced, null);
  }
  function undo() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory(h => h.slice(0, -1));
    setIdx(prev.idx); setScores(prev.scores); setFaced(prev.faced); setPlays(prev.plays);
    setEndedBy(prev.endedBy); setRaceWinner(prev.raceWinner);
    setRevealed(true); setStealPrompt(false); setConfirmEnd(false);
    markedRef.current = -1;
    setPhase("question");
  }
  function endRound() { setEndedBy("table"); setPhase("done"); setConfirmEnd(false); }
  function onWrongInTurns() {
    const others = named.map((_, i) => i).filter(i => i !== cur.reader && i !== cur.answerer);
    if (stealsOn && others.length > 0) setStealPrompt(true);
    else finish(null, false);
  }
  const toggleFlag = (i, reason) => setFlags(f => {
    const cur = new Set(f[i] || []);
    if (cur.has(reason)) cur.delete(reason); else cur.add(reason);
    const next = { ...f }; if (cur.size) next[i] = [...cur]; else delete next[i];
    return next;
  });

  // ---------- export ----------
  function roundText() {
    const lines = [];
    named.forEach((p, t) => {
      const b = banks[t] || [];
      if (!b.length) return;
      lines.push(`${p.topic} (${p.difficulty})`);
      b.forEach((q, r) => {
        const i = schedule.find(s => s.topic === t && s.q === q.q)?.i;
        const fl = i !== undefined && flags[i] ? ` [flagged: ${flags[i].join(", ")}]` : "";
        lines.push(`${r + 1}. ${q.q}`);
        lines.push(`   → ${q.a}${q.alt?.length ? ` (also: ${q.alt.join(", ")})` : ""}${fl}`);
      });
      lines.push("");
    });
    return lines.join("\n");
  }
  function devExport() {
    return {
      app: "quiz-night", version: VERSION, exportedAt: new Date().toISOString(), userAgent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      setup: { players: named.map(p => ({ name: p.name, topic: p.topic, difficulty: p.difficulty, format: p.format || null })), perTopic, gameK, mode: legalMode, win: legalWin, target, gameTarget, steals: stealsOn, stealValue, ownTopic, useSearch, buzzerTimer },
      generation: genLogs,
      banks: named.map((p, t) => ({ topic: p.topic, difficulty: p.difficulty, questions: banks[t] || [] })),
      play: { startedAt: startedAtRef.current, schedule: schedule.map(s => ({ i: s.i, topic: s.topic, reader: s.reader, answerer: s.answerer, subject: s.subject, angle: s.angle, level: s.level, jargon: s.jargon, verified: s.verified, source: s.source || null, solved: s.solved || null, solverBest: s.solverBest || null, solverCandidates: s.solverCandidates || null, rivalVerdicts: s.rivalVerdicts || null, judged: s.judged || null, judgeNote: s.judgeNote || null })), events: plays, flags, scores, faced, endedBy, raceWinner, current: idx, phase },
      selfTests: SELF_TESTS,
      text: roundText(),
    };
  }
  // First line carries the identity, so a paste preview that shows one line
  // shows something other than "{".
  const exportJson = () => JSON.stringify(devExport(), null, 2).replace(/^\{\n\s+"app": ("[^"]*"),\n\s+"version": ("[^"]*"),/, '{ "app": $1, "version": $2,');
  const doCopy = async (what) => { const ok = await copyText(what === "text" ? roundText() : exportJson()); setCopied(ok ? what : "failed"); setTimeout(() => setCopied(""), 2000); };
  const doDownload = () => download(`quiz-night-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, exportJson());

  const ExportBar = () => (
    <div className="flex flex-wrap gap-2 mt-6">
      <Btn tone="ghost" small onClick={() => doCopy("text")}>{copied === "text" ? "Copied" : "Copy questions & answers"}</Btn>
      <Btn tone="ghost" small onClick={doDownload}>Download dev log</Btn>
      <Btn tone="ghost" small onClick={() => doCopy("json")}>{copied === "json" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy dev log"}</Btn>
    </div>
  );

  // ---------- screens ----------
  const shell = children => (
    <div className="qn min-h-screen w-full flex justify-center">
      <style>{GLOBAL_CSS}</style>
      <div className="w-full max-w-[34rem] px-6 pt-10 pb-16">{children}</div>
    </div>
  );
  const H = ({ children, sub }) => (
    <div className="mb-9">
      <h1 className="serif leading-[0.95]" style={{ fontSize: "clamp(2.6rem, 9vw, 3.8rem)", fontWeight: 500, letterSpacing: "-0.015em" }}>{typeof children === "string" ? tc(children) : children}</h1>
      {sub && <p className="mt-4 text-[15px] leading-relaxed" style={{ color: C.paperDim, maxWidth: "38ch" }}>{sub}</p>}
    </div>
  );
  const GenLog = () => (
    <div className="flex flex-col gap-4 text-[12px]" style={{ color: C.paper }}>
      {genLogs.map((l, i) => (
        <div key={i} className="pl-3" style={{ borderLeft: `2px solid ${C.paperFaint}` }}>
          <div className="font-semibold text-[13px] mb-1 serif-text" style={{ fontSize: "1rem" }}>{l.topic}</div>
          <div style={{ color: C.paperDim }}>
            model: {l.model || "none"} · members: {l.members ?? "?"} · web check {l.search ? "on" : "off"}{l.difficulty ? ` · ${l.difficulty.toLowerCase()}` : ""}{l.format ? ` · fixed format: ${l.format}` : l.formatDecided ? ` · format: ${l.formatDecided}` : ""}
            {l.reused && <span style={{ color: C.brass }}> · kept from last time</span>}
            {l.toppedUp !== undefined && <span style={{ color: C.brass }}> · topped up from {l.toppedUp}</span>}
            {l.shortfall > 0 && <span style={{ color: C.ember }}> · short by {l.shortfall}</span>}
            {l.memberNote && <span style={{ color: C.brass }}> · {l.memberNote}</span>}
            {l.reading && <div className="mt-1">reading — includes: {l.reading.includes}; excludes: {l.reading.excludes}; answers are: {l.reading.answers}</div>}
            {l.judgeConstraints && <div className="mt-1">judge's constraints: {l.judgeConstraints.join("; ")}</div>}
            {l.acceptedWithProblems && <span style={{ color: C.brass }}> · {l.acceptedWithProblems}</span>}
            {l.fatal && <span style={{ color: C.ember }}> · {l.fatal}</span>}
            {l.cancelled && <span style={{ color: C.ember }}> · cancelled</span>}
          </div>
          {(l.attempts || []).map((a, j) => (
            <div key={j} className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
              <div>{a.stage || "call"} {a.call}{a.asked ? ` (${a.stage === "plan" ? "needed" : a.stage === "write" ? "asked for" : "checked"} ${a.asked})` : ""} · {a.model} · HTTP {a.status ?? "—"}{a.stopReason ? ` · stop: ${a.stopReason}` : ""}{a.usage ? ` · ${a.usage}` : ""}{a.ms ? ` · ${(a.ms / 1000).toFixed(1)}s` : ""}{a.rateWaits ? ` · waited out ${a.rateWaits} rate limit${a.rateWaits === 1 ? "" : "s"}` : ""}</div>
              {a.searches && <div style={{ color: C.paperDim }}>searches: {a.searches}</div>}
              {a.toolErrors && <div style={{ color: C.ember }}>search errors: {a.toolErrors}</div>}
              {a.sourceNote && <div style={{ color: C.brass }}>sources: {a.sourceNote}</div>}
              {a.pauses && <div style={{ color: C.brass }}>paused and resumed {a.pauses}×</div>}
              {a.batchNote && <div style={{ color: C.brass }}>{a.batchNote}</div>}
              {a.relaxNote && <div style={{ color: C.brass }}>{a.relaxNote}</div>}
              {a.transportRetry && <div style={{ color: C.brass }}>transport: {a.transportRetry}</div>}
              {a.apiError && <div style={{ color: C.ember }}>api: {a.apiError}</div>}
              {a.parse && <div style={{ color: a.parse.startsWith("failed") ? C.ember : a.parse.startsWith("ok") ? C.paperDim : C.brass }}>parse: {a.parse}</div>}
              {a.validation && <div style={{ color: /^all /.test(a.validation) ? C.paperDim : C.brass }}>validation: {a.validation}</div>}
              {a.subjects && <div style={{ color: C.paperDim }}>subjects: {a.subjects.join(" / ")}</div>}
              {a.rawHead && <pre className="mt-1 whitespace-pre-wrap break-words" style={{ color: C.paperDim }}>{a.rawHead}</pre>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
  const LogToggle = ({ label = "how the questions were made" }) => (
    <div className="mt-6">
      <button onClick={() => setShowLog(o => !o)} className="text-[13px] underline underline-offset-4 decoration-1" style={{ color: C.paperDim, textDecorationColor: C.paperFaint }}>{showLog ? "Hide" : "Show"} {label}</button>
      {showLog && <div className="mt-4"><GenLog /></div>}
    </div>
  );

  // ----- setup: three steps -----
  if (phase === "setup") {
    const DIFF_HELP = {
      Easy: "Things most people at the table will know or half-remember.",
      Medium: "Standard quiz. A fan of the topic gets most; everyone else gets a few.",
      Hard: "For people who chose the topic because they know it cold. Expect blanks.",
    };
    const readEach = perTopic;
    const answerEach = legalMode === "buzzer" ? total - perTopic : legalMode === "solo" ? total : perTopic;
    const allSame = players.every(p => p.difficulty === players[0].difficulty) ? players[0].difficulty : null;
    const STEPS = ["Players", "Topics", "Rules"];

    const StepBar = () => (
      <div className="flex items-baseline gap-5 mb-10 text-[13px]" style={{ fontFamily: SANS }}>
        {STEPS.map((label, i) => {
          const n = i + 1, done = n < setupStep, here = n === setupStep;
          return (
            <button key={label} onClick={() => done && setSetupStep(n)} className="flex items-baseline gap-2 rounded" style={{ color: here ? C.paper : done ? C.brass : C.paperFaint, cursor: done ? "pointer" : "default" }}>
              <span className="serif-text" style={{ fontSize: "1.15rem", fontStyle: "italic", color: here ? C.brass : "inherit" }}>{n}</span>
              <span className={here ? "font-medium" : ""}>{label}</span>
            </button>
          );
        })}
      </div>
    );
    const Nav = ({ nextLabel, onNext, nextDisabled, nextTone = "paper" }) => (
      <div className="flex gap-2 mt-10">
        {setupStep > 1 && <Btn tone="ghost" onClick={() => setSetupStep(st => st - 1)}>Back</Btn>}
        <Btn tone={nextTone} onClick={onNext} disabled={nextDisabled} full>{nextLabel}</Btn>
      </div>
    );

    if (setupStep === 1) return shell(
      <>
        <StepBar />
        <H sub="A quiz on one phone, passed round the table. Whoever's holding it reads; the rules make sure that costs nobody anything.">Quiz Night</H>
        <Field label="How many are playing" help={<>Player count sets which modes and win conditions are available; greyed options say why when you tap them. One person plays solo and marks themselves; two can only take turns, because a race with one runner isn't a race.</>}>
          <div className="flex gap-2">{[1, 2, 3, 4, 5].map(n => (
            <button key={n} onClick={() => { setCount(n); setNotice(""); }} className="w-12 h-12 rounded-[3px] serif-text nums transition-colors" style={{ fontSize: "1.5rem", background: N === n ? C.brass : "transparent", color: N === n ? C.ink : C.paper, boxShadow: N === n ? "none" : `inset 0 0 0 1px ${C.paperFaint}` }}>{n}</button>
          ))}</div>
        </Field>
        <Small>{N === 1 ? "Solo: you read, answer and mark yourself." : N === 2 ? "Two players take turns; one reads while the other answers." : `${N} players: turns or a shouting race, your choice on the last step.`}</Small>
        {failedTests.length > 0 && <Small tone={C.ember} className="mt-4">{failedTests.length} internal self-check{failedTests.length === 1 ? "" : "s"} failed at load: {failedTests.map(t => t.name).join("; ")}. The app will run, but validation may misbehave; the dev log has details.</Small>}
        <Nav nextLabel="Next: topics" onNext={() => setSetupStep(2)} />
      </>
    );

    if (setupStep === 2) return shell(
      <>
        <StepBar />
        <Field label={N === 1 ? "Your name, topic and difficulty" : "One topic each, with its difficulty"}
          warn={[...overlapWarn, nonLatinWarn].filter(Boolean).join(" ") || null}
          help={<>
            <p className="mb-2">Anything goes: Roman roads, 90s indie B-sides, the Bundesliga, your mum's garden. Sharper topics get sharper questions. Questions are split equally across topics{N === 1 ? "." : ", and each topic's questions are told to keep off the other topics' ground."}</p>
            <p className="mb-2">Difficulty is per topic. {N === 1 ? "" : "Everyone answers everyone else's topic, so the expert's topic can be hard while a lighter one stays easy."}</p>
            <p className="mb-2">A fixed question format makes every question in that topic follow one pattern ("Which country's flag has..."), with the variety in the answers. Left blank, the quiz decides: most topics get mixed angles; a few, like flags or capitals, are given one pattern because the repetition suits them.</p>
            <HelpList items={DIFFS.map(d => ({ title: d, body: DIFF_HELP[d] }))} />
          </>}>
          <div className="flex flex-col gap-7">
            {players.map((p, i) => (
              <div key={i} className="grid grid-cols-[2rem_1fr] gap-x-3">
                <div className="serif-text nums pt-1" style={{ fontSize: "1.6rem", fontStyle: "italic", color: C.brass, lineHeight: 1 }}>{i + 1}</div>
                <div>
                  <Input value={p.name} onChange={e => upd(i, "name", e.target.value)} placeholder={`Player ${i + 1}`} />
                  <div className="mt-2"><Input value={p.topic} onChange={e => upd(i, "topic", e.target.value)} placeholder="Topic" accent={!!p.topic} /></div>
                  <div className="flex items-center gap-2 mt-3 text-[12.5px]" style={{ color: C.paperDim }}>
                    <span className="mr-auto">Difficulty</span>
                    {DIFFS.map(d => <Chip key={d} small active={p.difficulty === d} onClick={() => upd(i, "difficulty", d)}>{d}</Chip>)}
                  </div>
                  <div className="mt-2">
                    <button onClick={() => setFormatOpen(f => ({ ...f, [i]: !f[i] }))} className="text-[12.5px] underline underline-offset-4 decoration-1" style={{ color: p.format ? C.brass : C.paperDim, textDecorationColor: C.paperFaint }}>
                      {p.format ? `Fixed format: ${p.format}` : formatOpen[i] ? "Fixed question format (leave blank for mixed)" : "Fix the question format?"}
                    </button>
                    {formatOpen[i] && <div className="mt-1"><Input value={p.format || ""} onChange={e => upd(i, "format", e.target.value)} placeholder={"e.g. Which country's flag has..."} accent={!!p.format} /></div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {N > 1 && (
            <div className="flex items-center gap-2 mt-6 text-[12.5px] pl-[2.75rem]" style={{ color: C.paperDim }}>
              <span>Set all to</span>
              {DIFFS.map(d => <Chip key={d} small active={allSame === d} onClick={() => setAllDiff(d)}>{d}</Chip>)}
            </div>
          )}
        </Field>
        <Nav nextLabel={ready ? "Next: rules" : "Give everyone a topic first"} onNext={() => setSetupStep(3)} nextDisabled={!ready} />
      </>
    );

    return shell(
      <>
        <StepBar />
        <Field label="Length"
          note={`${total} questions in total.${N === 1 ? "" : ` Each player reads ${readEach} and can answer ${answerEach}.`}`}
          help={<>
            <p className="mb-2">The total is always players × questions per topic, which is what keeps the reading fair: every player reads exactly {perTopic}, whatever the mode.</p>
            <p>Checking answers against the web makes the model confirm each answer with a search before it's used. It roughly doubles the writing time and the questions are written one or two at a time; turn it off for a quick round. Each answer shows whether it was checked.</p>
          </>}>
          <Stepper value={perTopic} min={2} max={10} onChange={v => { setPerTopic(v); setTarget(null); }} suffix=" per topic" />
          <Check checked={useSearch} onChange={setUseSearch}>Check answers against the web: slower, fewer wrong answers</Check>
        </Field>

        <Field label="How it's played" note={MODES[legalMode].blurb}
          help={<>
            <HelpList items={Object.values(MODES).map(m => ({ title: m.label, body: m.blurb, unavailable: m.min <= N && N <= m.max ? null : needs(m) }))} />
            <p className="mt-3" style={{ color: C.paperDim }}>In every mode the reader sees the answer and can't take the point. The schedule rotates so everyone reads the same number of times, and in Turns the reader and answerer pairings change from round to round.</p>
            <p className="mt-2" style={{ color: C.paperDim }}>"Own topic" decides whether a player can ever be asked a question from the topic they chose. Off, the chooser reads their own topic in First to shout and is never the answerer in Turns. On, topics rotate freely and the chooser is treated like anyone else.</p>
            {legalMode === "buzzer" && <p className="mt-2" style={{ color: C.paperDim }}>The clock, if on, is started by the reader after reading. It's a prompt, not a rule: the reader can reveal early if someone shouts, or press "no one" when it runs out.</p>}
          </>}>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(MODES).map(([k, m]) => {
              const ok = m.min <= N && N <= m.max;
              return <Chip key={k} active={legalMode === k} dim={!ok} onClick={() => ok ? (setMode(k), setNotice("")) : setNotice(`${m.label} ${needs(m)}.`)}>{m.label}</Chip>;
            })}
          </div>
          {N >= 2 && (
            <div className="mt-4 pl-4" style={{ borderLeft: `2px solid ${C.paperFaint}` }}>
              <Check checked={ownTopic === "allow"} onChange={v => setOwnTopic(v ? "allow" : "avoid")}>Players can be asked questions from their own topic</Check>
              {legalMode === "turns" && N >= 3 && (
                <>
                  <Check checked={steals} onChange={setSteals}>Allow steals: if the answerer misses, anyone but the reader can take it</Check>
                  {steals && (
                    <div className="flex items-center gap-2 mt-3 ml-7 text-[12.5px]" style={{ color: C.paperDim }}>
                      <span>A steal is worth</span>
                      <Chip small active={stealValue === 0.5} onClick={() => { setStealValue(0.5); setTarget(null); }}>½ point</Chip>
                      <Chip small active={stealValue === 1} onClick={() => { setStealValue(1); setTarget(null); }}>1 point</Chip>
                    </div>
                  )}
                </>
              )}
              {legalMode === "buzzer" && (
                <div className="flex items-center gap-2 mt-4 text-[12.5px] flex-wrap" style={{ color: C.paperDim }}>
                  <span>Shout clock</span>
                  {[0, 10, 20, 30].map(sec => <Chip key={sec} small active={buzzerTimer === sec} onClick={() => setBuzzerTimer(sec)}>{sec === 0 ? "Off" : `${sec}s`}</Chip>)}
                </div>
              )}
            </div>
          )}
        </Field>

        <Field label="How you win" note={WINS[legalWin].blurb}
          help={<>
            <HelpList items={Object.values(WINS).map(w => ({ title: w.label, body: w.blurb, unavailable: w.min <= N && N <= w.max ? null : needs(w) }))} />
            <p className="mt-3" style={{ color: C.paperDim }}>Targets start at a sensible default for this length and mode; adjust with the stepper. Race and team target can end the quiz early. If a round has to be played shorter than planned, a target you set is scaled down with it.</p>
          </>}>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(WINS).map(([k, w]) => {
              const ok = w.min <= N && N <= w.max;
              return <Chip key={k} active={legalWin === k} dim={!ok} onClick={() => ok ? (setWin(k), setNotice("")) : setNotice(`${w.label} ${needs(w)}.`)}>{w.label}</Chip>;
            })}
          </div>
          {setupTarget !== null && (
            <div className="mt-4">
              <Stepper value={setupTarget} min={1} max={maxTarget} onChange={setTarget} suffix={legalWin === "coop" ? ` of ${total}` : " points"} />
            </div>
          )}
        </Field>

        {notice && <div className="text-[13px] mb-4 pl-3" style={{ color: C.brass, borderLeft: `2px solid ${C.brassDim}` }}>{notice}</div>}
        <Nav nextTone="brass" nextLabel={banksKey === keyFor() && banks.some(b => b?.length) ? "Write the questions (reusing what's kept)" : "Write the questions"} onNext={() => generate()} nextDisabled={!ready} />
        <Small className="mt-4">Rounds aren't saved: refreshing or closing this page loses one in progress.</Small>
      </>
    );
  }

  // ----- loading -----
  if (phase === "loading") {
    return shell(
      <>
        <H sub={`Writing ${total} questions across ${N} ${N === 1 ? "topic" : "topics"}${useSearch ? ", checking each answer against the web" : ""}, then checking each set against its topic. ${useSearch ? "A minute or two" : "Half a minute or so"}; longer with more players.`}>Sharpening Pencils</H>
        <div className="flex flex-col mb-8">
          {named.map((p, i) => {
            const raw = topicStatus[i] || "queued";
            const finished = raw === "done" || raw === "kept from last time";
            const st = cancelling && !finished && raw !== "failed" ? "stopping" : raw;
            return (
              <div key={i} className="grid grid-cols-[2rem_1fr_auto] gap-x-3 items-baseline py-3" style={{ borderBottom: `1px solid ${C.line}` }}>
                <span className={`serif-text nums ${!finished && st !== "failed" ? "breathe" : ""}`} style={{ fontSize: "1.4rem", fontStyle: "italic", color: finished ? C.brass : st === "failed" ? C.ember : C.paperDim, lineHeight: 1 }}>{i + 1}</span>
                <span className="font-medium truncate">{p.topic}</span>
                <span className="text-[13px] shrink-0" style={{ color: finished ? C.brass : st === "failed" ? C.ember : C.paperDim }}>{st}</span>
              </div>
            );
          })}
        </div>
        <Btn tone="ghost" disabled={cancelling} onClick={() => { setCancelling(true); abortRef.current?.abort(); }}>{cancelling ? "Stopping" : "Cancel"}</Btn>
        <Small className="mt-4">{cancelling ? "Stopping now. Anything already written is kept." : "Cancelling keeps any topic already finished; the next attempt with the same setup starts from there."}</Small>
      </>
    );
  }

  // ----- short round offer -----
  if (phase === "short") {
    const counts = banks.map(b => b.length);
    const minK = Math.min(...counts);
    const shortIdx = counts.map((c, i) => (c < perTopic ? i : -1)).filter(i => i >= 0);
    const previewTarget = legalWin !== "count" && legalWin !== "highest" ? (target !== null ? clamp(Math.round(target * minK / perTopic), 1, Math.max(1, Math.floor(maxTargetFor(minK)))) : defaultTargetFor(minK)) : null;
    return shell(
      <>
        <H sub={`${shortIdx.map(i => `${named[i].topic}: ${counts[i]} of ${perTopic}`).join(". ")}. The rest are complete.`}>Some Topics Came Up Short</H>
        <div className="flex flex-col gap-8 mb-8">
          <div className="pl-4" style={{ borderLeft: `2px solid ${C.brassDim}` }}>
            <SubHead>Play with {minK} per topic</SubHead>
            <Small>{N * minK} questions instead of {total}. Every player still reads {minK}. {previewTarget !== null ? `Target becomes ${previewTarget}.` : ""} The extra questions on the fuller topics are dropped.</Small>
            <div className="mt-3"><Btn tone="brass" onClick={() => beginGame(banks, minK)}>Play shorter round</Btn></div>
          </div>
          <div className="pl-4" style={{ borderLeft: `2px solid ${C.paperFaint}` }}>
            <SubHead>Try to fill the short {shortIdx.length === 1 ? "topic" : "topics"}</SubHead>
            <Small>Keeps everything already written and asks only for the missing questions. Usually works; sometimes a topic simply doesn't have {perTopic} distinct things to ask at this difficulty.</Small>
            <div className="mt-3"><Btn onClick={() => generate()}>Top up</Btn></div>
          </div>
        </div>
        <Btn tone="ghost" onClick={() => { setSetupStep(3); setPhase("setup"); }}>Back to setup</Btn>
        <LogToggle label="log" />
      </>
    );
  }

  // ----- error -----
  if (phase === "error") {
    const okCount = banks.filter(b => b && b.length >= perTopic).length;
    return shell(
      <>
        <H sub={errMsg}>That Didn't Work</H>
        <div className="mb-8"><GenLog /></div>
        <div className="flex flex-wrap gap-2">
          <Btn tone="brass" onClick={() => generate()}>{okCount ? `Retry the failed topic${N - okCount === 1 ? "" : "s"} (${okCount} kept)` : "Try again"}</Btn>
          <Btn tone="ghost" onClick={() => { setSetupStep(2); setPhase("setup"); }}>Back to setup</Btn>
        </div>
        <ExportBar />
      </>
    );
  }

  // ----- handoff -----
  if (phase === "handoff") {
    const r = named[cur.reader];
    return shell(
      <div className="min-h-[72vh] flex flex-col justify-center">
        <div className="text-[13px] mb-6 nums" style={{ color: C.paperDim }}>Question {idx + 1} of {schedule.length}</div>
        <div className="serif-text mb-3" style={{ fontSize: "1.35rem", fontStyle: "italic", color: C.paperDim }}>Pass the phone to</div>
        <div className="serif leading-[0.9] mb-10 break-words" style={{ fontSize: "clamp(3.2rem, 15vw, 5.6rem)", fontWeight: 600, letterSpacing: "-0.02em", color: C.brass }}>{r.name}</div>
        <p className="mb-10 text-[15px] leading-relaxed" style={{ color: C.paperDim, maxWidth: "36ch" }}>
          {legalMode === "buzzer" ? (cur.reader === cur.topic ? "Your topic, your read. You sit this one out; the others race." : `You're reading ${named[cur.topic].name}'s topic. You sit this one out; the others race.`) : `You're reading for ${named[cur.answerer].name}. You don't answer this one.`}
        </p>
        <Btn full onClick={() => setPhase("question")}>{r.name}, I've got it</Btn>
      </div>
    );
  }

  // ----- question -----
  if (phase === "question") {
    const reader = named[cur.reader];
    const owner = named[cur.topic];
    const elig = eligible(cur);
    const teamTotal = scores.reduce((a, b) => a + b, 0);
    const instruction =
      legalMode === "solo" ? "Think, then reveal. Mark yourself honestly."
      : legalMode === "turns" ? `Read aloud to ${named[cur.answerer].name}.`
      : `Read aloud. Everyone except you can answer; first to shout it takes the point.`;
    const thisQuestion =
      legalMode === "solo" ? "Think of your answer, tap reveal, then mark yourself. One point if you had it."
      : legalMode === "turns" ? `${reader.name} reads; ${named[cur.answerer].name} answers. ${reader.name} can't score this one.${stealsOn ? ` If ${named[cur.answerer].name} misses, anyone except ${reader.name} can steal it for ${fmt(stealValue)} point${stealValue === 1 ? "" : "s"}.` : " A miss scores nobody."}`
      : `${reader.name} reads${cur.reader === cur.topic ? " their own topic" : ""}. Everyone else shouts; first correct answer takes the point. ${reader.name} can't score this one.`;
    const progress =
      legalWin === "count" ? `Nothing to hit. ${schedule.length - idx} left including this one; the scores just get tallied at the end.`
      : legalWin === "highest" ? `Highest score after question ${schedule.length} wins. ${schedule.length - idx} left including this one.`
      : legalWin === "target" ? `You need ${gameTarget} of ${schedule.length}. You have ${fmt(scores[0])}; ${fmt(Math.max(0, gameTarget - scores[0]))} to go with ${schedule.length - idx} questions left.`
      : legalWin === "race" ? `First to ${gameTarget} wins immediately. ` + named.map((p, i) => `${p.name} needs ${fmt(Math.max(0, gameTarget - scores[i]))}`).join(", ") + "."
      : `Team needs ${gameTarget} of ${schedule.length}. You have ${fmt(teamTotal)} between you, ${fmt(Math.max(0, gameTarget - teamTotal))} to go with ${schedule.length - idx} questions left.`;
    const flagged = flags[idx] || [];

    return shell(
      <>
        <div className="flex items-baseline justify-between gap-3 mb-8 text-[13px]" style={{ color: C.paperDim }}>
          <span className="shrink-0 whitespace-nowrap nums">Question {idx + 1} of {schedule.length}</span>
          <div className="flex items-baseline gap-3 min-w-0">
            <span className="truncate">{owner.topic}, {owner.difficulty.toLowerCase()}</span>
            <HelpToggle open={gameHelp} onClick={() => setGameHelp(o => !o)} label="Rules for this question" />
          </div>
        </div>

        {gameHelp && (
          <HelpPanel>
            <SubHead>This question</SubHead>
            {genLogs[cur.topic]?.reading && <p className="mb-2" style={{ color: C.paperDim }}>The topic was read as: {genLogs[cur.topic].reading.includes}; excluding {genLogs[cur.topic].reading.excludes}; answers are {genLogs[cur.topic].reading.answers}.</p>}
            {(named[cur.topic].format || genLogs[cur.topic]?.formatDecided?.startsWith("fixed")) && <p className="mb-2" style={{ color: C.paperDim }}>Fixed format for this topic: {named[cur.topic].format || genLogs[cur.topic].formatDecided.replace(/^fixed:\s*/, "")}</p>}
            <p className="mb-3" style={{ color: C.paperDim }}>{thisQuestion}{revealed && cur.subject ? ` Subject: ${cur.subject}${cur.angle ? ` (${cur.angle})` : ""}${cur.level ? `, rated ${cur.level} of 5` : ""}${cur.jargon ? ", specialist term" : ""}${cur.solved === "in" ? ", solved blind to the same answer" : ""}${cur.judged === "in" ? ", checked against the topic" : cur.judged === "unjudged" ? ", not checked against the topic" : ""}.` : ""}</p>
            <SubHead>Winning</SubHead>
            <p className="mb-3" style={{ color: C.paperDim }}>{progress}</p>
            {legalMode !== "solo" && (<><SubHead>Fairness</SubHead><p className="mb-3" style={{ color: C.paperDim }}>Every player reads {gameK} questions and is eligible to answer {legalMode === "buzzer" ? schedule.length - gameK : gameK}, so raw points compare directly.</p></>)}
            <SubHead>Table controls</SubHead>
            <div className="flex flex-wrap gap-2 mt-2">
              <Btn tone="ghost" small onClick={undo} disabled={!history.length}>Undo last marking</Btn>
              <Btn tone="ghost" small onClick={voidQuestion}>Void this question</Btn>
              {!confirmEnd ? <Btn tone="ghost" small onClick={() => setConfirmEnd(true)}>End round</Btn>
                : <><Btn tone="ember" small onClick={endRound}>End now and tally</Btn><Btn tone="ghost" small onClick={() => setConfirmEnd(false)}>Keep playing</Btn></>}
            </div>
            <Small className="mt-3">Void drops a bad question with no score change and no one charged with it. End round tallies what's been played so far. Nothing is saved if the page reloads.</Small>
          </HelpPanel>
        )}

        <div className="mb-6 text-[14px] serif-text" style={{ color: C.brass, fontStyle: "italic", fontSize: "1.05rem" }}>{legalMode !== "solo" ? `${reader.name} is reading. ` : ""}{instruction}</div>

        <div className="serif nums leading-none mb-3" style={{ fontSize: "4.5rem", fontWeight: 300, color: C.brassDim, letterSpacing: "-0.03em" }}>{idx + 1}</div>
        <div className="serif-text leading-[1.25] mb-10" style={{ fontSize: "clamp(1.55rem, 5.6vw, 2.05rem)", fontWeight: 400, minHeight: "5rem", letterSpacing: "-0.005em" }}>{cur.q}</div>

        {legalMode === "buzzer" && buzzerTimer > 0 && !revealed && (
          <div className="mb-5">
            {clock === null ? <Btn tone="ghost" small onClick={() => setClock(buzzerTimer)}>Start {buzzerTimer}s clock</Btn>
              : clock > 0 ? <div className="serif nums leading-none" style={{ fontSize: "3.5rem", fontWeight: 300, color: C.brass }}>{clock}</div>
              : <div className="font-medium" style={{ color: C.ember }}>Time. Reveal and mark "no one" if nobody had it.</div>}
          </div>
        )}

        {!revealed ? (
          <Btn full onClick={() => setRevealed(true)}>Reveal answer</Btn>
        ) : (
          <>
            <div className="pl-4 py-1 mb-5 reveal" style={{ borderLeft: `2px solid ${C.brass}` }}>
              <div className="flex items-baseline justify-between gap-3 text-[12.5px]" style={{ color: C.paperDim }}>
                <span>Answer</span>
                {cur.verified !== null && cur.verified !== undefined && <span className="truncate max-w-[60%]" style={{ color: cur.verified ? C.paperDim : C.brass }}>{cur.verified ? `checked: ${cur.source}` : "not confirmed by a search; trust with care"}</span>}
              </div>
              <div className="serif-text mt-1" style={{ fontSize: "1.7rem", fontWeight: 500, color: C.brass, lineHeight: 1.15 }}>{cur.a}</div>
              {cur.alt?.length > 0 && <div className="text-[13.5px] mt-2" style={{ color: C.paperDim }}>Also fine: {cur.alt.join(", ")}</div>}
            </div>

            <div className="mb-7">
              <button onClick={() => setFlagOpen(o => !o)} className="text-[12.5px] underline underline-offset-4 decoration-1" style={{ color: flagged.length ? C.brass : C.paperDim, textDecorationColor: C.paperFaint }}>
                {flagged.length ? `Flagged: ${flagged.join(", ")}` : "Bad question? Flag it"}
              </button>
              {flagOpen && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {BAD_REASONS.map(r => <Chip key={r} small active={flagged.includes(r)} onClick={() => toggleFlag(idx, r)}>{r}</Chip>)}
                </div>
              )}
              {flagOpen && <Small className="mt-2">Flagging records it in the dev log; it doesn't change the score. Use "void" in the help panel for that.</Small>}
            </div>

            {legalMode === "solo" && (
              <div className="grid grid-cols-2 gap-2">
                <Btn tone="brass" onClick={() => finish(0, false)}>Got it</Btn>
                <Btn tone="ghost" onClick={() => finish(null, false)}>Missed it</Btn>
              </div>
            )}
            {legalMode === "turns" && !stealPrompt && (
              <div className="grid grid-cols-2 gap-2">
                <Btn tone="brass" onClick={() => finish(cur.answerer, false)}>{named[cur.answerer].name} got it</Btn>
                <Btn tone="ghost" onClick={onWrongInTurns}>Wrong</Btn>
              </div>
            )}
            {legalMode === "turns" && stealPrompt && (
              <>
                <div className="text-[13.5px] mb-2" style={{ color: C.paperDim }}>Did anyone steal it? (worth {fmt(stealValue)})</div>
                <div className="flex flex-col gap-2">
                  {named.map((p, i) => i !== cur.reader && i !== cur.answerer && <Btn key={i} full onClick={() => finish(i, true)}>{p.name}</Btn>)}
                  <Btn tone="ghost" full onClick={() => finish(null, false)}>No one</Btn>
                </div>
              </>
            )}
            {legalMode === "buzzer" && (
              <>
                <div className="text-[13.5px] mb-2" style={{ color: C.paperDim }}>Who got it first?</div>
                <div className="flex flex-col gap-2">
                  {elig.map(i => <Btn key={i} full onClick={() => finish(i, false)}>{named[i].name}</Btn>)}
                  <Btn tone="ghost" full onClick={() => finish(null, false)}>No one</Btn>
                </div>
              </>
            )}
          </>
        )}

        <div className="mt-12 flex flex-wrap gap-x-5 gap-y-1 text-[13px]" style={{ color: C.paperDim }}>
          {named.map((p, i) => <span key={i}>{p.name} <span className="serif-text nums" style={{ color: C.paper, fontSize: "1rem" }}>{fmt(scores[i])}</span></span>)}
          {gameTarget !== null && <span className="ml-auto">Target {gameTarget}</span>}
        </div>
      </>
    );
  }

  // ----- done -----
  if (phase === "done") {
    const teamTotal = scores.reduce((a, b) => a + b, 0);
    const top = Math.max(...scores);
    const winners = named.filter((_, i) => scores[i] === top);
    const played = plays.filter(p => !p.void).length;
    const voided = plays.filter(p => p.void).length;
    const unasked = schedule.length - plays.length;
    const tail = endedBy === "table" ? ` Ended by the table with ${unasked} unasked.` : unasked > 0 ? ` ${unasked} unasked.` : "";
    let headline, sub, highlight = true;
    if (legalWin === "count") {
      headline = N === 1 ? `${fmt(scores[0])} of ${played}` : "Final Tally"; highlight = false;
      sub = N === 1
        ? (played === 0 ? "Nothing played." : scores[0] === played ? "Every one. Pick a harder level next time." : scores[0] >= played * 0.7 ? "A good round." : scores[0] >= played * 0.4 ? "Middling, honestly." : "Rough. The topic may have been the problem, or the difficulty.") + tail
        : `${fmt(teamTotal)} correct between you out of ${played}. No winner declared; argue about it yourselves.${tail}`;
    } else if (legalWin === "target") {
      const hit = scores[0] >= gameTarget; highlight = false;
      headline = hit ? "Target Hit" : "Short of It";
      sub = `${fmt(scores[0])} of ${played}, target was ${gameTarget}.${tail}`;
    } else if (legalWin === "coop") {
      const hit = teamTotal >= gameTarget; highlight = false;
      headline = hit ? "The Table Wins" : "The Quiz Wins";
      sub = `${fmt(teamTotal)} between you${endedBy === "coop" ? `, with ${unasked} questions to spare` : ` of a possible ${played}`}. Target was ${gameTarget}.${endedBy === "table" ? tail : ""}`;
    } else if (legalWin === "race") {
      if (raceWinner !== null) { headline = `${named[raceWinner].name} Takes It`; sub = `First to ${gameTarget}, with ${unasked} questions unasked.`; }
      else { headline = "No One Got There"; highlight = false; sub = `Target was ${gameTarget}; the highest was ${fmt(top)} (${winners.map(w => w.name).join(", ")}). No winner under race rules.${tail}`; }
    } else {
      headline = winners.length > 1 ? "A Draw" : `${winners[0].name} Wins`;
      sub = (winners.length > 1 ? `${winners.map(w => w.name).join(" and ")} on ${fmt(top)}.` : `${fmt(top)} points.`) + tail;
    }
    const order = named.map((p, i) => ({ ...p, i })).sort((a, b) => scores[b.i] - scores[a.i]);
    const readCount = named.map((_, i) => plays.filter(e => !e.void && schedule[e.i].reader === i).length);
    const evenSplit = endedBy === "questions" && voided === 0;

    return shell(
      <>
        <H sub={sub}>{headline}</H>
        <div className="flex flex-col">
          {order.map(p => (
            <div key={p.i} className="grid grid-cols-[4rem_1fr_auto] gap-x-3 items-baseline py-4" style={{ borderBottom: `1px solid ${C.line}` }}>
              <span className="serif nums leading-none" style={{ fontSize: "2.6rem", fontWeight: 300, color: highlight && scores[p.i] === top ? C.brass : C.paper, letterSpacing: "-0.02em" }}>{fmt(scores[p.i])}</span>
              <div className="min-w-0">
                <div className="font-medium text-[15px]">{p.name}</div>
                <Small>{faced[p.i]} {legalMode === "buzzer" ? "raced" : "asked"}{legalMode !== "solo" ? `, read ${readCount[p.i]}` : ""}</Small>
              </div>
              <span className="text-[13px] truncate max-w-[9rem]" style={{ color: C.paperDim }}>{p.topic}</span>
            </div>
          ))}
        </div>
        {legalMode !== "solo" && (
          <Small className="mt-4">
            {evenSplit ? "Everyone read and was asked the same number of questions, so raw points compare fairly."
              : voided && endedBy === "questions" ? `${voided} question${voided === 1 ? "" : "s"} voided, so the split is slightly uneven.`
              : "Ended early, so reading and answering weren't split evenly."}
          </Small>
        )}
        {Object.keys(flags).length > 0 && <Small className="mt-2" tone={C.brass}>{Object.keys(flags).length} question{Object.keys(flags).length === 1 ? "" : "s"} flagged as bad; they're in the dev log.</Small>}

        <LogToggle />
        <ExportBar />
        <div className="flex flex-wrap gap-2 mt-10">
          <Btn tone="brass" onClick={() => generate({ force: true })}>Same setup, new questions</Btn>
          <Btn tone="ghost" onClick={undo} disabled={!history.length}>Undo last marking</Btn>
          <Btn tone="ghost" onClick={() => { setSetupStep(1); setPhase("setup"); }}>Change setup</Btn>
        </div>
        <Small className="mt-4">Replaying the same questions isn't available yet; "new questions" writes a fresh set. Copy the questions above if you want to keep this one.</Small>
      </>
    );
  }

  return null;
}
