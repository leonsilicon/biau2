export type Biau2Row = [
	rank: number,
	word: string,
	frequency: number,
	cumulativeFrequency: number,
	cumulativePercent: number,
];

export interface Biau2Data {
	metadata: {
		source: string;
		title: string;
		totalWords: number;
		totalFrequency: number;
	};
	headers: [
		"rank",
		"word",
		"frequency",
		"cumulativeFrequency",
		"cumulativePercent",
	];
	data: Biau2Row[];
}

declare const biau2: Biau2Data;
export default biau2;
