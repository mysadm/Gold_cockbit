import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/llm_providers_providers.dart' show llmProvidersRepositoryProvider, llmProvidersListProvider, apiClientProvider;

class LlmProvidersScreen extends ConsumerStatefulWidget {
  const LlmProvidersScreen({super.key});

  @override
  ConsumerState<LlmProvidersScreen> createState() => _LlmProvidersScreenState();
}

class _LlmProvidersScreenState extends ConsumerState<LlmProvidersScreen> {
  final _labelController = TextEditingController();
  final _modelController = TextEditingController();
  final _baseUrlController = TextEditingController();
  final _apiKeyController = TextEditingController();
  String _providerType = 'claude';

  @override
  void dispose() {
    _labelController.dispose();
    _modelController.dispose();
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final providersAsync = ref.watch(llmProvidersListProvider);
    final repository = ref.watch(llmProvidersRepositoryProvider);
    final dio = ref.watch(apiClientProvider).dio;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        providersAsync.when(
          data: (providers) => Column(
            children: [
              for (final provider in providers)
                ListTile(
                  title: Text(provider.label),
                  subtitle: Text('${provider.providerType} · ${provider.model}'),
                  trailing: Wrap(
                    spacing: 8,
                    children: [
                      if (provider.isActive)
                        const Chip(label: Text('Active'))
                      else
                        TextButton(
                          onPressed: () async {
                            await repository.activate(dio, provider.id);
                            ref.invalidate(llmProvidersListProvider);
                          },
                          child: const Text('Set active'),
                        ),
                      IconButton(
                        icon: const Icon(Icons.delete),
                        onPressed: () async {
                          await repository.delete(dio, provider.id);
                          ref.invalidate(llmProvidersListProvider);
                        },
                      ),
                    ],
                  ),
                ),
            ],
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) => Text('$error'),
        ),
        const Divider(),
        DropdownButton<String>(
          value: _providerType,
          items: const [
            DropdownMenuItem(value: 'claude', child: Text('Claude')),
            DropdownMenuItem(value: 'openai', child: Text('OpenAI')),
            DropdownMenuItem(value: 'ollama', child: Text('Ollama (local)')),
            DropdownMenuItem(value: 'custom', child: Text('Custom')),
          ],
          onChanged: (value) => setState(() => _providerType = value ?? _providerType),
        ),
        TextField(controller: _labelController, decoration: const InputDecoration(labelText: 'Label')),
        TextField(controller: _modelController, decoration: const InputDecoration(labelText: 'Model')),
        TextField(controller: _baseUrlController, decoration: const InputDecoration(labelText: 'Base URL')),
        TextField(
          controller: _apiKeyController,
          decoration: const InputDecoration(labelText: 'API key'),
          obscureText: true,
        ),
        ElevatedButton(
          key: const Key('saveProviderButton'),
          onPressed: () async {
            await repository.create(
              dio,
              providerType: _providerType,
              label: _labelController.text,
              baseUrl: _baseUrlController.text.isEmpty ? null : _baseUrlController.text,
              apiKey: _apiKeyController.text.isEmpty ? null : _apiKeyController.text,
              model: _modelController.text,
            );
            ref.invalidate(llmProvidersListProvider);
          },
          child: const Text('Save'),
        ),
      ],
    );
  }
}
