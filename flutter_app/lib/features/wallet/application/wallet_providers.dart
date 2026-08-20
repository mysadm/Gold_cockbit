import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../data/wallet_repository.dart';

final walletRepositoryProvider = Provider<WalletRepository>((ref) => WalletRepository());

final walletHoldingsProvider = FutureProvider.autoDispose<WalletHoldings>((ref) {
  final repository = ref.watch(walletRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchHoldings(dio);
});

final walletTransactionsProvider = FutureProvider.autoDispose<List<WalletTransaction>>((ref) {
  final repository = ref.watch(walletRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchTransactions(dio);
});

final walletCostBasisProvider = FutureProvider.autoDispose<List<WalletCostBasis>>((ref) {
  final repository = ref.watch(walletRepositoryProvider);
  final dio = ref.watch(apiClientProvider).dio;
  return repository.fetchCostBasis(dio);
});
