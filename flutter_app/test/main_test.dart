import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/app_shell.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/core/setup_screen.dart';
import 'package:gold_cockpit_mobile/main.dart';
import 'package:shared_preferences/shared_preferences.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  testWidgets('shows SetupScreen when AppConfig is not configured', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = FakeSecureStore();
    final config = AppConfig(store);
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(config),
          sharedPreferencesProvider.overrideWithValue(prefs),
        ],
        child: const MyApp(),
      ),
    );

    // Wait for the FutureBuilder to complete
    await tester.pumpAndSettle();

    expect(find.byType(SetupScreen), findsOneWidget);
  });

  testWidgets('shows AppShell when AppConfig is configured', (tester) async {
    SharedPreferences.setMockInitialValues({});
    final store = FakeSecureStore();
    final config = AppConfig(store);
    // Pre-configure the app by setting a base URL
    await config.setBaseUrl('http://192.168.1.5:8787');
    final prefs = await SharedPreferences.getInstance();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          appConfigProvider.overrideWithValue(config),
          sharedPreferencesProvider.overrideWithValue(prefs),
        ],
        child: const MyApp(),
      ),
    );

    await tester.pumpAndSettle();
    expect(find.byType(AppShell), findsOneWidget);
  });
}
