import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
import '../../../core/app_theme.dart';
import '../../scenarios/application/scenarios_providers.dart';
import '../../watchlist/application/watchlist_providers.dart';
import '../application/ai_analyst_providers.dart';
import '../data/ai_analyst_repository.dart';

class AiAnalystScreen extends ConsumerStatefulWidget {
  const AiAnalystScreen({super.key, this.spot = 0, this.usdEgp = 0});

  final double spot;
  final double usdEgp;

  @override
  ConsumerState<AiAnalystScreen> createState() => _AiAnalystScreenState();
}

class _AiAnalystScreenState extends ConsumerState<AiAnalystScreen> {
  AnalysisResult? _result;
  String? _error;
  bool _loading = false;

  Future<void> _analyze() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final scenarios = await ref.read(scenariosListProvider.future);
      final watchlist = await ref.read(watchlistListProvider.future);
      final prompt = buildAnalysisPrompt(
        spot: widget.spot,
        usdEgp: widget.usdEgp,
        scenarios: scenarios,
        watchlist: watchlist,
        langName: 'English',
      );
      final repository = ref.read(aiAnalystRepositoryProvider);
      final dio = ref.read(apiClientProvider).dio;
      final result = await repository.analyze(dio, prompt);
      setState(() => _result = result);
    } catch (error) {
      setState(() => _error = '$error');
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final result = _result;

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('AI ANALYST', style: AppTextStyles.label()),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: AppDecorations.panel,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                FilledButton(
                  key: const Key('analyzeButton'),
                  onPressed: _loading ? null : _analyze,
                  child: Text(_loading ? 'Analyzing…' : '⚡ Analyze the market'),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: AppTextStyles.label(color: AppColors.red, size: 12)),
                ],
                if (result != null) ...[
                  const SizedBox(height: 16),
                  Text(result.oneLiner, style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.bold, size: 14)),
                  const SizedBox(height: 12),
                  Text('WHAT MOVED THE MARKET', style: AppTextStyles.label()),
                  const SizedBox(height: 4),
                  for (final trend in result.trends)
                    Text('• $trend', style: AppTextStyles.label(color: AppColors.gray, size: 13)),
                  if (result.weightsReasoning != null) ...[
                    const SizedBox(height: 12),
                    Text('SUGGESTED WEIGHTS', style: AppTextStyles.label()),
                    const SizedBox(height: 4),
                    Text(result.weightsReasoning!, style: AppTextStyles.label(color: AppColors.gray, size: 13)),
                  ],
                  if (result.trancheReasoning != null) ...[
                    const SizedBox(height: 12),
                    Text('TRANCHE 2 CALL · ${result.trancheVerdict ?? ''}',
                        style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.w600, size: 12)),
                    const SizedBox(height: 4),
                    Text(result.trancheReasoning!, style: AppTextStyles.label(color: AppColors.gray, size: 13)),
                  ],
                  if (result.egpRead != null) ...[
                    const SizedBox(height: 12),
                    Text('EGP READ', style: AppTextStyles.label()),
                    const SizedBox(height: 4),
                    Text(result.egpRead!, style: AppTextStyles.label(color: AppColors.gray, size: 13)),
                  ],
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}
