export type ScenarioWeights = [number, number, number];

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function rebalanceScenarioWeights(weights: ScenarioWeights, changedIndex: number, value: number): ScenarioWeights {
  const next = [...weights] as ScenarioWeights;
  next[changedIndex] = clamp(value, 10, 90);

  const changedValue = next[changedIndex];
  const otherTotal = next.reduce((sum, item, index) => sum + (index === changedIndex ? 0 : item), 0);
  const otherTarget = 100 - changedValue;

  const adjusted = next.map((item, index) => {
    if (index === changedIndex) return changedValue;
    const share = otherTotal === 0 ? 1 / 2 : item / otherTotal;
    return Math.round(share * otherTarget);
  }) as ScenarioWeights;

  const diff = 100 - adjusted.reduce((sum, item) => sum + item, 0);
  adjusted[0] = clamp(adjusted[0] + diff, 10, 90);
  return adjusted;
}

export function calculateWeightedTarget(weights: ScenarioWeights, spot: number): number {
  const targets = [spot * 1.05, spot * 1.0, spot * 0.95];
  return weights.reduce((sum, weight, index) => sum + weight * targets[index], 0) / 100;
}

export function calculateKaratBreakdown(egpAmount: number, gram24k: number, gram21k: number, gram18k: number) {
  return {
    twentyFourK: egpAmount / gram24k,
    twentyOneK: egpAmount / gram21k,
    eighteenK: egpAmount / gram18k,
  };
}
