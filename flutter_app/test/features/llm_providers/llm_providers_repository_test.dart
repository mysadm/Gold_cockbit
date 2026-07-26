import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/llm_providers/data/llm_providers_repository.dart';

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
}
