import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/api_client.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/features/egypt_prices/application/egypt_prices_providers.dart';
import 'package:gold_cockpit_mobile/features/egypt_prices/data/egypt_prices_repository.dart';
import 'package:gold_cockpit_mobile/features/wallet/application/wallet_providers.dart';
import 'package:gold_cockpit_mobile/features/wallet/data/wallet_repository.dart';
import 'package:gold_cockpit_mobile/features/wallet/presentation/wallet_screen.dart';

class _FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

class _FakeEgyptPricesRepository extends EgyptPricesRepository {
  @override
  Future<EgyptGoldSnapshot> fetch(Dio dio) async =>
      EgyptGoldSnapshot(source: 'test', fetchedAt: DateTime(2026, 8, 14), rows: const []);
}

const _lockedHoldings = WalletHoldings(
  oz: 4,
  g24: 332,
  g21: 0,
  g18: 0,
  pounds: 24,
  locked: true,
  updatedAt: '2026-08-14T00:00:00.000Z',
);

class _FakeWalletRepository extends WalletRepository {
  _FakeWalletRepository({this.holdings = _lockedHoldings, this.transactions = const []});

  final WalletHoldings holdings;
  final List<WalletTransaction> transactions;

  @override
  Future<WalletHoldings> fetchHoldings(Dio dio) async => holdings;

  @override
  Future<List<WalletTransaction>> fetchTransactions(Dio dio) async => transactions;

  @override
  Future<List<WalletCostBasis>> fetchCostBasis(Dio dio) async => const [];
}

class _FailingWalletRepository extends _FakeWalletRepository {
  @override
  Future<WalletTransactionResult> recordTransaction(
    Dio dio, {
    required String unit,
    required String side,
    required double amount,
    required double priceEgp,
    String? recordedAt,
  }) {
    throw DioException(requestOptions: RequestOptions(path: '/api/wallet/transactions'), message: 'boom');
  }
}

void main() {
  Future<void> pumpScreen(WidgetTester tester, {WalletRepository? walletRepository}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(ApiClient(AppConfig(_FakeSecureStore()))),
          walletRepositoryProvider.overrideWithValue(walletRepository ?? _FakeWalletRepository()),
          egyptPricesRepositoryProvider.overrideWithValue(_FakeEgyptPricesRepository()),
        ],
        child: const MaterialApp(
          home: Scaffold(
            body: WalletScreen(gramPrices: GramPrices(g24: 7000, g21: 6125, g18: 5250, goldPound: 49000)),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows locked holdings read-only with a correction control', (tester) async {
    await pumpScreen(tester);

    expect(find.text('332.0'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Request correction'), findsOneWidget);
    expect(find.byKey(const Key('holdingsField_g24')), findsNothing);
  });

  testWidgets('shows a SnackBar instead of throwing when recording a transaction fails', (tester) async {
    await pumpScreen(tester, walletRepository: _FailingWalletRepository());

    await tester.enterText(find.byKey(const Key('txAmountField')), '5');
    await tester.enterText(find.byKey(const Key('txPriceField')), '7000');
    await tester.tap(find.byKey(const Key('submitTxButton')));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
  });
}
