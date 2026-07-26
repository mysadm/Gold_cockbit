import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/egypt_prices_repository.dart';

final egyptPricesRepositoryProvider = Provider<EgyptPricesRepository>((ref) => EgyptPricesRepository());

final egyptPricesProvider = FutureProvider.autoDispose<EgyptGoldSnapshot>((ref) {
  final repository = ref.watch(egyptPricesRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetch(dio);
});
