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
  final FetchValue _fetchSpot;
  final FetchValue _fetchFx;
  final FetchSource _fetchSpotSource;

  MarketRepository({
    FetchValue? fetchSpot,
    FetchValue? fetchFx,
    FetchSource? fetchSpotSource,
  })  : _fetchSpot = fetchSpot ?? ((dio) async => (await fetchSpotUsd(dio)).value),
        _fetchFx = fetchFx ?? ((dio) async => (await fetchUsdEgp(dio)).value),
        _fetchSpotSource = fetchSpotSource ?? ((dio) async => (await fetchSpotUsd(dio)).source);

  Future<MarketSnapshot> fetchSnapshot(Dio dio, {required double premiumPct}) async {
    final spot = await _fetchSpot(dio);
    final fx = await _fetchFx(dio);
    final source = await _fetchSpotSource(dio);
    final gramPrices = calculateGramPrices(spotUsd: spot, usdEgp: fx, premiumPct: premiumPct);
    return MarketSnapshot(spotUsd: spot, usdEgp: fx, spotSource: source, gramPrices: gramPrices);
  }
}
