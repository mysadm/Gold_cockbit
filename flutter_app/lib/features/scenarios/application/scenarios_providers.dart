import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../../../core/setup_screen.dart';
import '../data/scenarios_repository.dart';

final scenariosRepositoryProvider = Provider<ScenariosRepository>((ref) => ScenariosRepository());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(ref.watch(appConfigProvider)));

final scenariosListProvider = FutureProvider<List<Scenario>>((ref) {
  final repository = ref.watch(scenariosRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
