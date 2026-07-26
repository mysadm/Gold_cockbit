import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart';
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

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        ElevatedButton(
          key: const Key('analyzeButton'),
          onPressed: _loading ? null : _analyze,
          child: Text(_loading ? 'Analyzing…' : 'Analyze the market'),
        ),
        if (_error != null) Text(_error!, style: const TextStyle(color: Colors.red)),
        if (result != null) ...[
          const SizedBox(height: 16),
          Text(result.oneLiner, style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('What moved the market', style: TextStyle(fontWeight: FontWeight.w600)),
          for (final trend in result.trends) Text('• $trend'),
          if (result.weightsReasoning != null) ...[
            const SizedBox(height: 8),
            const Text('Suggested weights', style: TextStyle(fontWeight: FontWeight.w600)),
            Text(result.weightsReasoning!),
          ],
          if (result.trancheReasoning != null) ...[
            const SizedBox(height: 8),
            Text('Tranche 2 call: ${result.trancheVerdict ?? ''}', style: const TextStyle(fontWeight: FontWeight.w600)),
            Text(result.trancheReasoning!),
          ],
          if (result.egpRead != null) ...[
            const SizedBox(height: 8),
            const Text('EGP read', style: TextStyle(fontWeight: FontWeight.w600)),
            Text(result.egpRead!),
          ],
        ],
      ],
    );
  }
}
