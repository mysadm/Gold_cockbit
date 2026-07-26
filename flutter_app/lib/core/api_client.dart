import 'package:dio/dio.dart';
import 'app_config.dart';

Future<void> applyAuth(RequestOptions options, AppConfig config) async {
  options.baseUrl = await config.baseUrl;
  final apiKey = await config.apiKey;
  if (apiKey != null && apiKey.isNotEmpty) {
    options.headers['x-api-key'] = apiKey;
  }
}

class ApiClient {
  ApiClient(this._config) : _dio = Dio() {
    _dio.options.connectTimeout = const Duration(seconds: 15);
    _dio.options.receiveTimeout = const Duration(seconds: 90);
    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          await applyAuth(options, _config);
          handler.next(options);
        },
      ),
    );
  }

  final AppConfig _config;
  final Dio _dio;

  Dio get dio => _dio;
}
