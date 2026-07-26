import 'dart:async';
import 'package:dio/dio.dart';

class PriceSourceResult {
  final double value;
  final String source;
  const PriceSourceResult(this.value, this.source);
}

class PriceFeedException implements Exception {
  final List<String> diagnostics;
  const PriceFeedException(this.diagnostics);

  @override
  String toString() => 'All price sources failed: ${diagnostics.join('; ')}';
}

typedef PriceSourceFn = Future<double> Function(Dio dio);

class PriceSource {
  final String name;
  final PriceSourceFn fetch;
  const PriceSource(this.name, this.fetch);
}

Future<PriceSourceResult> fetchFromChain(
  Dio dio,
  List<PriceSource> sources, {
  required bool Function(double) isValid,
  Duration timeout = const Duration(seconds: 6),
}) async {
  final diagnostics = <String>[];

  for (final source in sources) {
    try {
      final value = await source.fetch(dio).timeout(timeout);
      if (isValid(value)) {
        return PriceSourceResult(value, source.name);
      }
      diagnostics.add('${source.name}: bad value');
    } catch (error) {
      diagnostics.add('${source.name}: $error');
    }
  }

  throw PriceFeedException(diagnostics);
}

final List<PriceSource> spotUsdSources = [
  PriceSource('gold-api', (dio) async {
    final r = await dio.get('https://api.gold-api.com/price/XAU');
    return (r.data['price'] as num).toDouble();
  }),
  PriceSource('goldprice.org', (dio) async {
    final r = await dio.get('https://data-asg.goldprice.org/dbXRates/USD');
    return (r.data['items'][0]['xauPrice'] as num).toDouble();
  }),
  PriceSource('binance-paxg', (dio) async {
    final r = await dio.get('https://api.binance.com/api/v3/ticker/price?symbol=PAXGUSDT');
    return double.parse(r.data['price'] as String);
  }),
  PriceSource('jsdelivr-daily', (dio) async {
    final r = await dio.get(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    );
    final perUsd = (r.data['usd']['xau'] as num).toDouble();
    if (perUsd == 0) throw Exception('zero xau-per-usd');
    return 1 / perUsd;
  }),
];

final List<PriceSource> usdEgpSources = [
  PriceSource('er-api', (dio) async {
    final r = await dio.get('https://open.er-api.com/v6/latest/USD');
    return (r.data['rates']['EGP'] as num).toDouble();
  }),
  PriceSource('jsdelivr', (dio) async {
    final r = await dio.get(
      'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json',
    );
    return (r.data['usd']['egp'] as num).toDouble();
  }),
];

bool isValidSpot(double value) => value > 1000 && value < 20000;
bool isValidFx(double value) => value > 20 && value < 200;

Future<PriceSourceResult> fetchSpotUsd(Dio dio) =>
    fetchFromChain(dio, spotUsdSources, isValid: isValidSpot);

Future<PriceSourceResult> fetchUsdEgp(Dio dio) =>
    fetchFromChain(dio, usdEgpSources, isValid: isValidFx);
