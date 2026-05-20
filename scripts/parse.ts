/**
 * Parses data/BIAU2.TXT (Taiwan ToE 詞頻總表) into JSON.
 *
 * The file is Big5-encoded with embedded box-drawing characters and ~fb…;
 * formatting directives. Each data page is bracketed by ╔…╗/╚…╝ borders and
 * contains rows of: 詞頻序號 │ 詞目 │ 出現頻次 │ 累積頻次 │ 累積百分比.
 *
 * Words may contain Big5 EUDC characters (lead byte 0xFA-0xFE) with no Unicode
 * mapping. To avoid silently dropping data, a word with any EUDC byte-pair is
 * emitted as an array of segments, each either a decoded string run or
 * `{ eudc: "<hex>" }` for the original Big5 byte pair (lowercase hex).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(HERE, "../data/BIAU2.TXT");
const OUTPUT = resolve(HERE, "../biau2.json");

type EudcSegment = { eudc: string };
type Word = string | Array<string | EudcSegment>;

interface Entry {
	rank: number;
	word: Word;
	frequency: number;
	cumulativeFrequency: number;
	cumulativePercent: number;
}

// Row column separator: ║ = 0xF9 0xF8, │ = 0xA2 0x78.
// A data row begins with leading spaces + ║ and ends with ║ + CRLF.
// Layout (between the bounding ║s):
//   "  rank " │ " word… " │ " freq " │ " cumFreq " │ " cumPct "

const HEAVY_BAR = [0xf9, 0xf8] as const;
const LIGHT_BAR = [0xa2, 0x78] as const;

function findBytes(
	buf: Uint8Array,
	pattern: readonly number[],
	from: number,
	to: number,
): number {
	outer: for (let i = from; i <= to - pattern.length; i++) {
		for (let j = 0; j < pattern.length; j++) {
			if (buf[i + j] !== pattern[j]) continue outer;
		}
		return i;
	}
	return -1;
}

function hex2(n: number): string {
	return n.toString(16).padStart(2, "0");
}

function trimSpaces(bytes: Uint8Array): Uint8Array {
	let s = 0;
	let e = bytes.length;
	while (s < e && bytes[s] === 0x20) s++;
	while (e > s && bytes[e - 1] === 0x20) e--;
	return bytes.slice(s, e);
}

function decodeWord(bytes: Uint8Array): Word {
	// Walk pair-by-pair. Big5 is a double-byte encoding; a lead byte in
	// 0xFA-0xFE is the user-defined extension range (no Unicode mapping).
	// Accumulate runs of normal pairs into Big5-decoded string segments and
	// surface EUDC pairs as { eudc } so nothing is silently lost.
	const trimmed = trimSpaces(bytes);
	const segments: Array<string | EudcSegment> = [];
	let runStart = 0;
	const decoder = new TextDecoder("big5", { fatal: false });

	const flushRun = (endExclusive: number) => {
		if (endExclusive <= runStart) return;
		const decoded = decoder.decode(trimmed.slice(runStart, endExclusive));
		if (decoded.length > 0) segments.push(decoded);
	};

	let i = 0;
	while (i < trimmed.length) {
		const lead = trimmed[i]!;
		if (lead >= 0xfa && lead <= 0xfe) {
			flushRun(i);
			const trail = trimmed[i + 1] ?? 0;
			segments.push({ eudc: hex2(lead) + hex2(trail) });
			i += 2;
			runStart = i;
			continue;
		}
		// Normal Big5 lead byte (0x81-0xF9). Trail byte is the following byte.
		i += 2;
	}
	flushRun(trimmed.length);

	// If TextDecoder hit unmappable sequences it inserts U+FFFD. Treat that as
	// EUDC fallback by re-walking those pairs.
	const hasReplacement = segments.some(
		(s) => typeof s === "string" && s.includes("�"),
	);
	if (hasReplacement) {
		const rebuilt: Array<string | EudcSegment> = [];
		// Re-scan trimmed bytes, decoding each pair individually so we can pick
		// out which specific pair failed.
		let j = 0;
		let runBuf = "";
		while (j < trimmed.length) {
			const lead = trimmed[j]!;
			const trail = trimmed[j + 1] ?? 0;
			if (lead >= 0xfa && lead <= 0xfe) {
				if (runBuf) {
					rebuilt.push(runBuf);
					runBuf = "";
				}
				rebuilt.push({ eudc: hex2(lead) + hex2(trail) });
			} else {
				const ch = decoder.decode(trimmed.slice(j, j + 2));
				if (ch.includes("�")) {
					if (runBuf) {
						rebuilt.push(runBuf);
						runBuf = "";
					}
					rebuilt.push({ eudc: hex2(lead) + hex2(trail) });
				} else {
					runBuf += ch;
				}
			}
			j += 2;
		}
		if (runBuf) rebuilt.push(runBuf);
		segments.length = 0;
		segments.push(...rebuilt);
	}

	if (segments.length === 0) return "";
	if (segments.length === 1 && typeof segments[0] === "string") {
		return segments[0];
	}
	return segments;
}

function splitRow(buf: Uint8Array, start: number, end: number): Uint8Array[] {
	// Within a row (between the opening and closing ║), columns are separated
	// by │ (light) bars. BIAU2 rows have no internal heavy bar.
	const cells: Uint8Array[] = [];
	let cursor = start;
	while (cursor < end) {
		const next = findBytes(buf, LIGHT_BAR, cursor, end);
		if (next === -1) {
			cells.push(buf.slice(cursor, end));
			break;
		}
		cells.push(buf.slice(cursor, next));
		cursor = next + LIGHT_BAR.length;
	}
	return cells;
}

function asciiTrim(bytes: Uint8Array): string {
	return new TextDecoder("ascii").decode(trimSpaces(bytes));
}

function parse(buf: Uint8Array): Entry[] {
	const entries: Entry[] = [];
	let i = 0;
	while (i < buf.length) {
		const open = findBytes(buf, HEAVY_BAR, i, buf.length);
		if (open === -1) break;
		let eol = open;
		while (eol < buf.length && buf[eol] !== 0x0d && buf[eol] !== 0x0a) eol++;
		const close = findBytes(buf, HEAVY_BAR, open + HEAVY_BAR.length, eol);
		if (close === -1) {
			i = eol + 1;
			continue;
		}

		// Use [open+2, close) so we don't pick up trailing whitespace after the
		// closing ║.
		const cells = splitRow(buf, open + HEAVY_BAR.length, close);
		// A data row yields exactly 5 cells (rank, word, frequency, cumFreq,
		// cumPct). Header/border rows yield different counts or non-numeric
		// content and are filtered out.
		if (cells.length !== 5) {
			i = eol + 1;
			continue;
		}

		const rankStr = asciiTrim(cells[0]!);
		if (!/^\d+$/.test(rankStr)) {
			i = eol + 1;
			continue;
		}

		entries.push({
			rank: Number(rankStr),
			word: decodeWord(cells[1]!),
			frequency: Number(asciiTrim(cells[2]!)),
			cumulativeFrequency: Number(asciiTrim(cells[3]!)),
			cumulativePercent: Number(asciiTrim(cells[4]!)),
		});

		i = eol + 1;
	}
	return entries;
}

const buf = new Uint8Array(readFileSync(INPUT));
const entries = parse(buf);

const totalFrequency = entries.reduce((sum, e) => sum + e.frequency, 0);
const eudcCount = entries.filter((e) => typeof e.word !== "string").length;

const headers = [
	"rank",
	"word",
	"frequency",
	"cumulativeFrequency",
	"cumulativePercent",
] as const;

const json = {
	metadata: {
		source: "BIAU2.TXT",
		title: "詞頻總表",
		totalWords: entries.length,
		totalFrequency,
	},
	headers,
	data: entries.map((e) => [
		e.rank,
		e.word,
		e.frequency,
		e.cumulativeFrequency,
		e.cumulativePercent,
	]),
};

writeFileSync(OUTPUT, JSON.stringify(json) + "\n");

console.log(
	`Parsed ${entries.length} entries (total frequency ${totalFrequency}, ` +
		`${eudcCount} rows with EUDC characters) → ${OUTPUT}`,
);
