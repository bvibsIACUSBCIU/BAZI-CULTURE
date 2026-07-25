# Third-party calculation engines

## iztro

- Package: `iztro@2.5.8`
- Purpose: deterministic Zi Wei Dou Shu birth-chart structure
- License: MIT
- Project: https://github.com/SylarLong/iztro
- Product boundary: the application currently exposes chart structure only. School-specific interpretation and predictive claims are not inherited from the dependency.

## qfdk/qimen

- Package alias: `qimen-engine`
- Pinned commit: `8a9734a3fcaa01adc8bffc7c4b983c00ad932868`
- Purpose: deterministic Shi Jia Qi Men rotating-chart structure
- License file: MIT
- Project: https://github.com/qfdk/qimen
- Product boundary: only `siZhu`, `juShu`, heaven/earth stems, stars, doors, deities, hidden stems, void and horse positions are sanitized into the API response. Upstream `analysis`, `geju`, and `jiuGongAnalysis` outputs are explicitly discarded and must not enter AI context.

The two systems remain separate from the Bazi engine. Their terminology and rules must not be silently merged.
