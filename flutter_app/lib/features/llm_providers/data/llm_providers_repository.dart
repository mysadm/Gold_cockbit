import 'package:dio/dio.dart';

class LlmProvider {
  final int id;
  final String providerType;
  final String label;
  final String? baseUrl;
  final String model;
  final bool isActive;

  const LlmProvider({
    required this.id,
    required this.providerType,
    required this.label,
    required this.baseUrl,
    required this.model,
    required this.isActive,
  });

  factory LlmProvider.fromJson(Map<String, dynamic> json) {
    return LlmProvider(
      id: int.parse(json['id'].toString()),
      providerType: json['provider_type'] as String,
      label: json['label'] as String,
      baseUrl: json['base_url'] as String?,
      model: json['model'] as String,
      isActive: json['is_active'] as bool,
    );
  }
}

class LlmProvidersRepository {
  Future<List<LlmProvider>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/llm-providers');
    return (response.data as List).map((row) => LlmProvider.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<LlmProvider> create(
    Dio dio, {
    required String providerType,
    required String label,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.post('/api/llm-providers', data: {
      'provider_type': providerType,
      'label': label,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<LlmProvider> update(
    Dio dio,
    int id, {
    required String providerType,
    required String label,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.put('/api/llm-providers/$id', data: {
      'provider_type': providerType,
      'label': label,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> delete(Dio dio, int id) => dio.delete('/api/llm-providers/$id');

  Future<LlmProvider> activate(Dio dio, int id) async {
    final response = await dio.post('/api/llm-providers/$id/activate');
    return LlmProvider.fromJson(response.data as Map<String, dynamic>);
  }

  Future<String> test(
    Dio dio, {
    required String providerType,
    String? baseUrl,
    String? apiKey,
    required String model,
  }) async {
    final response = await dio.post('/api/llm-providers/test', data: {
      'provider_type': providerType,
      'base_url': baseUrl,
      'api_key': apiKey,
      'model': model,
    });
    return response.data['text'] as String;
  }
}
