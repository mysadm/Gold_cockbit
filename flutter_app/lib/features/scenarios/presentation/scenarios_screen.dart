import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/app_theme.dart';
import '../../../core/domain.dart';
import '../application/scenarios_providers.dart';

class ScenariosScreen extends ConsumerWidget {
  const ScenariosScreen({super.key, this.spot = 0});

  final double spot;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final scenariosAsync = ref.watch(scenariosListProvider);

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: scenariosAsync.when(
        data: (scenarios) {
          final weights = scenarios.map((s) => s.weightPct).toList();
          final weightedTarget = spot > 0 ? calculateWeightedTarget(weights, spot) : 0.0;

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (spot > 0)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(20),
                  decoration: AppDecorations.panel,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text('PROBABILITY-WEIGHTED TARGET', style: AppTextStyles.label()),
                      const SizedBox(height: 6),
                      Text('\$${weightedTarget.toStringAsFixed(0)}', style: AppTextStyles.heroNumber(size: 40)),
                    ],
                  ),
                ),
              const SizedBox(height: 16),
              for (final scenario in scenarios)
                Container(
                  margin: const EdgeInsets.only(bottom: 12),
                  padding: const EdgeInsets.all(16),
                  decoration: AppDecorations.panel,
                  child: Row(
                    children: [
                      Text('${scenario.weightPct.toStringAsFixed(0)}%',
                          style: AppTextStyles.number(size: 22, color: AppColors.green)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(scenario.name, style: AppTextStyles.title(size: 15)),
                            if (scenario.bandLow != null && scenario.bandHigh != null)
                              Text(
                                '\$${scenario.bandLow!.toStringAsFixed(0)}–\$${scenario.bandHigh!.toStringAsFixed(0)}',
                                style: AppTextStyles.number(size: 12, color: AppColors.gray),
                              ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('$error')),
      ),
    );
  }
}
