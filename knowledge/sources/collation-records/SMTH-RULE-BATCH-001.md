# SMTH-RULE-BATCH-001

## Purpose

Passage-level collation record for the first production rule batch derived from
`SRC-SMTH-SKQS-001`, paired with scan witness
`SRC-SMTH-SCAN-ZJU-001`.

## Review date

2026-07-18

## Text witness

- Work: `三命通會（四庫全書本）`
- Provider: Wikisource
- Complete structure: 12 volumes
- Production use: passage-level extraction only

## Scan witness

- Provider: Internet Archive
- Contributor metadata: Zhejiang University Library
- Volume 1 identifier: `06056477.cn`
- Volume 5 identifier: `06056481.cn`
- Local temporary review copies:
  - `/private/tmp/pdfs/bazi-knowledge-review/06056477.cn.pdf`
  - `/private/tmp/pdfs/bazi-knowledge-review/06056481.cn.pdf`

The temporary scans are review artifacts and are not copied into the
repository.

## Visually checked passages

### Ten heavenly stems

- Text section: 卷一《論十干名字之義》
- Scan locator: `06056477.cn`, PDF pages 49-51
- Checked:
  - 甲乙木、丙丁火、戊己土、庚辛金、壬癸水;
  - 甲丙戊庚壬為陽;
  - 乙丁己辛癸為陰.
- Result: passed for terminology and deterministic mapping.
- Production rules: `BZ-BASIC-0001`.

### Five-element generation and control

- Text section: 卷一《論五行生尅》
- Scan locator: `06056477.cn`, PDF pages 41-42
- Checked:
  - the five control relations;
  - the statement that the sequence turns through generation and control.
- Result: passed for relation classification only.
- Production rules: `BZ-BASIC-0002`, `BZ-BASIC-0003`.
- Limitation: this passage does not justify treating generation as good or
  control as bad.

### Twelve earthly branches and month sequence

- Text section: 卷一《論十二支名字之義》
- Scan locator: `06056477.cn`, PDF pages 52-55
- Checked: traditional month ordering from 寅 through 丑.
- Result: passed for terminology.
- Production rule: `BZ-BASIC-0004`.
- Limitation: the passage is not a precise solar-term calculation algorithm.
  Month pillars must remain deterministic and use the project's technical
  calendar policy.

### Day-stem-relative categories

- Text section: 卷五《論古人立印食官財名義》
- Scan locator: `06056481.cn`, PDF pages 3-6
- Checked:
  - 日干 as the reference point;
  - 生我、我生、尅我、我尅;
  - 印綬、食神、官煞、妻財 names;
  - 甲日 examples for 正官/偏官 and 正財/偏財.
- Result: passed for deterministic ten-god classification.
- Production rules: `BZ-TENGOD-0001`, `BZ-TENGOD-0002`.
- Limitation: no personality, relationship, wealth, health, or event claim is
  admitted from a single ten-god label.

### Editorial limitation

- Text section: 四庫全書提要
- Previously checked in `SMTH-SKQS-001.md`.
- Checked: criticism of privileging only the "正" categories and instruction
  to understand the general meaning with adaptation.
- Result: passed as an editorial safety boundary.
- Production rule: `BZ-SAFETY-0001`.

## Operational export

The reviewed passages, seven rule cards, book catalog, and agent skill catalog
are deployed from:

`../bazi-knowledge-base/data/approved-knowledge-v1.json`

The production agent can retrieve only rule objects marked `approved`. It
cannot retrieve scan files, raw OCR, blocked books, provisional passages, or
the golden test corpus.

## Explicitly not approved in this batch

- hidden-stem table;
- branch combinations, clashes, punishments, harms, and breaks;
- strength/weakness;
- structure and useful-god selection;
- seasonal adjustment;
- luck-cycle direction and start age;
- annual predictions.

These remain implementation or acquisition tasks until equivalent evidence and
tests are complete.

