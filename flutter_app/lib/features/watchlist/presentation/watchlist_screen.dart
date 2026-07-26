import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../scenarios/application/scenarios_providers.dart' show apiClientProvider;
import '../application/watchlist_providers.dart';
import '../data/watchlist_repository.dart';

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

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Expanded(
                child: TextField(
                  key: const Key('newItemField'),
                  controller: _newItemController,
                  decoration: const InputDecoration(hintText: 'New variable…'),
                ),
              ),
              IconButton(
                key: const Key('addButton'),
                icon: const Icon(Icons.add),
                onPressed: () async {
                  if (_newItemController.text.trim().isEmpty) return;
                  await repository.create(dio, label: _newItemController.text.trim(), status: 'watch');
                  _newItemController.clear();
                  ref.invalidate(watchlistListProvider);
                },
              ),
            ],
          ),
        ),
        Expanded(
          child: itemsAsync.when(
            data: (items) => ListView(
              children: [
                for (final item in items)
                  ListTile(
                    title: Text(item.label),
                    subtitle: Text(item.status),
                    onTap: () async {
                      await repository.updateStatus(dio, item.id, nextStatus(item.status));
                      ref.invalidate(watchlistListProvider);
                    },
                    trailing: IconButton(
                      icon: const Icon(Icons.close),
                      onPressed: () async {
                        await repository.delete(dio, item.id);
                        ref.invalidate(watchlistListProvider);
                      },
                    ),
                  ),
              ],
            ),
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, stack) => Center(child: Text('$error')),
          ),
        ),
      ],
    );
  }
}
