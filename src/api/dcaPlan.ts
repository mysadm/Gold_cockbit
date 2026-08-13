export type DcaPlan = {
  start_date: string;
  total_investment_egp: number;
};

async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

export async function fetchDcaPlan(): Promise<DcaPlan> {
  return parse(await fetch('/api/dca-plan'));
}

export async function updateDcaPlan(updates: Partial<DcaPlan>): Promise<DcaPlan> {
  return parse(
    await fetch('/api/dca-plan', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  );
}
