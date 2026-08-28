export type InternationalPriceEntry = {
  id: number;
  spot_usd: number;
  usd_egp: number | null;
  gold_source: string | null;
  fetched_at: string;
};

async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function recordInternationalPrice(input: {
  spot_usd: number;
  usd_egp?: number | null;
  source?: string | null;
}): Promise<InternationalPriceEntry> {
  const response = await fetch('/api/international-prices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return parse(response);
}

export async function fetchInternationalPriceHistory(): Promise<InternationalPriceEntry[]> {
  const response = await fetch('/api/international-prices');
  return parse(response);
}
