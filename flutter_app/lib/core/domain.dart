const double goldOunceGrams = 31.1035;

double clampValue(double value, double min, double max) {
  return value < min ? min : (value > max ? max : value);
}

List<double> rebalanceScenarioWeights(List<double> weights, int changedIndex, double value) {
  final next = List<double>.from(weights);
  next[changedIndex] = clampValue(value, 10, 90);

  final changedValue = next[changedIndex];
  final otherTotal = next.asMap().entries.fold<double>(
        0,
        (sum, entry) => sum + (entry.key == changedIndex ? 0 : entry.value),
      );
  final otherTarget = 100 - changedValue;

  final adjusted = next.asMap().entries.map((entry) {
    if (entry.key == changedIndex) return changedValue;
    final share = otherTotal == 0 ? 0.5 : entry.value / otherTotal;
    return (share * otherTarget).roundToDouble();
  }).toList();

  final diff = 100 - adjusted.reduce((sum, item) => sum + item);
  adjusted[0] = clampValue(adjusted[0] + diff, 10, 90);
  return adjusted;
}

double calculateWeightedTarget(List<double> weights, double spot) {
  final targets = [spot * 1.05, spot * 1.0, spot * 0.95];
  var sum = 0.0;
  for (var i = 0; i < weights.length; i++) {
    sum += weights[i] * targets[i];
  }
  return sum / 100;
}

class KaratBreakdown {
  final double twentyFourK;
  final double twentyOneK;
  final double eighteenK;

  const KaratBreakdown({
    required this.twentyFourK,
    required this.twentyOneK,
    required this.eighteenK,
  });
}

KaratBreakdown calculateKaratBreakdown(
  double egpAmount,
  double gram24k,
  double gram21k,
  double gram18k,
) {
  return KaratBreakdown(
    twentyFourK: egpAmount / gram24k,
    twentyOneK: egpAmount / gram21k,
    eighteenK: egpAmount / gram18k,
  );
}

class GramPrices {
  final double g24;
  final double g21;
  final double g18;
  final double goldPound;

  const GramPrices({
    required this.g24,
    required this.g21,
    required this.g18,
    required this.goldPound,
  });
}

GramPrices calculateGramPrices({
  required double spotUsd,
  required double usdEgp,
  required double premiumPct,
}) {
  final g24 = (spotUsd / goldOunceGrams) * usdEgp * (1 + premiumPct / 100);
  final g21 = g24 * 0.875;
  final g18 = g24 * 0.75;
  final goldPound = g21 * 8;
  return GramPrices(g24: g24, g21: g21, g18: g18, goldPound: goldPound);
}
