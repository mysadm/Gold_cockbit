import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../data/dca_plan_repository.dart';
import '../data/tranches_repository.dart';

final tranchesRepositoryProvider = Provider<TranchesRepository>((ref) => TranchesRepository());

final tranchesListProvider = FutureProvider<List<Tranche>>((ref) {
  final repository = ref.watch(tranchesRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});

final dcaPlanRepositoryProvider = Provider<DcaPlanRepository>((ref) => DcaPlanRepository());

final dcaPlanProvider = FutureProvider<DcaPlan>((ref) {
  final repository = ref.watch(dcaPlanRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetch(dio);
});
