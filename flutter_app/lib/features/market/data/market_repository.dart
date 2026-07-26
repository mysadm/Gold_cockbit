import 'package:dio/dio.dart';
import '../../../core/domain.dart';
import '../../../core/price_feed/price_feed.dart';

class MarketSnapshot {
  final double spotUsd;
  final double usdEgp;
  final String spotSource;
  final GramPrices gramPrices;

  const MarketSnapshot({
    required this.spotUsd,
    required this.usdEgp,
    required this.spotSource,
    required this.gramPrices,
  });
}

typedef FetchValue = Future<double> Function(Dio dio);
typedef FetchSource = Future<String> Function(Dio dio);

class MarketRepository {
  final FetchValue? _fetchSpotOverride;
  final FetchValue _fetchFx;
  final FetchSource? _fetchSpotSourceOverride;

  MarketRepository({
    FetchValue? fetchSpot,
    FetchValue? fetchFx,
    FetchSource? fetchSpotSource,
  })  : _fetchSpotOverride = fetchSpot,
        _fetchFx = fetchFx ?? ((dio) async => (await fetchUsdEgp(dio)).value),
        _fetchSpotSourceOverride = fetchSpotSource;

  Future<MarketSnapshot> fetchSnapshot(Dio dio, {required double premiumPct}) async {
    double spot;
    String source;
    if (_fetchSpotOverride != null || _fetchSpotSourceOverride != null) {
      // A caller (e.g. a test) supplied one or both hooks explicitly; honor
      // them individually, falling back to a fresh fetch for whichever side
      // wasn't overridden.
      spot = _fetchSpotOverride != null
          ? await _fetchSpotOverride(dio)
          : (await fetchSpotUsd(dio)).value;
      source = _fetchSpotSourceOverride != null
          ? await _fetchSpotSourceOverride(dio)
          : (await fetchSpotUsd(dio)).source;
    } else {
      // Default path: fetch once and derive both the price and its source
      // from the same fallback-chain walk.
      final result = await fetchSpotUsd(dio);
      spot = result.value;
      source = result.source;
    }
    final fx = await _fetchFx(dio);
    final gramPrices = calculateGramPrices(spotUsd: spot, usdEgp: fx, premiumPct: premiumPct);
    return MarketSnapshot(spotUsd: spot, usdEgp: fx, spotSource: source, gramPrices: gramPrices);
  }
}
