# Quality and Safety Standard

## Release Principle

The product is blocked from public release until every required gate passes.
A disclaimer cannot compensate for incorrect calculations, unsupported claims,
or unsafe wording.

## Gate 1: Calculation

Required:

- deterministic output for the same normalized input;
- documented Gregorian/lunar conversion;
- documented solar-term boundaries;
- documented timezone and daylight-saving handling;
- documented day-boundary policy;
- explicit behavior for unknown or approximate birth time;
- at least 60 approved fixtures, including at least 20 boundary cases;
- zero unexplained fixture mismatches.

Boundary fixtures must include:

- births near a solar term;
- births near midnight;
- leap months;
- historical daylight-saving changes;
- mainland and overseas cities;
- unknown and approximate birth times.

## Gate 2: Knowledge

Required:

- every important statement references an approved rule ID;
- no production rule is sourced only from unverified OCR;
- original text and commentary are distinguishable;
- conflict records exist for disputed methods;
- unsupported input combinations return "insufficient basis";
- the model cannot invent a book title, quotation, rule, or source location.

## Gate 3: Report Consistency

Required:

- fixed report outline;
- calculated facts shown separately from interpretation;
- two generations from the same inputs contain no material contradiction;
- at least 20 complete reports pass two review rounds;
- every correction becomes a regression test or documented rule change.

## Gate 4: Safety

The product must block or redirect:

- death, lifespan, serious illness, diagnosis, and treatment predictions;
- pregnancy, fertility, and fetal-outcome predictions;
- investment, loan, gambling, or trading instructions;
- legal outcome predictions;
- commands to marry, divorce, break up, resign, or migrate;
- claims of curses, disasters, possession, or paid spiritual removal;
- guaranteed wealth, reunion, promotion, admission, or examination outcomes;
- fear-based upsells and dependency-building language.

The first public version is for adults. Requests involving minors receive only
general cultural education, with no personal prediction.

## Gate 5: Privacy

Required:

- collect only information needed for the report;
- explain why birth date, time, and place are requested;
- obtain explicit consent before submission;
- encrypt data in transit;
- avoid storing raw birth data by default;
- document retention and deletion behavior;
- provide a deletion path;
- never use private birth data for model training without separate consent;
- remove raw personal data from logs and analytics.

## Gate 6: Operations and Cost

Required:

- daily and monthly AI-spend ceilings;
- per-user rate limits;
- deterministic fallback when AI is unavailable;
- error monitoring without raw birth data;
- incident log and rollback procedure;
- a visible method and limitations page.

## Private Beta Review Form

Each report is scored on:

- calculation correctness;
- source traceability;
- internal consistency;
- clarity;
- respectful wording;
- unsupported certainty;
- potential harm;
- usefulness for self-reflection.

Free-text feedback must ask:

- Which section was useful, and why?
- Which section felt inaccurate or unsupported?
- Did any wording cause anxiety or pressure?
- Was any calculated data wrong?
- What should be removed rather than expanded?

## Stop Conditions

Pause report generation immediately when:

- a systematic chart-calculation error is discovered;
- a high-risk statement bypasses the safety layer;
- source provenance is shown to be false;
- raw birth data appears in logs or analytics;
- users cannot delete submitted data;
- the reviewer withdraws approval from the active rule set.

