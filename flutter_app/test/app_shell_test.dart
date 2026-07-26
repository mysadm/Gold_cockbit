import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/core/domain.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/core/setup_screen.dart' show appConfigProvider;
import 'package:gold_cockpit_mobile/features/market/application/market_providers.dart';
import 'package:gold_cockpit_mobile/features/market/data/market_repository.dart';
import 'package:gold_cockpit_mobile/main.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  testWidgets('AppShell renders the market tab by default with a drawer listing all sections', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = FakeSecureStore();
    final config = AppConfig(store);
    await config.setBaseUrl('http://test.local');
    final prefs = await SharedPreferences.getInstance();

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
        child: const MyApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.byType(Scaffold), findsWidgets);

    final scaffoldState = tester.state<ScaffoldState>(find.byType(Scaffold).first);
    scaffoldState.openDrawer();
    await tester.pumpAndSettle();

    expect(find.text('Market'), findsWidgets);
    expect(find.text('Scenarios'), findsOneWidget);
    expect(find.text('Settings'), findsOneWidget);
  });
}
