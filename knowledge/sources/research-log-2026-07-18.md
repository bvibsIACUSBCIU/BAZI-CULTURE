# Source Research Log: 2026-07-18

## Scope

This pass checked whether named works have a traceable edition or scan suitable
for rule extraction. Finding readable text was not treated as sufficient.

## Verified Technical Authorities

### Chinese calendar standard

Official record:

- Standard: `GB/T 33661-2017`
- Title: `农历的编算和颁行`
- Status on access date: current
- Published: 2017-05-12
- Effective: 2017-09-01
- Administrative and technical authority: Chinese Academy of Sciences
- Official record:
  `https://openstd.samr.gov.cn/bzgk/gb/newGbInfo?hcno=E107EA4DE9725EDF819F33C60A44B296`

Decision:

- approved as a requirements authority;
- standard text licensing and redistribution must still be reviewed;
- implementation must be tested rather than inferred from secondary blogs.

### Timezone database

Official IANA record:

- Latest version on access date: `2026c`
- Release date: 2026-07-08
- Official page: `https://www.iana.org/time-zones`

Decision:

- approved for version selection;
- implementation must pin the actual deployed tzdb version;
- historical timezone behavior must be covered by fixtures.

## Classical Source Findings

### 三命通会

Generic Wikisource page:

- contains only volumes 1 through 9;
- explicitly says volumes 10 through 12 are missing;
- rejected for production.

Siku Quanshu page:

- complete structure for all 12 volumes;
- explicitly instructs collation against the Siku Quanshu scan;
- marked `PD-old`;
- individual volume pages do not link to page images or a scan index;
- includes the Siku catalog note warning that transmitted copies may contain
  later inserted cases and that some positions in the work are limited.

Decision:

- a complete 12-volume scan set was subsequently found in the Internet Archive
  `universallibrary` collection;
- Internet Archive records Zhejiang University Library as contributor;
- identifiers `06056477.cn` through `06056488.cn` cover volumes 1 through 12;
- volume 1 contains 233 PDF pages;
- visual checks of the title pages, Siku catalog note, and a body passage
  matched the Wikisource text in the inspected samples;
- embedded OCR is unusable for authoritative collation.

Admission:

- `SRC-SMTH-SKQS-001` and `SRC-SMTH-SCAN-ZJU-001` are approved as a paired
  source for passage-level extraction;
- each quoted passage still requires individual visual verification;
- the scan is a witness only and is not approved for redistribution because
  the Internet Archive metadata does not provide an explicit license URL.

### 渊海子平

- exact Wikisource page exists;
- page category says `没有来源的作品`;
- no scan or library base is linked.

Decision:

- blocked for production;
- may be used only to identify chapter names for further catalog searches.

### 滴天髓

- page is specifically a `滴天髓辑要` recension;
- contains 42 transcluded sections;
- page notes a compilation associated with 陈之遴 and separately points to
  任铁樵's `滴天髓阐微`;
- no cataloged base scan was identified in this pass.

Decision:

- recension identified but source remains blocked.

### 神峰通考

- page is a single large text creation;
- contains editorial corrections inside the text;
- no source scan or cataloged base is recorded.

Decision:

- rejected for production until a cataloged scan is located.

### 子平真诠评注

Chinese Text Project result:

- community-edited representative text;
- attributed to 沈孝瞻, Qing period;
- base edition is explicitly marked `暂缺`;
- site requests attribution and prohibits automated bulk downloading.

Decision:

- bibliographic lead only;
- no ingestion or rule extraction.

### 千里命稿

Chinese Text Project result:

- community-edited representative text attributed to 韦千里;
- date and base edition are both marked `暂缺`;
- site requests attribution and prohibits automated bulk downloading.

Decision:

- bibliographic lead only;
- copyright and edition review required before any use beyond human reference.

## Not Located in This Pass

- `穷通宝鉴` and related recensions `栏江网` / `造化元钥`
- `命理约言`
- `命理探原`

## Source Quality Rule Confirmed

The project will prefer, in order:

1. scan-backed public-domain transcription from an identified library holding;
2. cataloged public-domain scan;
3. lawfully purchased or borrowed modern edition for human comparison;
4. community text only as a search lead.

Community text without a base edition cannot supply production rules.
