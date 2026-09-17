import type { AnalysisSnapshot } from '../src/lib/analysisSnapshot';
export function parseV3(text: string): unknown;
export function validateV3(input: { parsed: unknown; snapshot: AnalysisSnapshot; evidenceIds?: string[] }): { ok: boolean; errors: string[] };
