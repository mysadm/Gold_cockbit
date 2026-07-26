import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/tranches/data/tranches_repository.dart';

void main() {
  group('Tranche.fromJson', () {
    test('parses a tranche row from the API', () {
      final tranche = Tranche.fromJson({
        'id': 1,
        'tranche_number': 1,
        'plan_pct': '40.00',
        'amount_egp': null,
        'gram_equivalent': null,
        'status': 'pending',
        'purchased_at': null,
      });

      expect(tranche.id, 1);
      expect(tranche.trancheNumber, 1);
      expect(tranche.planPct, 40.0);
      expect(tranche.status, 'pending');
      expect(tranche.purchasedAt, isNull);
    });

    test('parses purchased_at as a DateTime when present', () {
      final tranche = Tranche.fromJson({
        'id': 1,
        'tranche_number': 1,
        'plan_pct': '40.00',
        'amount_egp': '250000.00',
        'gram_equivalent': '42.5',
        'status': 'filled',
        'purchased_at': '2026-06-15T10:00:00.000Z',
      });

      expect(tranche.amountEgp, 250000.0);
      expect(tranche.gramEquivalent, 42.5);
      expect(tranche.purchasedAt, DateTime.parse('2026-06-15T10:00:00.000Z'));
    });
  });
}
