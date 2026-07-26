import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/core/setup_screen.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  testWidgets('saving the form persists base URL and API key', (tester) async {
    final store = FakeSecureStore();
    final config = AppConfig(store);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [appConfigProvider.overrideWithValue(config)],
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
}
