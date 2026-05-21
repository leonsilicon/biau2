/**
 * Parses data/BIAU2.TXT (Taiwan ToE 詞頻總表) into JSON.
 *
 * The file is Big5-encoded with embedded box-drawing characters and ~fb…;
 * formatting directives. Each data page is bracketed by ╔…╗/╚…╝ borders and
 * contains rows of: 詞頻序號 │ 詞目 │ 出現頻次 │ 累積頻次 │ 累積百分比.
 *
 * Word cells are decoded with the WHATWG Big5 index table
 * (data/index-big5.txt), which covers the HKSCS extension range 0xFA–0xFE
 * that Node's built-in TextDecoder maps to PUA codepoints.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const INPUT = resolve(HERE, "../data/BIAU2.TXT");
const INDEX = resolve(HERE, "../data/index-big5.txt");
const OUTPUT = resolve(HERE, "../biau2.json");

interface Entry {
	rank: number;
	word: string;
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

function loadBig5Index(path: string): Map<number, number> {
	// WHATWG index-big5.txt: each non-comment line is "<pointer> 0x<codepoint> ..."
	// pointer = (lead - 0x81) * 157 + (trail - (trail < 0x7F ? 0x40 : 0x62)).
	const map = new Map<number, number>();
	const text = readFileSync(path, "utf8");
	for (const line of text.split("\n")) {
		const m = line.match(/^\s*(\d+)\s+0x([0-9A-Fa-f]+)/);
		if (!m) continue;
		map.set(Number(m[1]), parseInt(m[2]!, 16));
	}
	return map;
}

const BIG5_INDEX = loadBig5Index(INDEX);

function decodeBig5(bytes: Uint8Array): string {
	// Pair-wise Big5 decoder following the WHATWG algorithm. ASCII bytes pass
	// through; double-byte sequences are looked up in BIG5_INDEX, which extends
	// vanilla Big5 with HKSCS mappings for the 0xFA–0xFE lead range.
	let out = "";
	for (let i = 0; i < bytes.length; i++) {
		const lead = bytes[i]!;
		if (lead < 0x80) {
			out += String.fromCharCode(lead);
			continue;
		}
		const trail = bytes[i + 1];
		if (trail === undefined) throw new Error(`dangling Big5 lead 0x${lead.toString(16)}`);
		const offset = trail < 0x7f ? 0x40 : 0x62;
		if (trail < 0x40 || trail === 0x7f || trail > 0xfe) {
			throw new Error(
				`invalid Big5 pair ${lead.toString(16)} ${trail.toString(16)}`,
			);
		}
		const pointer = (lead - 0x81) * 157 + (trail - offset);
		const cp = BIG5_INDEX.get(pointer);
		if (cp === undefined) {
			throw new Error(
				`unmapped Big5 pair ${lead.toString(16)}${trail.toString(16).padStart(2, "0")} (pointer ${pointer})`,
			);
		}
		out += String.fromCodePoint(cp);
		i++;
	}
	return out;
}

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

function trimSpaces(bytes: Uint8Array): Uint8Array {
	let s = 0;
	let e = bytes.length;
	while (s < e && bytes[s] === 0x20) s++;
	while (e > s && bytes[e - 1] === 0x20) e--;
	return bytes.slice(s, e);
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
			word: decodeBig5(trimSpaces(cells[1]!)),
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
	`Parsed ${entries.length} entries (total frequency ${totalFrequency}) → ${OUTPUT}`,
);
