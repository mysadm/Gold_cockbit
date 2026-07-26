import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../data/llm_providers_repository.dart';

export '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;

final llmProvidersRepositoryProvider = Provider<LlmProvidersRepository>((ref) => LlmProvidersRepository());

final llmProvidersListProvider = FutureProvider.autoDispose<List<LlmProvider>>((ref) {
  final repository = ref.watch(llmProvidersRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
