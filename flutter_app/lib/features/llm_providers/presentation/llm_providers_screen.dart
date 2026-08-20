import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/app_theme.dart';
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

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('AI Model Settings', style: AppTextStyles.title(size: 15)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: AppDecorations.panel,
            child: providersAsync.when(
              data: (providers) => Column(
                children: [
                  for (final provider in providers)
                    Container(
                      margin: const EdgeInsets.only(bottom: 8),
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: provider.isActive ? const Color(0xFFF3FBF4) : const Color(0xFFFDFDFD),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Row(
                        children: [
                          if (provider.isActive)
                            const Chip(label: Text('Active'))
                          else
                            OutlinedButton(
                              onPressed: () async {
                                try {
                                  await repository.activate(dio, provider.id);
                                  if (!context.mounted) return;
                                  ref.invalidate(llmProvidersListProvider);
                                } catch (e) {
                                  if (!context.mounted) return;
                                  ScaffoldMessenger.of(context).showSnackBar(
                                    SnackBar(content: Text('Error activating provider: $e')),
                                  );
                                }
                              },
                              child: const Text('Set active'),
                            ),
                          const SizedBox(width: 8),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(provider.label, style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.bold, size: 13)),
                                Text('${provider.providerType} · ${provider.model}',
                                    style: AppTextStyles.label(color: AppColors.lightGray, size: 11)),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.delete, color: AppColors.gray),
                            onPressed: () async {
                              try {
                                await repository.delete(dio, provider.id);
                                if (!context.mounted) return;
                                ref.invalidate(llmProvidersListProvider);
                              } catch (e) {
                                if (!context.mounted) return;
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Error deleting provider: $e')),
                                );
                              }
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
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(16),
            decoration: AppDecorations.panel,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Add / Edit Provider', style: AppTextStyles.title(size: 14)),
                const SizedBox(height: 12),
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
                const SizedBox(height: 12),
                Row(
                  spacing: 8,
                  children: [
                    Expanded(
                      child: FilledButton(
                        key: const Key('saveProviderButton'),
                        onPressed: () async {
                          try {
                            await repository.create(
                              dio,
                              providerType: _providerType,
                              label: _labelController.text,
                              baseUrl: _baseUrlController.text.isEmpty ? null : _baseUrlController.text,
                              apiKey: _apiKeyController.text.isEmpty ? null : _apiKeyController.text,
                              model: _modelController.text,
                            );
                            if (!context.mounted) return;
                            ref.invalidate(llmProvidersListProvider);
                            _labelController.clear();
                            _modelController.clear();
                            _baseUrlController.clear();
                            _apiKeyController.clear();
                          } catch (e) {
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Error creating provider: $e')),
                            );
                          }
                        },
                        child: const Text('Save'),
                      ),
                    ),
                    Expanded(
                      child: OutlinedButton(
                        key: const Key('testConnectionButton'),
                        onPressed: () async {
                          try {
                            final result = await repository.test(
                              dio,
                              providerType: _providerType,
                              baseUrl: _baseUrlController.text.isEmpty ? null : _baseUrlController.text,
                              apiKey: _apiKeyController.text.isEmpty ? null : _apiKeyController.text,
                              model: _modelController.text,
                            );
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Connection successful: $result')),
                            );
                          } catch (e) {
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(content: Text('Connection failed: $e')),
                            );
                          }
                        },
                        child: const Text('Test'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
