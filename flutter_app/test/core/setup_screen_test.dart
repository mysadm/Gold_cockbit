import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/core/setup_screen.dart';
import 'package:gold_cockpit_mobile/core/app_shell.dart';
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
  testWidgets('saving the form persists base URL and API key', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = FakeSecureStore();
    final config = AppConfig(store);

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
          appConfigProvider.overrideWithValue(config),
          sharedPreferencesProvider.overrideWithValue(prefs),
          marketSnapshotProvider(0).overrideWith((ref) async => mockSnapshot),
        ],
        child: const MaterialApp(home: SetupScreen()),
      ),
    );

    await tester.enterText(find.byKey(const Key('baseUrlField')), 'http://192.168.1.5:8787');
    await tester.enterText(find.byKey(const Key('apiKeyField')), 'my-secret');
    await tester.tap(find.byKey(const Key('saveButton')));
    await tester.pumpAndSettle();

    expect(await config.baseUrl, 'http://192.168.1.5:8787');
    expect(await config.apiKey, 'my-secret');
  });

  testWidgets('saving the form navigates to app shell', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final prefs = await SharedPreferences.getInstance();
    final store = FakeSecureStore();
    final config = AppConfig(store);

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
          appConfigProvider.overrideWithValue(config),
          sharedPreferencesProvider.overrideWithValue(prefs),
          marketSnapshotProvider(0).overrideWith((ref) async => mockSnapshot),
        ],
        child: const MaterialApp(home: SetupScreen()),
      ),
    );

    await tester.enterText(find.byKey(const Key('baseUrlField')), 'http://192.168.1.5:8787');
    await tester.tap(find.byKey(const Key('saveButton')));
    await tester.pumpAndSettle();

    // The setup screen should be replaced with app shell
    expect(find.byType(SetupScreen), findsNothing);
    // The app shell should now be visible
    expect(find.byType(AppShell), findsOneWidget);
  });
}
