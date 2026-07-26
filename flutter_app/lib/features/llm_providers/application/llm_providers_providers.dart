import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../data/llm_providers_repository.dart';

export '../../../core/api_client.dart' show apiClientProvider;

final llmProvidersRepositoryProvider = Provider<LlmProvidersRepository>((ref) => LlmProvidersRepository());

final llmProvidersListProvider = FutureProvider.autoDispose<List<LlmProvider>>((ref) {
  final repository = ref.watch(llmProvidersRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchAll(dio);
});
