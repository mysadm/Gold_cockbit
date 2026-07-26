import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'secure_store.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig(const FlutterSecureStore()));

class AppConfig {
  AppConfig(this._store);

  static const _baseUrlKey = 'gold_cockpit_base_url';
  static const _apiKeyKey = 'gold_cockpit_api_key';
  static const defaultBaseUrl = 'http://localhost:8787';

  final SecureStore _store;

  Future<String> get baseUrl async => (await _store.read(_baseUrlKey)) ?? defaultBaseUrl;

  Future<void> setBaseUrl(String value) => _store.write(_baseUrlKey, value);

  Future<String?> get apiKey => _store.read(_apiKeyKey);

  Future<void> setApiKey(String value) => _store.write(_apiKeyKey, value);

  Future<bool> get isConfigured async => (await _store.read(_baseUrlKey)) != null;
}
