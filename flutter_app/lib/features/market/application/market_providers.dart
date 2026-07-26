import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/market_repository.dart';

final _dioProvider = Provider<Dio>((ref) => Dio());

final marketRepositoryProvider = Provider<MarketRepository>((ref) => MarketRepository());

final marketSnapshotProvider = FutureProvider.family<MarketSnapshot, double>((ref, premiumPct) {
  final repository = ref.watch(marketRepositoryProvider);
  final dio = ref.watch(_dioProvider);
  return repository.fetchSnapshot(dio, premiumPct: premiumPct);
});
