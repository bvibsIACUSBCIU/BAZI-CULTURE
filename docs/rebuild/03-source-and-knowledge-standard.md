# Source and Knowledge Standard

## Required Source Baseline

Priority 0 sources are required before production rule extraction.

| Priority | Work | Intended Use | Initial Status |
| --- | --- | --- | --- |
| P0 | `渊海子平` | terminology, Ten Gods, early Zi Ping framework | exact page rejected because no base source is recorded |
| P0 | `三命通会` | broad reference and comparison | complete Siku Quanshu 12-volume candidate admitted for collation |
| P0 | `子平真诠` | month-command and structure framework | CText community text found but rejected because base edition is missing |
| P0 | `滴天髓` | element momentum and structural reasoning | `滴天髓辑要` recension identified; base scan still required |
| P0 | `穷通宝鉴` | seasonal and climate-balancing reference | lawful version not yet verified |
| P0 | `神峰通考` | comparison, disease-and-medicine style reasoning | readable page rejected because no base source is recorded |
| P1 | `命理约言` | concise system comparison | lawful version not yet verified |
| P1 | `命理探原` | modern systematic reference | copyright and version review required |
| P1 | `千里命稿` | modern introductory organization | CText lead found; date, base edition, and rights remain unresolved |
| P1 | `子平真诠评注` | commentary comparison | CText lead found; base edition missing and layers not separated |
| P1 | `滴天髓阐微` | commentary comparison | Wikisource lead found; no base scan recorded |

This list is a baseline, not permission to combine all opinions. Additional
sources require an explicit reason and provenance review.

The machine-readable acquisition record is
`knowledge/sources/source-manifest.csv`. Detailed evidence and rejection
reasons are recorded in
`knowledge/sources/research-log-2026-07-18.md`.

## Technical Authorities

Chart calculation must use technical authorities independent of divination
texts:

- current Chinese calendar computation standard and official status;
- IANA Time Zone Database;
- documented solar-term calculation;
- an approved geolocation source;
- a versioned policy for civil time, daylight saving, true solar time, and day
  boundaries.

The exact standard versions must be verified before implementation. A web page,
blog post, or another fortune-telling calculator is not automatically an
authority.

## Lawful Acquisition Rules

Accepted:

- public-domain original text from a traceable library or archive;
- public-domain scan with catalog metadata;
- legally purchased or borrowed edition used for human study;
- licensed digital text;
- original project notes and independently written explanations.

Rejected:

- pirated ebooks;
- removed-DRM files;
- anonymous cloud-drive bundles;
- OCR text with no identifiable source image;
- copied modern annotations without permission.

An ancient work may be public domain while a modern edition's punctuation,
translation, commentary, typography, or database remains protected.

## Source Manifest Fields

Every acquired source must record:

```text
source_id
title
attributed_author_or_editor
edition_or_scan
publication_date
holding_institution_or_publisher
source_url_or_purchase_record
access_date
copyright_status
allowed_uses
original_text_or_commentary
ocr_status
collation_status
review_notes
```

## Rule Card Schema

Every production rule must record:

```text
rule_id
status: draft | collated | reviewed | approved | retired
school_or_method
concept
plain_language_claim
required_calculated_inputs
prerequisites
exclusions
source_id
source_location
source_excerpt
project_explanation
competing_rules
known_counterexamples
allowed_user_facing_inference
forbidden_inference
confidence
reviewer
review_date
change_history
```

## Conflict Policy

- Original text and commentary are separate evidence.
- A later commentator cannot silently redefine the original source.
- Conflicting rules remain visible in a disagreement register.
- The report engine cannot choose whichever rule produces the most dramatic
  conclusion.
- If the approved method cannot resolve a conflict, the report states that the
  basis is insufficient.

## Extraction Workflow

1. Verify the source and legal status.
2. Collate OCR against the source image.
3. Segment the relevant passage.
4. Write a literal explanation before interpretation.
5. Identify prerequisites and exclusions.
6. Search for competing passages and counterexamples.
7. Submit the rule card for human review.
8. Add only approved rules to the production set.
9. Attach tests that prove the rule is selected only under its prerequisites.
