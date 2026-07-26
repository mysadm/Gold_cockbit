import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/egypt_prices_providers.dart';

class EgyptPricesScreen extends ConsumerWidget {
  const EgyptPricesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotAsync = ref.watch(egyptPricesProvider);

    return snapshotAsync.when(
      data: (snapshot) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('Source: ${snapshot.source}'),
          const SizedBox(height: 8),
          for (final row in snapshot.rows)
            ListTile(
              title: Text(row.karat),
              subtitle: Text('Sell ${row.sell.toStringAsFixed(0)} · Buy ${row.buy.toStringAsFixed(0)}'),
              trailing: row.changePct != null ? Text('${row.changePct!.toStringAsFixed(2)}%') : null,
            ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
