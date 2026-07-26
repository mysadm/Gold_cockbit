import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/market/data/market_repository.dart';

void main() {
  test('fetchSnapshot combines spot/FX prices into gram prices', () async {
    final repo = MarketRepository(
      fetchSpot: (dio) async => 5000,
      fetchFx: (dio) async => 50,
      fetchSpotSource: (dio) async => 'gold-api',
    );

    final snapshot = await repo.fetchSnapshot(Dio(), premiumPct: 2);

    expect(snapshot.spotUsd, 5000);
    expect(snapshot.usdEgp, 50);
    expect(snapshot.spotSource, 'gold-api');
    expect(snapshot.gramPrices.g24, greaterThan(0));
  });
}
