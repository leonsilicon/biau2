# biau2

Taiwan Ministry of Education word frequency table (詞頻總表, file `BIAU2.TXT`) as JSON.

Source: the official `BIAU2.TXT` published by the ROC Ministry of Education — 64,327 distinct words covering 530,452 total occurrences in the sample corpus (the source header rounds these to 64,326 / 530,452).

## Install

```bash
npm install @leonsilicon/biau2
```

## Usage

```js
import biau2 from "@leonsilicon/biau2";

biau2.metadata;
// { source: "BIAU2.TXT", title: "詞頻總表", totalWords: 64327, totalFrequency: 530452 }

biau2.headers;
// ["rank", "word", "frequency", "cumulativeFrequency", "cumulativePercent"]

biau2.data[0];
// [1, "我們", 2613, 2613, 0.492599]
```

The raw JSON is also reachable directly:

```js
import data from "@leonsilicon/biau2/biau2.json" with { type: "json" };
```

## Data shape

Each row in `data` is an array matching `headers`:

| index | field                 | type     | notes                                             |
| ----- | --------------------- | -------- | ------------------------------------------------- |
| 0     | `rank`                | `number` | rank as recorded in the source (1-based)          |
| 1     | `word`                | `string` |                                                   |
| 2     | `frequency`           | `number` | occurrences in the sample                         |
| 3     | `cumulativeFrequency` | `number` | running sum of `frequency`                        |
| 4     | `cumulativePercent`   | `number` | running cumulative coverage, as a percent (0–100) |

Characters in the Big5 HKSCS extension range (`0xFA`–`0xFE`) are decoded via the WHATWG Big5 index table (`data/index-big5.txt`); some of them are CJK Extension B+ codepoints above U+FFFF (e.g. 𡭄, 𦲁).

## Regenerating the JSON

```bash
bun scripts/parse.ts
```

Reads `data/BIAU2.TXT` (using `data/index-big5.txt` for Big5 decoding) and writes `biau2.json` at the repo root.

## License

MIT
