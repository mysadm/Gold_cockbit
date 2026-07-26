import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/watchlist_repository.dart';

final watchlistRepositoryProvider = Provider<WatchlistRepository>((ref) => WatchlistRepository());

final watchlistListProvider =
    FutureProvider.autoDispose<List<WatchlistItem>>((ref) {
  final repository = ref.watch(watchlistRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
