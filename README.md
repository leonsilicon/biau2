# biau2

Taiwan Ministry of Education word frequency table (詞頻總表, file `BIAU2.TXT`) as JSON.

Source: the official `BIAU2.TXT` published by the ROC Ministry of Education — 64,327 distinct words covering 530,452 total occurrences in the sample corpus (the source header rounds these to 64,326 / 530,452).

## Install

```bash
npm install biau2
```

## Usage

```js
import biau2 from "biau2";

biau2.metadata;
// { source: "BIAU2.TXT", title: "詞頻總表", totalWords: 64327, totalFrequency: 530452 }

biau2.headers;
// ["rank", "word", "frequency", "cumulativeFrequency", "cumulativePercent"]

biau2.data[0];
// [1, "我們", 2613, 2613, 0.492599]
```

The raw JSON is also reachable directly:

```js
import data from "biau2/biau2.json" with { type: "json" };
```

## Data shape

Each row in `data` is an array matching `headers`:

| index | field                 | type                                            | notes                                             |
| ----- | --------------------- | ----------------------------------------------- | ------------------------------------------------- |
| 0     | `rank`                | `number`                                        | rank as recorded in the source (1-based)          |
| 1     | `word`                | `string \| Array<string \| { eudc: hex }>`      | see EUDC note below                               |
| 2     | `frequency`           | `number`                                        | occurrences in the sample                         |
| 3     | `cumulativeFrequency` | `number`                                        | running sum of `frequency`                        |
| 4     | `cumulativePercent`   | `number`                                        | running cumulative coverage, as a percent (0–100) |

### EUDC characters

A handful of rare characters in the source file use Big5 user-defined ranges (lead byte `0xFA`–`0xFE`) that have no Unicode mapping. When a word contains one or more such characters, it is emitted as an array of segments — each segment is either a decoded `string` run or `{ eudc: "<hex>" }` (the original Big5 byte pair, lowercase hex) — so no data is silently dropped. 31 of the 64,327 rows contain at least one such segment.

## Regenerating the JSON

```bash
bun scripts/parse.ts
```

Reads `data/BIAU2.TXT` and writes `biau2.json` at the repo root.

## License

MIT
