import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/tranches_providers.dart';

class TranchesScreen extends ConsumerWidget {
  const TranchesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tranchesAsync = ref.watch(tranchesListProvider);

    return tranchesAsync.when(
      data: (tranches) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          for (final tranche in tranches)
            ListTile(
              title: Text('Tranche ${tranche.trancheNumber} · ${tranche.planPct.toStringAsFixed(0)}%'),
              subtitle: Text(tranche.status),
              trailing: tranche.amountEgp != null ? Text('${tranche.amountEgp!.toStringAsFixed(0)} EGP') : null,
            ),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
