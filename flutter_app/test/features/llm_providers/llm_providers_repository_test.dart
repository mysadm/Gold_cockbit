import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/llm_providers/data/llm_providers_repository.dart';
import 'package:mocktail/mocktail.dart';

class MockDio extends Mock implements Dio {}

void main() {
  group('LlmProvider.fromJson', () {
    test('parses a provider row from the API', () {
      final provider = LlmProvider.fromJson({
        'id': 1,
        'provider_type': 'claude',
        'label': 'Claude prod',
        'base_url': null,
        'model': 'claude-sonnet-4-6',
        'is_active': true,
      });

      expect(provider.id, 1);
      expect(provider.providerType, 'claude');
      expect(provider.isActive, isTrue);
      expect(provider.baseUrl, isNull);
    });
  });

  group('LlmProvidersRepository.test', () {
    late MockDio mockDio;
    late LlmProvidersRepository repository;

    setUp(() {
      mockDio = MockDio();
      repository = LlmProvidersRepository();
    });

    test('posts correct payload to /api/llm-providers/test and returns text', () async {
      final mockResponse = Response(
        data: {'text': 'Connection successful!'},
        statusCode: 200,
        requestOptions: RequestOptions(path: '/api/llm-providers/test'),
      );

      when(() => mockDio.post(
        '/api/llm-providers/test',
        data: any(named: 'data'),
      )).thenAnswer((_) async => mockResponse);

      final result = await repository.test(
        mockDio,
        providerType: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-test-key',
        model: 'claude-sonnet-4-6',
      );

      expect(result, 'Connection successful!');
      verify(() => mockDio.post(
        '/api/llm-providers/test',
        data: {
          'provider_type': 'claude',
          'base_url': 'https://api.anthropic.com',
          'api_key': 'sk-test-key',
          'model': 'claude-sonnet-4-6',
        },
      )).called(1);
    });

    test('handles test with null baseUrl and apiKey', () async {
      final mockResponse = Response(
        data: {'text': 'Test result'},
        statusCode: 200,
        requestOptions: RequestOptions(path: '/api/llm-providers/test'),
      );

      when(() => mockDio.post(
        '/api/llm-providers/test',
        data: any(named: 'data'),
      )).thenAnswer((_) async => mockResponse);

      final result = await repository.test(
        mockDio,
        providerType: 'ollama',
        model: 'llama2',
      );

      expect(result, 'Test result');
      verify(() => mockDio.post(
        '/api/llm-providers/test',
        data: {
          'provider_type': 'ollama',
          'base_url': null,
          'api_key': null,
          'model': 'llama2',
        },
      )).called(1);
    });
  });
}
