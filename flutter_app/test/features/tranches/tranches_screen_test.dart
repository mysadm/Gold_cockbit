import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/api_client.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/features/tranches/application/tranches_providers.dart';
import 'package:gold_cockpit_mobile/features/tranches/data/dca_plan_repository.dart';
import 'package:gold_cockpit_mobile/features/tranches/data/tranches_repository.dart';
import 'package:gold_cockpit_mobile/features/tranches/presentation/tranches_screen.dart';

class _FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

class _FakeTranchesRepository extends TranchesRepository {
  @override
  Future<List<Tranche>> fetchAll(Dio dio) async => const [
        Tranche(
          id: 1,
          trancheNumber: 1,
          planPct: 40,
          amountEgp: null,
          gramEquivalent: null,
          status: 'pending',
          purchasedAt: null,
        ),
      ];
}

class _FakeDcaPlanRepository extends DcaPlanRepository {
  @override
  Future<DcaPlan> fetch(Dio dio) async =>
      const DcaPlan(startDate: '2026-01-01', totalInvestmentEgp: 300000);
}

class _FailingDcaPlanRepository extends DcaPlanRepository {
  @override
  Future<DcaPlan> fetch(Dio dio) async =>
      const DcaPlan(startDate: '2026-01-01', totalInvestmentEgp: 300000);

  @override
  Future<DcaPlan> update(Dio dio, {String? startDate, double? totalInvestmentEgp}) {
    throw DioException(requestOptions: RequestOptions(path: '/api/dca-plan'), message: 'boom');
  }
}

void main() {
  Future<void> pumpScreen(WidgetTester tester, {DcaPlanRepository? dcaPlanRepository}) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(ApiClient(AppConfig(_FakeSecureStore()))),
          tranchesRepositoryProvider.overrideWithValue(_FakeTranchesRepository()),
          dcaPlanRepositoryProvider.overrideWithValue(dcaPlanRepository ?? _FakeDcaPlanRepository()),
        ],
        child: const MaterialApp(home: Scaffold(body: TranchesScreen())),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows the computed tranche window and planned amount', (tester) async {
    await pumpScreen(tester);

    expect(find.textContaining('Tranche 1 · 40%'), findsOneWidget);
    // start_date 2026-01-01, tranche 0 window = Jan 2026 – Mar 2026
    expect(find.textContaining('2026-01 – 2026-03'), findsOneWidget);
    // 40% of 300000 planned amount, since amount_egp is null
    expect(find.textContaining('120000 EGP'), findsOneWidget);
  });

  testWidgets('shows a SnackBar instead of throwing when updating the plan fails', (tester) async {
    await pumpScreen(tester, dcaPlanRepository: _FailingDcaPlanRepository());

    await tester.enterText(find.byKey(const Key('investmentAmountField')), '400000');
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
  });
}
