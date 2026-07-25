# Research MVP Scope

Date: 2026-07-18

## Decision

The project owner approved building a minimum research MVP from the currently
available books without waiting for the complete source baseline.

This decision does not lower the public-release quality gates. It changes only
what may be tested internally.

## Supported Input

- adults only;
- Gregorian birth date from 1900 through 2099;
- optional civil birth time;
- `Asia/Shanghai` (`UTC+8`) only.

Birthplace, name, gender, phone number, and account profile are not collected.

## Calculation Policy

- `lunar-javascript@1.7.7` is the pinned deterministic calendar engine;
- AI never calculates or repairs a pillar;
- 23:00-00:59 is blocked until the day-boundary method is reviewed;
- unknown time produces no hour pillar;
- the five-element display counts surface stems and principal branch elements;
- hidden stems, weights, strength, structure, useful gods, luck cycles, and
  annual predictions are outside this MVP.

## Knowledge Policy

The current books may be used for research, indexing, and preparing rule cards.
They do not automatically authorize a user-facing interpretation.

The MVP may display:

- calculated chart data;
- calculation assumptions;
- source status and limitations;
- neutral feedback questions.

It must not display a personalized traditional inference until the underlying
rule card is collated and human-reviewed.

## Interfaces

- web form backed by `POST /api/report`;
- Telegram guided flow and stateless `/bazi` command;
- fixed report text generated without an LLM.

Legacy personality, crystal, referral, wealth-profile, simulated element, and
open-chat routes are removed or retired.

## Privacy

- explicit consent is required before calculation;
- raw birth data is not written to a database by the MVP;
- API responses use `Cache-Control: no-store`;
- Telegram `/delete` clears the current in-memory session;
- application logs must not include request bodies or raw birth data.

## Release Status

Internal research only.

The MVP is not approved for public launch until the full quality and safety
standard passes, including the fixture suite, source review, privacy review,
rate limiting, monitoring, and rollback procedure.
