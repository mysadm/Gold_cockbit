import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/domain.dart';
import '../application/scenarios_providers.dart';

class ScenariosScreen extends ConsumerWidget {
  const ScenariosScreen({super.key, this.spot = 0});

  final double spot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scenariosAsync = ref.watch(scenariosListProvider);

    return scenariosAsync.when(
      data: (scenarios) {
        final weights = scenarios.map((s) => s.weightPct).toList();
        final weightedTarget = spot > 0 ? calculateWeightedTarget(weights, spot) : 0.0;

        return ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (spot > 0) Text('Weighted target: \$${weightedTarget.toStringAsFixed(0)}'),
            const SizedBox(height: 8),
            for (final scenario in scenarios)
              ListTile(
                title: Text(scenario.name),
                subtitle: scenario.bandLow != null && scenario.bandHigh != null
                    ? Text('\$${scenario.bandLow!.toStringAsFixed(0)}–\$${scenario.bandHigh!.toStringAsFixed(0)}')
                    : null,
                trailing: Text('${scenario.weightPct.toStringAsFixed(0)}%'),
              ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
