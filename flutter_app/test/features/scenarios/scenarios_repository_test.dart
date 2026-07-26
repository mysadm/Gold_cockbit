import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/scenarios/data/scenarios_repository.dart';

void main() {
  group('Scenario.fromJson', () {
    test('parses a scenario row from the API', () {
      final scenario = Scenario.fromJson({
        'id': 1,
        'name': 'De-escalation',
        'band_low': '5800.00',
        'band_high': '6300.00',
        'weight_pct': '35.00',
        'probability_pct': null,
        'sort_order': 0,
      });

      expect(scenario.id, 1);
      expect(scenario.name, 'De-escalation');
      expect(scenario.bandLow, 5800.0);
      expect(scenario.weightPct, 35.0);
      expect(scenario.probabilityPct, isNull);
    });
  });

  group('ScenariosRepository', () {
    test('fetchAll GETs /api/scenarios and parses the list', () async {
      final dio = Dio(BaseOptions())
        ..httpClientAdapter = _FakeAdapter({
          'GET /api/scenarios': (options) => [
                {
                  'id': 1,
                  'name': 'Base Case',
                  'band_low': '5000',
                  'band_high': '5400',
                  'weight_pct': '45',
                  'probability_pct': null,
                  'sort_order': 1,
                }
              ],
        });

      final repo = ScenariosRepository();
      final result = await repo.fetchAll(dio);

      expect(result, hasLength(1));
      expect(result.first.name, 'Base Case');
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
