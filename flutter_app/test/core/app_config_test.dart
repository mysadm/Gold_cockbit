// flutter_app/test/core/app_config_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async {
    _values[key] = value;
  }
}

void main() {
  group('AppConfig', () {
    test('baseUrl defaults to defaultBaseUrl when unset', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.baseUrl, AppConfig.defaultBaseUrl);
    });

    test('setBaseUrl persists and is read back', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setBaseUrl('http://192.168.1.10:8787');
      expect(await config.baseUrl, 'http://192.168.1.10:8787');
    });

    test('apiKey is null when unset', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.apiKey, isNull);
    });

    test('setApiKey persists and is read back', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setApiKey('secret-123');
      expect(await config.apiKey, 'secret-123');
    });

    test('isConfigured is false when no base URL has been explicitly set', () async {
      final config = AppConfig(FakeSecureStore());
      expect(await config.isConfigured, isFalse);
    });

    test('isConfigured is true once a base URL is explicitly set', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setBaseUrl('http://192.168.1.10:8787');
      expect(await config.isConfigured, isTrue);
    });
  });
}
