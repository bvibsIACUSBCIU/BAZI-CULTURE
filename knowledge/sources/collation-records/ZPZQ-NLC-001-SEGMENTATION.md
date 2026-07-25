# Segmentation Record: ZPZQ-NLC-001

Date: 2026-07-18

## Source

- Manifest ID: `SRC-ZPZQ-NLC-001`
- Local file:
  `/Users/vic/Downloads/NLC416-11jh010455-35296_子平真詮.pdf`
- SHA-256:
  `71402a780b0351b54edf121a51bc4a4a4ce5896496c35b954563ee06f1a6f620`
- Total PDF pages: 287
- Format: image-only PDF

## Finding

This PDF is a publisher's combined volume, not a clean single-work scan.
It contains a common title leaf, `子平真詮`, `中華民國偉人星命錄`, and
`新增萬年書`.

## Segment Map

| PDF pages | Visible contents | Classification |
| --- | --- | --- |
| 1 | combined publisher title leaf naming all three works | shared front matter; not part of the original `子平真詮` body |
| 2-121 | `子平真詮` preface, contents, and body | `子平真詮` segment |
| 122-158 | `中華民國偉人星命錄` title and body | later appendix; exclude from `子平真詮` |
| 159-286 | `新增萬年書` title, body, calendar tables, and colophon | later appendix; exclude from `子平真詮` |
| 287 | library scan tail marker | scan artifact; exclude |

PDF page numbers are one-based and refer to the complete 287-page file.

## Boundary Evidence

### Start and common title

- PDF page 1 names `秘本子平真詮`, `新增偉人星命錄`, and
  `民國萬年曆` on one publisher title leaf.
- PDF page 2 begins the `子平真詮序`, with visible internal page number 1.

Result: PDF page 1 is shared publisher front matter. The work-specific
`子平真詮` segment begins at PDF page 2.

### End of 子平真詮

- PDF page 121 still carries the running title `子平真詮`.
- Its visible internal page number is 112.
- PDF page 122 is a new title leaf reading `中華民國偉人星命錄`,
  `乙丑仲秋新增`, and `山陰器環子著`.

Result: the `子平真詮` segment ends at PDF page 121. The next work begins at
PDF page 122.

### End of 中華民國偉人星命錄

- PDF page 158 carries the running title `偉人星命錄`.
- Its visible internal page number is 36.
- PDF page 159 is a new title leaf reading `新增萬年書`,
  `乙丑仲秋`, and `山陰隨西山人校正`.
- PDF page 160 begins the `新增萬年書` body with visible internal page
  number 1.

Result: the `中華民國偉人星命錄` segment ends at PDF page 158. The
`新增萬年書` segment begins at PDF page 159.

### End of 新增萬年書

- PDF pages 280-285 contain the final calendar tables.
- PDF page 286 is the publication and copyright colophon.
- PDF page 287 contains only a small library scan tail marker.

Result: the meaningful `新增萬年書` segment ends at PDF page 286. PDF page
287 is not book content.

## Admission Decision

The scan is admitted only as a segmented visual witness for `子平真詮`,
covering PDF pages 2-121.

It is not yet approved for production rule extraction because:

- an independent second scan witness has not been identified;
- the item-level Wikimedia Commons license still needs live verification;
- the scan has no reliable embedded text, so every selected passage will
  require manual transcription and visual collation;
- the exact textual relationship between this `秘本` printing and other
  recensions has not been established.

The two appended works and the scan tail must never be cited as
`子平真詮`.

## Next Required Check

Find an independently cataloged `子平真詮` scan. Compare, at minimum:

1. title and edition statements;
2. preface and contents structure;
3. the first body page;
4. one passage from the middle of the work;
5. the final body page;
6. any additions, omissions, reordered chapters, or commentary layers.

Only passages that survive this comparison may advance to rule-card drafting.
