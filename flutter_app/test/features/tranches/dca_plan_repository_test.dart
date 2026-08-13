import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/tranches/data/dca_plan_repository.dart';

void main() {
  group('DcaPlan.fromJson', () {
    test('parses a plan row from the API', () {
      final plan = DcaPlan.fromJson({
        'user_id': 'abc-123',
        'start_date': '2026-08-10',
        'total_investment_egp': '300000.00',
      });

      expect(plan.startDate, '2026-08-10');
      expect(plan.totalInvestmentEgp, 300000.0);
    });
  });

  group('DcaPlanRepository', () {
    test('fetch GETs /api/dca-plan and parses it', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'GET /api/dca-plan': (options) => {
                'user_id': 'abc-123',
                'start_date': '2026-08-10',
                'total_investment_egp': '300000.00',
              },
        });

      final result = await DcaPlanRepository().fetch(dio);

      expect(result.startDate, '2026-08-10');
      expect(result.totalInvestmentEgp, 300000.0);
    });

    test('update PATCHes /api/dca-plan with only the provided fields', () async {
      Map<String, dynamic>? sentData;
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'PATCH /api/dca-plan': (options) {
            sentData = options.data as Map<String, dynamic>;
            return {
              'user_id': 'abc-123',
              'start_date': '2026-09-01',
              'total_investment_egp': '450000.00',
            };
          },
        });

      final result = await DcaPlanRepository().update(dio, startDate: '2026-09-01');

      expect(sentData, {'start_date': '2026-09-01'});
      expect(result.startDate, '2026-09-01');
      expect(result.totalInvestmentEgp, 450000.0);
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
