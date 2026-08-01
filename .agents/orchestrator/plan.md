# Orchestrator Execution Plan

## Objective
Fully recreate the tianfu-ai Multi-Agent Metaphysics Workspace according to R1, R2, R3 specifications and mandatory project rules.

## Strategy: Iteration Loop Per Milestone
For each milestone (M1 -> M2 -> M3):
1. **Explorer Investigation**: Dispatch `teamwork_preview_explorer` subagent to analyze existing files, identify missing UI components or backend API gaps, and produce an execution strategy.
2. **Worker Implementation**: Dispatch `teamwork_preview_worker` subagent to implement code, run tests, and report changes.
3. **Reviewer Evaluation**: Dispatch `teamwork_preview_reviewer` to review correctness, usability, layout compliance, and requirement matching.
4. **Challenger Verification**: Dispatch `teamwork_preview_challenger` to run stress tests / validation scripts.
5. **Forensic Integrity Audit**: Dispatch `teamwork_preview_auditor` to check for non-static dynamic generation, anti-cheating compliance, and code authenticity.
6. **Gate Evaluation**: If all checks pass and audit is CLEAN, mark milestone DONE. If any fails or audit flags violation, iterate with Explorer fix report.

## Schedule & Milestones
- **Milestone 1 (R1)**: Multi-Profile & Session Management.
- **Milestone 2 (R2)**: Split Workspace & Synchronized Panes.
- **Milestone 3 (R3)**: Backend Engines, Multi-Agent Pipeline, IP Anti-Abuse + Web3 Wallet Quotas, E2E Test Suite verification (`npm test` & `node --env-file=.env scripts/test-simulation.mjs`).
