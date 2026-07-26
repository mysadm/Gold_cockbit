import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/api_client.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';

class FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

void main() {
  group('applyAuth', () {
    test('sets baseUrl from config and no x-api-key header when apiKey is unset', () async {
      final config = AppConfig(FakeSecureStore());
      final options = RequestOptions(path: '/api/scenarios');

      await applyAuth(options, config);

      expect(options.baseUrl, AppConfig.defaultBaseUrl);
      expect(options.headers.containsKey('x-api-key'), isFalse);
    });

    test('sets x-api-key header when apiKey is configured', () async {
      final config = AppConfig(FakeSecureStore());
      await config.setApiKey('secret-123');
      final options = RequestOptions(path: '/api/scenarios');

      await applyAuth(options, config);

      expect(options.headers['x-api-key'], 'secret-123');
    });
  });

  group('ApiClient', () {
    test('exposes a Dio instance with the auth interceptor attached', () {
      final client = ApiClient(AppConfig(FakeSecureStore()));
      expect(client.dio, isA<Dio>());
      expect(client.dio.interceptors, isNotEmpty);
    });
  });
}
