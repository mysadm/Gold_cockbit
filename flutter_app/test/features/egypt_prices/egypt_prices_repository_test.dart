import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/egypt_prices/data/egypt_prices_repository.dart';

void main() {
  group('EgyptGoldSnapshot.fromJson', () {
    test('parses the source, fetchedAt, and rows', () {
      final snapshot = EgyptGoldSnapshot.fromJson({
        'source': 'isagha',
        'fetchedAt': '2026-07-26T10:00:00.000Z',
        'rows': [
          {'karat': '24k', 'sell': 5100.0, 'buy': 5050.0, 'changeAmount': 10.0, 'changePct': 0.2},
          {'karat': 'gold_pound', 'sell': 40800.0, 'buy': 40400.0, 'changeAmount': null, 'changePct': null},
        ],
      });

      expect(snapshot.source, 'isagha');
      expect(snapshot.rows, hasLength(2));
      expect(snapshot.rows[0].karat, '24k');
      expect(snapshot.rows[1].changeAmount, isNull);
    });
  });
}
