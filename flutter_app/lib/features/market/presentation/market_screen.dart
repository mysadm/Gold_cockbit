import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../application/market_providers.dart';
import '../../../l10n/strings.dart';

class MarketScreen extends ConsumerWidget {
  const MarketScreen({super.key, this.premiumPct = 0});

  final double premiumPct;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    const strings = Strings(AppLanguage.en);
    final snapshotAsync = ref.watch(marketSnapshotProvider(premiumPct));

    return snapshotAsync.when(
      data: (snapshot) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('${strings.ounce}: \$${snapshot.spotUsd.toStringAsFixed(0)} (${snapshot.spotSource})'),
          const SizedBox(height: 8),
          Text('${strings.g24}: ${snapshot.gramPrices.g24.toStringAsFixed(0)} EGP'),
          Text('${strings.g21}: ${snapshot.gramPrices.g21.toStringAsFixed(0)} EGP'),
          Text('${strings.g18}: ${snapshot.gramPrices.g18.toStringAsFixed(0)} EGP'),
          Text('${strings.goldPound}: ${snapshot.gramPrices.goldPound.toStringAsFixed(0)} EGP'),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}
