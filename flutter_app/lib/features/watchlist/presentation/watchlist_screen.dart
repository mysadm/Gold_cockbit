import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../../../core/app_theme.dart';
import '../application/watchlist_providers.dart';
import '../data/watchlist_repository.dart';

const Map<String, Color> _statusColors = {
  'support': AppColors.green,
  'watch': AppColors.gold,
  'risk': AppColors.red,
};

class WatchlistScreen extends ConsumerStatefulWidget {
  const WatchlistScreen({super.key});

  @override
  ConsumerState<WatchlistScreen> createState() => _WatchlistScreenState();
}

class _WatchlistScreenState extends ConsumerState<WatchlistScreen> {
  final _newItemController = TextEditingController();

  @override
  void dispose() {
    _newItemController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final itemsAsync = ref.watch(watchlistListProvider);
    final repository = ref.watch(watchlistRepositoryProvider);
    final dio = ref.watch(apiClientProvider).dio;

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(
                  child: TextField(
                    key: const Key('newItemField'),
                    controller: _newItemController,
                    style: AppTextStyles.label(color: AppColors.dark, size: 13),
                    decoration: const InputDecoration(hintText: 'New variable…'),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(
                  key: const Key('addButton'),
                  onPressed: () async {
                    if (_newItemController.text.trim().isEmpty) return;
                    try {
                      await repository.create(dio, label: _newItemController.text.trim(), status: 'watch');
                      if (!context.mounted) return;
                      _newItemController.clear();
                      ref.invalidate(watchlistListProvider);
                    } catch (e) {
                      if (!context.mounted) return;
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text('Error adding item: $e')),
                      );
                    }
                  },
                  child: const Icon(Icons.add, size: 18),
                ),
              ],
            ),
          ),
          Expanded(
            child: itemsAsync.when(
              data: (items) => ListView(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final item in items)
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(999),
                            border: Border.all(color: AppColors.border),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              Container(
                                width: 8,
                                height: 8,
                                margin: const EdgeInsets.only(right: 8),
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: _statusColors[item.status] ?? AppColors.gray,
                                ),
                              ),
                              GestureDetector(
                                onTap: () async {
                                  try {
                                    await repository.updateStatus(dio, item.id, nextStatus(item.status));
                                    if (!context.mounted) return;
                                    ref.invalidate(watchlistListProvider);
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('Error updating item: $e')),
                                    );
                                  }
                                },
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Text(
                                      item.label,
                                      style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.w600, size: 12),
                                    ),
                                    const SizedBox(width: 4),
                                    Text(
                                      '· ${item.status}',
                                      style: AppTextStyles.label(color: AppColors.gray, size: 11),
                                    ),
                                  ],
                                ),
                              ),
                              const SizedBox(width: 8),
                              GestureDetector(
                                onTap: () async {
                                  try {
                                    await repository.delete(dio, item.id);
                                    if (!context.mounted) return;
                                    ref.invalidate(watchlistListProvider);
                                  } catch (e) {
                                    if (!context.mounted) return;
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      SnackBar(content: Text('Error deleting item: $e')),
                                    );
                                  }
                                },
                                child: const Icon(Icons.close, size: 16, color: AppColors.gray),
                              ),
                            ],
                          ),
                        ),
                    ],
                  ),
                ],
              ),
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, stack) => Center(child: Text('$error')),
            ),
          ),
        ],
      ),
    );
  }
}
