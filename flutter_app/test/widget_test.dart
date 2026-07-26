import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:gold_cockpit_mobile/main.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/core/app_shell.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/features/market/application/market_providers.dart';
import 'package:gold_cockpit_mobile/features/market/data/market_repository.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  testWidgets('App shell smoke test', (WidgetTester tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();

    // Pre-configure the app so it shows AppShell instead of SetupScreen
    final store = FakeSecureStore();
    final config = AppConfig(store);
    await config.setBaseUrl('http://localhost:8787');

    // Create a mock market snapshot with test data
    const mockSnapshot = MarketSnapshot(
      spotUsd: 2500.0,
      usdEgp: 50.0,
      spotSource: 'test',
      gramPrices: GramPrices(
        g24: 4018.7,
        g21: 3516.4,
        g18: 3015.0,
        goldPound: 28131.2,
      ),
    );

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          appConfigProvider.overrideWithValue(config),
          marketSnapshotProvider(0).overrideWith((ref) async => mockSnapshot),
        ],
        child: const MyApp(),
      ),
    );

    await tester.pumpAndSettle();

    // Verify app loads
    expect(find.byType(AppShell), findsOneWidget);
    expect(find.byType(AppBar), findsOneWidget);
    expect(find.byIcon(Icons.translate), findsOneWidget);
  });
}
