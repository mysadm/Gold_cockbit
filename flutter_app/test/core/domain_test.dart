// flutter_app/test/core/domain_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';

void main() {
  group('clampValue', () {
    test('clamps below min', () => expect(clampValue(5, 10, 90), 10));
    test('clamps above max', () => expect(clampValue(95, 10, 90), 90));
    test('passes through in range', () => expect(clampValue(50, 10, 90), 50));
  });

  group('rebalanceScenarioWeights', () {
    test('rebalances the other two weights to keep the total at 100', () {
      final result = rebalanceScenarioWeights([35, 45, 20], 0, 60);
      expect(result[0], 60);
      expect(result.reduce((a, b) => a + b), 100);
    });

    test('clamps the changed weight to the 10..90 range', () {
      final result = rebalanceScenarioWeights([35, 45, 20], 0, 95);
      expect(result[0], 90);
    });
  });

  group('calculateWeightedTarget', () {
    test('computes the probability-weighted target across the three bands', () {
      final target = calculateWeightedTarget([35, 45, 20], 5000);
      // (35*5250 + 45*5000 + 20*4750) / 100 = 5037.5
      expect(target, closeTo(5037.5, 0.001));
    });
  });

  group('calculateKaratBreakdown', () {
    test('divides the EGP amount by each karat gram price', () {
      final result = calculateKaratBreakdown(10000, 5000, 4375, 3750);
      expect(result.twentyFourK, closeTo(2.0, 0.001));
      expect(result.twentyOneK, closeTo(2.2857, 0.001));
      expect(result.eighteenK, closeTo(2.6667, 0.001));
    });
  });

  group('calculateGramPrices', () {
    test('derives g24/g21/g18/goldPound from spot, EGP rate, and premium', () {
      final result = calculateGramPrices(spotUsd: 5000, usdEgp: 50, premiumPct: 2);
      final expectedG24 = (5000 / goldOunceGrams) * 50 * 1.02;
      expect(result.g24, closeTo(expectedG24, 0.001));
      expect(result.g21, closeTo(expectedG24 * 0.875, 0.001));
      expect(result.g18, closeTo(expectedG24 * 0.75, 0.001));
      expect(result.goldPound, closeTo(expectedG24 * 0.875 * 8, 0.001));
    });
  });
}
