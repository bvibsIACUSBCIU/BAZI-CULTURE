# Current System Audit

Audit date: 2026-07-18

## Decision

The retired `ai-lucky-bot` was a useful interaction prototype, but it is not a
valid foundation for professional Bazi interpretation. It must not be publicly
described as an accurate Bazi system in its current form.

## Blocking Findings

### No verified Four Pillars engine

The current report logic uses `birthdayNumber`, a simplified element tendency,
and user-selected focus fields. It does not implement a documented solar-term,
timezone, lunar-calendar, or Four Pillars calculation pipeline.

Impact:

- a user may believe a report is based on Bazi when it is not;
- overseas birth data cannot be interpreted reliably;
- cited classics do not actually control the generated result.

### Unrelated systems are mixed together

The current prototype combines:

- personality questions;
- birthday numerology;
- five-element labels;
- wealth profiles;
- crystal recommendations;
- metaphysics-classics references.

These elements do not form one coherent Bazi method. Combining them makes the
report difficult to audit and gives unsupported claims an appearance of
traditional authority.

### Source names are present without rule provenance

The knowledge base lists several classics, but individual output rules do not
record source passage, prerequisites, exclusions, school, or reviewer status.
Book titles alone are not evidence.

### Product scope conflicts with the approved direction

The existing product prioritizes:

- Chinese, English, and Khmer;
- referral unlocks;
- lucky crystals;
- wealth and love hooks;
- open-ended knowledge chat.

The approved rebuild prioritizes a Chinese-only, fixed-format, free
self-reflection report with quality and privacy controls.

## Reusable Parts

The following may be reused after review:

- Telegram transport and webhook plumbing;
- language-safe message utilities;
- test harness patterns;
- basic API deployment configuration;
- safety wording that clearly rejects guaranteed outcomes.

Reuse is not automatic. Each module must be admitted through a rebuild task.

## Frozen Legacy Parts

The following must not enter the new report engine:

- birthday-number conclusions;
- fabricated five-element scores;
- wealth profiles selected from current-status keywords;
- lucky number, color, or crystal claims;
- referral-gated results;
- unsupported "daily luck" generation;
- claims that current cards implement the cited classics.

## Immediate Rule

Until Phases 1 through 4 are complete, changes to the legacy prototype must not
add new divination claims or expand public distribution.
