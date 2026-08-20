export type DcaPlanMode = 'fixed' | 'recurring';

export type DcaPlan = {
  start_date: string;
  total_investment_egp: number;
  tranche_pcts: number[];
  spacing_months: number;
  mode: DcaPlanMode;
};

async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

// Postgres NUMERIC[] columns serialize their elements as strings, so
// tranche_pcts needs explicit coercion at the API boundary like every other
// NUMERIC/BIGINT field in this app.
function toDcaPlan(raw: any): DcaPlan {
  return {
    start_date: raw.start_date,
    total_investment_egp: Number(raw.total_investment_egp),
    tranche_pcts: (raw.tranche_pcts as unknown[]).map(Number),
    spacing_months: Number(raw.spacing_months),
    mode: raw.mode,
  };
}

export async function fetchDcaPlan(): Promise<DcaPlan> {
  return toDcaPlan(await parse(await fetch('/api/dca-plan')));
}

export async function updateDcaPlan(updates: Partial<DcaPlan>): Promise<DcaPlan> {
  return toDcaPlan(
    await parse(
      await fetch('/api/dca-plan', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    )
  );
}
