export type AlertRuleType = 'band_edge' | 'egp_move' | 'tranche_window';

export type AlertRule = {
  id: number;
  rule_type: AlertRuleType;
  config: Record<string, unknown>;
  active: boolean;
};

async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

function toRule(raw: any): AlertRule {
  return {
    id: Number(raw.id),
    rule_type: raw.rule_type,
    config: raw.config,
    active: raw.active,
  };
}

export async function fetchAlertRules(): Promise<AlertRule[]> {
  const data = await parse(await fetch('/api/alert-rules'));
  return (data as any[]).map(toRule);
}

export async function createAlertRule(rule_type: AlertRuleType, config: Record<string, unknown> = {}): Promise<AlertRule> {
  return toRule(
    await parse(
      await fetch('/api/alert-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rule_type, config }),
      })
    )
  );
}

export async function setAlertRuleActive(id: number, active: boolean): Promise<AlertRule> {
  return toRule(
    await parse(
      await fetch(`/api/alert-rules/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active }),
      })
    )
  );
}
