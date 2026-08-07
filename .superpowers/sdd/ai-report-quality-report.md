# AI Report Quality Implementation Report

## Outcome

- The final report writer now receives the user's question plus the complete sanitized Bazi, Ziwei, and Qimen calculation payload.
- The provider writes substantive Markdown directly. The server validates readable provenance markers and calculated identifiers instead of forcing the model to return fact-selection JSON.
- User-facing evidence markers use names such as `〔依据：八字·日主；紫微·命宫·紫微〕`; internal fact IDs are rejected from AI Markdown.
- The default provider timeout is now 20 seconds, configurable through `AI_TIMEOUT_MS` and clamped to 5-60 seconds. Output capacity is 6000 tokens.
- Planning, grouping, summary extraction, and recommendations are local deterministic stages, reserving the single online request for the final professional report.
- Provider/validation failure returns a short, honest, chart-bound summary and exposes `service.degraded` through JSON and SSE. The UI keeps the degradation notice visible through completion.

## Safety

- The prompt only receives allowlisted, recursively sanitized chart structures.
- Markdown validation rejects unknown evidence labels, raw internal IDs, unsupported annual claims, mismatched day-master identifiers, unsupported Ziwei star/palace/four-transformation claims, and mismatched Qimen duty star/door claims.
- The existing dynamic six-part `userReport` remains calculated from the actual chart; no fixed static report was introduced.

## Verification

- `node --test test/ai-report-quality.test.mjs test/report-evidence-payload.test.mjs`: 31/31 passed.
- `npm test`: 144/144 passed.
- `node --env-file=.env scripts/test-simulation.mjs`: passed. Confirmed pillars `丙子 / 丙申 / 丁亥 / 乙巳`, day master `丁火`, 10,110 Chinese characters in the dynamic six-part report, and a 233-character honest degraded Markdown response under the intentional mock-provider failure.
- `node --check` passed for all changed JavaScript modules.
- `git diff --check`: passed.
