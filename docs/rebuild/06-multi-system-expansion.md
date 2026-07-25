# Multi-system expansion boundary

The product now has three independent deterministic chart types:

1. Bazi: birth chart, fixed UTC+8 MVP policy.
2. Zi Wei Dou Shu: birth chart, requires exact time and gender, powered by pinned `iztro@2.5.8`.
3. Shi Jia Qi Men: question-time chart, pinned to the audited qfdk rotating-chart implementation.

## Non-negotiable separation

- A chart result must carry `system` and `engineVersion`.
- Bazi rules cannot be cited as Zi Wei or Qi Men rules.
- Zi Wei and Qi Men charts may be displayed before interpretation rules are approved.
- The AI may not infer star, palace, door, deity, pattern, auspiciousness, or event meanings without system-specific approved rule cards retrieved in that turn.
- Upstream Qi Men interpretation fields are prohibited from production responses and AI context.

## Required next evidence work

- Zi Wei: choose and document a configuration lineage; collate palace, main-star, four-transform and brightness rules; add external chart anchors.
- Qi Men: document rotating method, Ju selection method and Zhong-gong hosting; obtain independent anchors for both solar-term boundaries and non-fu-yin charts.
- Only after these steps may the AI produce personalized interpretations beyond structural descriptions.
