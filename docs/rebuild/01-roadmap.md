# Rebuild Roadmap

## Phase 0: Audit and Freeze

Goal: prevent the existing prototype from being mistaken for a professional
Bazi product.

Deliverables:

- current-system audit;
- rebuild charter;
- explicit list of legacy features that cannot enter the new report;
- public-release warning in the project README.

Exit condition:

- legacy behavior remains preserved for reference but is not used as evidence.

## Phase 1: Source Library

Goal: establish a lawful, versioned, reviewable source base.

Deliverables:

- required-source catalog;
- version, provenance, and copyright record for every source;
- public-domain transcription workflow;
- glossary of core terms;
- disagreement log for conflicting schools and annotations.

Exit conditions:

- all Priority 0 sources have a verified lawful source or a documented blocker;
- original text is separated from later commentary;
- no pirated or provenance-unknown file is admitted.

## Phase 2: Knowledge Rules

Goal: convert sources into testable, bounded rule cards.

Deliverables:

- rule-card schema;
- approved terminology;
- prerequisite and exclusion conditions;
- source citations;
- counterexamples and conflict records;
- reviewer status for every production rule.

Exit conditions:

- the first report uses only reviewed rules;
- every conclusion can be traced to its inputs and source;
- unsupported combinations fall back to "insufficient basis".

## Phase 3: Calendar and Chart Engine

Goal: calculate chart data without relying on an LLM.

Deliverables:

- civil-time and timezone normalization;
- solar/lunar input handling;
- solar-term boundaries;
- Four Pillars calculation;
- documented day-boundary and true-solar-time policy;
- fixture suite covering mainland and overseas births.

Exit conditions:

- no unexplained mismatch against approved reference fixtures;
- boundary behavior is visible to users;
- uncertain birth time produces an uncertainty warning instead of fake precision.

## Phase 4: Report Engine

Goal: generate a short, explainable, safe Chinese report.

Deliverables:

- fixed report outline;
- calculated/source/generated/reflection labels;
- grounded generation prompt;
- citation and rule trace;
- deterministic fallback when AI generation fails;
- cost limits and rate limits.

Exit conditions:

- twenty reports pass two manual review rounds;
- no report contains a rule not present in the approved rule set;
- repeated generation does not materially contradict itself.

## Phase 5: Private Beta

Goal: test usefulness and harm with a small consented group.

Deliverables:

- consent notice;
- feedback form;
- correction process;
- deletion process;
- issue register and weekly quality review.

Exit conditions:

- at least 30 adult testers;
- all reported calculation errors are resolved or documented;
- no unresolved high-severity safety incident;
- reviewer approves progression to public beta.

## Phase 6: Public Free Beta

Goal: provide a bounded free service without compromising privacy or quality.

Deliverables:

- Chinese web experience;
- daily and monthly cost ceilings;
- operational monitoring;
- safety incident response;
- public methodology and limitations page.

Later monetization is a separate decision and cannot weaken the free product's
evidence, privacy, or safety standards.

## Inputs Needed from the Project Owner

Nothing is required to begin Phases 0 and 1.

Before Phase 2:

- identify one Bazi reviewer, or approve a search and reviewer budget.

Before Phase 5:

- recruit adult testers who explicitly consent to use of their birth data;
- decide whether anonymized feedback may be retained.

Before Phase 6:

- approve hosting, AI API, and monthly cost limits;
- confirm the public product name.

