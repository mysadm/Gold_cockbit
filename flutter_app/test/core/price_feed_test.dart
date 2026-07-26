import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/price_feed/price_feed.dart';

void main() {
  group('fetchFromChain', () {
    test('returns the first source that succeeds with a valid value', () async {
      final sources = [
        PriceSource('bad', (dio) async => throw Exception('boom')),
        PriceSource('good', (dio) async => 5000),
        PriceSource('unreached', (dio) async => 1),
      ];

      final result = await fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000);

      expect(result.value, 5000);
      expect(result.source, 'good');
    });

    test('skips a source that returns an out-of-range value', () async {
      final sources = [
        PriceSource('out-of-range', (dio) async => 5),
        PriceSource('good', (dio) async => 5000),
      ];

      final result = await fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000);

      expect(result.source, 'good');
    });

    test('throws PriceFeedException with all diagnostics when every source fails', () async {
      final sources = [
        PriceSource('a', (dio) async => throw Exception('err-a')),
        PriceSource('b', (dio) async => 5),
      ];

      await expectLater(
        fetchFromChain(Dio(), sources, isValid: (v) => v > 1000 && v < 20000),
        throwsA(isA<PriceFeedException>()),
      );
    });
  });
}
