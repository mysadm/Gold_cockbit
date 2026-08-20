import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/market_providers.dart';
import '../../../core/app_theme.dart';
import '../../../core/language_preference.dart';
import '../../../l10n/strings.dart';

class MarketScreen extends ConsumerWidget {
  const MarketScreen({super.key, this.premiumPct = 0});

  final double premiumPct;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strings = Strings(ref.watch(languageProvider));
    final snapshotAsync = ref.watch(marketSnapshotProvider(premiumPct));

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: snapshotAsync.when(
        data: (snapshot) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Container(
              padding: const EdgeInsets.all(1),
              decoration: AppDecorations.panel,
              child: Column(
                children: [
                  ClipRRect(
                    borderRadius: const BorderRadius.vertical(top: Radius.circular(15)),
                    child: Container(
                      padding: const EdgeInsets.all(14),
                      decoration: AppDecorations.cell(hero: true),
                      width: double.infinity,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(strings.ounce, style: AppTextStyles.label()),
                          const SizedBox(height: 3),
                          Text(
                            '\$${snapshot.spotUsd.toStringAsFixed(2)}',
                            style: AppTextStyles.number(size: 18),
                          ),
                          const SizedBox(height: 3),
                          Text(strings.ounceConversionNote, style: AppTextStyles.label(color: AppColors.lightGray, size: 10)),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 1),
                  Row(
                    children: [
                      Expanded(child: _PriceCell(label: strings.g24, value: snapshot.gramPrices.g24, note: strings.inclPremiumNote)),
                      const SizedBox(width: 1),
                      Expanded(child: _PriceCell(label: strings.g21, value: snapshot.gramPrices.g21, note: strings.inclPremiumNote)),
                      const SizedBox(width: 1),
                      Expanded(child: _PriceCell(label: strings.g18, value: snapshot.gramPrices.g18, note: strings.inclPremiumNote)),
                      const SizedBox(width: 1),
                      Expanded(child: _PriceCell(label: strings.goldPound, value: snapshot.gramPrices.goldPound, note: strings.goldPoundNote)),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: () => ref.invalidate(marketSnapshotProvider(premiumPct)),
              child: Text(strings.pullLiveMarket),
            ),
          ],
        ),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('$error')),
      ),
    );
  }
}

class _PriceCell extends StatelessWidget {
  const _PriceCell({required this.label, required this.value, required this.note});

  final String label;
  final double value;
  final String note;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: AppDecorations.cell(),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: AppTextStyles.label()),
          const SizedBox(height: 3),
          Text(value.toStringAsFixed(0), style: AppTextStyles.number(size: 16)),
          const SizedBox(height: 3),
          Text(note, style: AppTextStyles.label(color: AppColors.lightGray, size: 10)),
        ],
      ),
    );
  }
}
