import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/watchlist/data/watchlist_repository.dart';

void main() {
  group('WatchlistItem.fromJson', () {
    test('parses a watchlist item row from the API', () {
      final item = WatchlistItem.fromJson({
        'id': 1,
        'label': 'Oil prices',
        'status': 'support',
        'sort_order': 0,
      });

      expect(item.id, 1);
      expect(item.label, 'Oil prices');
      expect(item.status, 'support');
    });
  });

  group('nextStatus', () {
    test('cycles support -> watch -> risk -> support', () {
      expect(nextStatus('support'), 'watch');
      expect(nextStatus('watch'), 'risk');
      expect(nextStatus('risk'), 'support');
    });
  });
}
