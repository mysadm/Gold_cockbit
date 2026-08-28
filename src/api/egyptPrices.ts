export type EgyptGoldKarat = '24k' | '22k' | '21k' | '18k' | 'gold_pound';

export type EgyptGoldRow = {
  karat: EgyptGoldKarat;
  sell: number;
  buy: number;
  changeAmount: number | null;
  changePct: number | null;
};

export type EgyptGoldSnapshot = {
  source: string;
  fetchedAt: string;
  rows: EgyptGoldRow[];
  stale?: boolean;
};

export async function fetchEgyptPrices(): Promise<EgyptGoldSnapshot> {
  const response = await fetch('/api/egypt-prices');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export type EgyptGoldHistoryEntry = { rows: EgyptGoldRow[]; fetchedAt: string };

export async function fetchEgyptPriceHistory(): Promise<EgyptGoldHistoryEntry[]> {
  const response = await fetch('/api/egypt-prices/history');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}
