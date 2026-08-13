export type WalletUnit = 'oz' | 'g24' | 'g21' | 'g18' | 'pounds';

export type WalletHoldingsRecord = {
  oz: number;
  g24: number;
  g21: number;
  g18: number;
  pounds: number;
  locked: boolean;
  updated_at: string;
};

export type WalletSnapshot = {
  id: number;
  intl_value_egp: number;
  egypt_value_egp: number | null;
  usd_egp_rate: number | null;
  recorded_at: string;
};

export type WalletTransaction = {
  id: number;
  unit: WalletUnit;
  side: 'buy' | 'sell';
  amount: number;
  price_egp: number;
  recorded_at: string;
};

async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

// Postgres NUMERIC/BIGINT columns are serialized as strings to avoid precision
// loss, so every numeric field coming back from the API needs explicit coercion.
function toHoldings(raw: any): WalletHoldingsRecord {
  return {
    oz: Number(raw.oz),
    g24: Number(raw.g24),
    g21: Number(raw.g21),
    g18: Number(raw.g18),
    pounds: Number(raw.pounds),
    locked: !!raw.locked,
    updated_at: raw.updated_at,
  };
}

function toSnapshot(raw: any): WalletSnapshot {
  return {
    id: Number(raw.id),
    intl_value_egp: Number(raw.intl_value_egp),
    egypt_value_egp: raw.egypt_value_egp === null || raw.egypt_value_egp === undefined ? null : Number(raw.egypt_value_egp),
    usd_egp_rate: raw.usd_egp_rate === null || raw.usd_egp_rate === undefined ? null : Number(raw.usd_egp_rate),
    recorded_at: raw.recorded_at,
  };
}

function toTransaction(raw: any): WalletTransaction {
  return {
    id: Number(raw.id),
    unit: raw.unit,
    side: raw.side,
    amount: Number(raw.amount),
    price_egp: Number(raw.price_egp),
    recorded_at: raw.recorded_at,
  };
}

export async function fetchWalletHoldings(): Promise<WalletHoldingsRecord> {
  return toHoldings(await parse(await fetch('/api/wallet')));
}

export async function updateWalletHoldings(
  updates: Partial<Pick<WalletHoldingsRecord, 'oz' | 'g24' | 'g21' | 'g18' | 'pounds' | 'locked'>>
): Promise<WalletHoldingsRecord> {
  return toHoldings(
    await parse(
      await fetch('/api/wallet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    )
  );
}

export async function recordWalletSnapshot(input: { intl_value_egp: number; egypt_value_egp: number | null; usd_egp_rate?: number | null }): Promise<WalletSnapshot> {
  return toSnapshot(
    await parse(
      await fetch('/api/wallet/snapshots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    )
  );
}

export async function fetchWalletSnapshots(since?: string): Promise<WalletSnapshot[]> {
  const url = since ? `/api/wallet/snapshots?since=${encodeURIComponent(since)}` : '/api/wallet/snapshots';
  const data = await parse(await fetch(url));
  return (data as any[]).map(toSnapshot);
}

export type WalletTransactionInput = {
  unit: WalletUnit;
  side: 'buy' | 'sell';
  amount: number;
  price_egp: number;
  recorded_at?: string;
};

export async function recordWalletTransaction(
  input: WalletTransactionInput
): Promise<{ transaction: WalletTransaction; holdings: WalletHoldingsRecord }> {
  const data = await parse(
    await fetch('/api/wallet/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  );
  return { transaction: toTransaction(data.transaction), holdings: toHoldings(data.holdings) };
}

export async function updateWalletTransaction(
  id: number,
  updates: Partial<WalletTransactionInput>
): Promise<{ transaction: WalletTransaction; holdings: WalletHoldingsRecord }> {
  const data = await parse(
    await fetch(`/api/wallet/transactions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
  );
  return { transaction: toTransaction(data.transaction), holdings: toHoldings(data.holdings) };
}

export async function deleteWalletTransaction(id: number): Promise<WalletHoldingsRecord> {
  const data = await parse(await fetch(`/api/wallet/transactions/${id}`, { method: 'DELETE' }));
  return toHoldings(data.holdings);
}

export async function fetchWalletTransactions(): Promise<WalletTransaction[]> {
  const data = await parse(await fetch('/api/wallet/transactions'));
  return (data as any[]).map(toTransaction);
}

export type WalletCostBasis = {
  unit: WalletUnit;
  avgCostEgp: number;
  openQty: number;
  realizedEgp: number;
};

function toCostBasis(raw: any): WalletCostBasis {
  return {
    unit: raw.unit,
    avgCostEgp: Number(raw.avgCostEgp),
    openQty: Number(raw.openQty),
    realizedEgp: Number(raw.realizedEgp),
  };
}

export async function fetchWalletCostBasis(): Promise<WalletCostBasis[]> {
  const data = await parse(await fetch('/api/wallet/cost-basis'));
  return (data as any[]).map(toCostBasis);
}
