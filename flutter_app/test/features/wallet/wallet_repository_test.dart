import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/wallet/data/wallet_repository.dart';

void main() {
  group('WalletHoldings.fromJson', () {
    test('coerces NUMERIC-as-string fields and the locked flag', () {
      final holdings = WalletHoldings.fromJson({
        'user_id': 'abc-123',
        'oz': 2,
        'g24': '10.5',
        'g21': '20.3',
        'g18': '5.1',
        'pounds': '2.7',
        'locked': true,
        'updated_at': '2026-08-14T00:00:00.000Z',
      });

      expect(holdings.oz, 2);
      expect(holdings.g24, 10.5);
      expect(holdings.g21, 20.3);
      expect(holdings.g18, 5.1);
      expect(holdings.pounds, 2.7);
      expect(holdings.locked, true);
      expect(holdings.forUnit('g24'), 10.5);
    });
  });

  group('WalletTransaction.fromJson', () {
    test('coerces id/amount/price_egp from strings', () {
      final tx = WalletTransaction.fromJson({
        'id': '7',
        'unit': 'g24',
        'side': 'buy',
        'amount': '5.0000',
        'price_egp': '7000.00',
        'recorded_at': '2026-08-14T00:00:00.000Z',
      });

      expect(tx.id, 7);
      expect(tx.amount, 5.0);
      expect(tx.priceEgp, 7000.0);
    });
  });

  group('WalletCostBasis.fromJson', () {
    test('parses derived cost-basis fields', () {
      final row = WalletCostBasis.fromJson({
        'unit': 'g21',
        'avgCostEgp': 6200,
        'openQty': 20,
        'realizedEgp': 0,
      });

      expect(row.unit, 'g21');
      expect(row.avgCostEgp, 6200);
      expect(row.openQty, 20);
      expect(row.realizedEgp, 0);
    });
  });

  group('WalletRepository', () {
    test('fetchHoldings GETs /api/wallet and parses it', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'GET /api/wallet': (options) => {
                'oz': 4,
                'g24': '332.0',
                'g21': '0.0',
                'g18': '0.0',
                'pounds': '24.0',
                'locked': true,
                'updated_at': '2026-08-14T00:00:00.000Z',
              },
        });

      final result = await WalletRepository().fetchHoldings(dio);

      expect(result.oz, 4);
      expect(result.g24, 332.0);
      expect(result.locked, true);
    });

    test('updateHoldings PUTs only the provided fields, including locked', () async {
      Map<String, dynamic>? sentData;
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'PUT /api/wallet': (options) {
            sentData = options.data as Map<String, dynamic>;
            return {
              'oz': 4,
              'g24': '332.0',
              'g21': '0.0',
              'g18': '0.0',
              'pounds': '24.0',
              'locked': true,
              'updated_at': '2026-08-14T00:00:00.000Z',
            };
          },
        });

      final result = await WalletRepository().updateHoldings(dio, oz: 4, locked: true);

      expect(sentData, {'oz': 4, 'locked': true});
      expect(result.locked, true);
    });

    test('recordTransaction POSTs /api/wallet/transactions and parses the combined result', () async {
      Map<String, dynamic>? sentData;
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'POST /api/wallet/transactions': (options) {
            sentData = options.data as Map<String, dynamic>;
            return {
              'transaction': {
                'id': '1',
                'unit': 'g24',
                'side': 'buy',
                'amount': '5.0000',
                'price_egp': '7000.00',
                'recorded_at': '2026-08-14T00:00:00.000Z',
              },
              'holdings': {
                'oz': 0,
                'g24': '5.0',
                'g21': '0.0',
                'g18': '0.0',
                'pounds': '0.0',
                'locked': false,
                'updated_at': '2026-08-14T00:00:00.000Z',
              },
            };
          },
        });

      final result = await WalletRepository().recordTransaction(
        dio,
        unit: 'g24',
        side: 'buy',
        amount: 5,
        priceEgp: 7000,
        recordedAt: '2026-08-14',
      );

      expect(sentData, {'unit': 'g24', 'side': 'buy', 'amount': 5, 'price_egp': 7000, 'recorded_at': '2026-08-14'});
      expect(result.transaction.id, 1);
      expect(result.holdings.g24, 5.0);
    });

    test('deleteTransaction DELETEs and returns the resulting holdings', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'DELETE /api/wallet/transactions/1': (options) => {
                'holdings': {
                  'oz': 0,
                  'g24': '0.0',
                  'g21': '0.0',
                  'g18': '0.0',
                  'pounds': '0.0',
                  'locked': true,
                  'updated_at': '2026-08-14T00:00:00.000Z',
                },
              },
        });

      final result = await WalletRepository().deleteTransaction(dio, 1);

      expect(result.g24, 0.0);
      expect(result.locked, true);
    });

    test('fetchCostBasis GETs /api/wallet/cost-basis and parses each row', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'GET /api/wallet/cost-basis': (options) => [
                {'unit': 'oz', 'avgCostEgp': 0, 'openQty': 0, 'realizedEgp': 0},
                {'unit': 'g24', 'avgCostEgp': 7000, 'openQty': 5, 'realizedEgp': 0},
              ],
        });

      final result = await WalletRepository().fetchCostBasis(dio);

      expect(result, hasLength(2));
      expect(result[1].avgCostEgp, 7000);
    });
  });
}

class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this._responses);
  final Map<String, dynamic Function(RequestOptions)> _responses;

  @override
  void close({bool force = false}) {}

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    final key = '${options.method} ${options.path}';
    final handler = _responses[key];
    if (handler == null) throw Exception('no fake response for $key');
    final data = handler(options);
    final bytes = utf8.encode(jsonEncode(data));
    return ResponseBody.fromBytes(bytes, 200, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }
}
