# Bazi Culture MVP Charter

Status: Approved direction, pre-development

## Mission

Build a free Chinese-language Bazi culture interpretation tool for self-reflection.
The product must explain its sources, separate deterministic chart data from
traditional interpretation, and avoid presenting generated text as verified
fact or fixed fate.

## Initial Audience

- Chinese mainland users
- Overseas Chinese users
- Adults only for the first public version

The first version is Chinese-only. English and Khmer are outside the initial
scope because they add translation and cultural-review risk without improving
the core quality.

## Initial Product

The first public product is a fixed-format foundational Bazi report:

1. Collect minimum birth information with explicit consent.
2. Calculate the Four Pillars with a deterministic calendar engine.
3. Display the calculation assumptions and chart data.
4. Explain a limited set of reviewed concepts in plain Chinese.
5. Offer self-reflection questions instead of life decisions.
6. Collect correction and usefulness feedback.
7. Allow the user to delete submitted personal data.

## Non-Goals

- No open-ended fortune-telling chat in the first version.
- No payment, referral unlock, crystal sales, or fear-based upsell.
- No medical, legal, investment, gambling, fertility, death, or disaster prediction.
- No guarantee of accuracy, wealth, marriage, reunion, or changed fate.
- No mixing Bazi, numerology, MBTI, tarot, astrology, and crystal symbolism.
- No public launch before the quality gates are passed.

## Evidence Model

Every user-facing statement belongs to one of four classes:

1. `CALCULATED`: deterministic chart data produced by tested code.
2. `SOURCED`: a traditional interpretation tied to an approved rule card.
3. `GENERATED`: AI-written wording grounded in calculated data and rule cards.
4. `REFLECTION`: a question or suggestion that asks the user to compare the
   interpretation with lived experience.

The interface and report must not blur these classes.

## Definition of Success

The free beta succeeds when:

- chart calculations pass the documented fixture suite;
- every important interpretation can be traced to a reviewed rule;
- no high-risk statement escapes the safety checks;
- users can understand the report without treating it as a command;
- feedback identifies specific useful and inaccurate sections;
- operating cost remains within a fixed monthly cap.

Popularity, virality, and revenue are not Phase 1 success criteria.

## Roles

Codex owns:

- project planning and documentation;
- legal-source cataloging;
- knowledge schema and extraction workflow;
- software implementation and tests;
- safety controls and quality reports;
- recording decisions and unresolved conflicts.

The project owner provides only when requested:

- final product name and branding decisions;
- access to lawfully acquired copyrighted references, if required;
- an adult Bazi reviewer or permission to recruit a paid reviewer;
- consented test users and their feedback;
- deployment accounts and budget approval.

## Release Authority

No code path is considered public-release ready merely because it runs.
Release requires the checklist in `04-quality-and-safety-standard.md`.
