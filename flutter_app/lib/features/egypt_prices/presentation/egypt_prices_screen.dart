import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/app_theme.dart';
import '../application/egypt_prices_providers.dart';

class EgyptPricesScreen extends ConsumerWidget {
  const EgyptPricesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final snapshotAsync = ref.watch(egyptPricesProvider);

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: snapshotAsync.when(
        data: (snapshot) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text('LOCAL EGYPTIAN MARKET PRICES', style: AppTextStyles.label()),
            const SizedBox(height: 12),
            Container(
              decoration: AppDecorations.tableBorder,
              child: Column(
                children: [
                  _Row(cells: const ['Karat', 'Sell', 'Buy'], header: true),
                  for (final row in snapshot.rows)
                    _Row(cells: [
                      row.karat,
                      '${row.sell.toStringAsFixed(0)} EGP',
                      '${row.buy.toStringAsFixed(0)} EGP',
                    ]),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Text('Source: ${snapshot.source}', style: AppTextStyles.label(color: AppColors.lightGray, size: 10)),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('$error')),
      ),
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.cells, this.header = false});

  final List<String> cells;
  final bool header;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: const BoxDecoration(
        color: Colors.white,
        border: Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          for (final cell in cells)
            Expanded(
              child: Text(
                cell,
                style: header
                    ? AppTextStyles.label(weight: FontWeight.bold, size: 11)
                    : (cells.indexOf(cell) == 0
                        ? AppTextStyles.label(color: AppColors.dark, size: 13)
                        : AppTextStyles.number(size: 13)),
              ),
            ),
        ],
      ),
    );
  }
}
