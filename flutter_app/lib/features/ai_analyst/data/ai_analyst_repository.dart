import 'dart:convert';
import 'package:dio/dio.dart';
import '../../scenarios/data/scenarios_repository.dart';
import '../../watchlist/data/watchlist_repository.dart';

class AnalysisResult {
  final String oneLiner;
  final List<String> trends;
  final Map<String, int>? suggestedWeights;
  final String? weightsReasoning;
  final String? trancheVerdict;
  final String? trancheReasoning;
  final String? egpRead;

  const AnalysisResult({
    required this.oneLiner,
    required this.trends,
    required this.suggestedWeights,
    required this.weightsReasoning,
    required this.trancheVerdict,
    required this.trancheReasoning,
    required this.egpRead,
  });

  factory AnalysisResult.fromJson(Map<String, dynamic> json) {
    final tranche2 = json['tranche2'] as Map<String, dynamic>?;
    final suggested = json['suggested_weights'] as Map<String, dynamic>?;

    return AnalysisResult(
      oneLiner: json['one_liner'] as String? ?? '',
      trends: (json['trends'] as List?)?.map((t) => t.toString()).toList() ?? [],
      suggestedWeights: suggested?.map((key, value) => MapEntry(key, (value as num).toInt())),
      weightsReasoning: json['weights_reasoning'] as String?,
      trancheVerdict: tranche2?['verdict'] as String?,
      trancheReasoning: tranche2?['reasoning'] as String?,
      egpRead: json['egp_read'] as String?,
    );
  }
}

String buildAnalysisPrompt({
  required double spot,
  required double usdEgp,
  required List<Scenario> scenarios,
  required List<WatchlistItem> watchlist,
  required String langName,
}) {
  final scenarioContext = scenarios
      .map((s) => '${s.name} (currently weighted ${s.weightPct.toStringAsFixed(0)}%, price band \$${s.bandLow}-\$${s.bandHigh})')
      .join(' | ');
  final watchContext = watchlist.map((w) => '${w.label}=${w.status}').join(', ');

  return '''
You are a senior precious-metals strategist advising a Cairo-based CIO on his personal gold hedge (EGP-denominated savings, 6-12 month horizon).

LIVE COCKPIT STATE (today):
- XAU/USD spot: \$$spot
- USD/EGP: $usdEgp
- Current scenario framework: $scenarioContext
- Watchlist assessment: $watchContext

TASK: Web-search the latest (last 1-2 weeks) on gold price drivers, Fed rate expectations, central-bank buying, and the full breadth of active geopolitical risk (not one conflict). Treat only what you verified via search as fact; mark anything else as background. Prioritize the Egyptian-market angle throughout — the local premium over the international price and the implied "souq-dollar" vs. the official EGP rate — since that's the layer he actually holds. Then produce your analysis in $langName.

Respond with ONLY this JSON (no fences, no preamble). All string values in $langName, concise — short dense sentences, no filler, no restated caveats:
{
 "one_liner": "single sharp sentence: the state of his hedge right now",
 "trends": ["3-4 items, each: what happened + direction of impact on gold"],
 "suggested_weights": {"deesc": int, "base": int, "stag": int},
 "weights_reasoning": "1-2 sentences: why these weights vs his current ones",
 "tranche2": {"verdict": "deploy" | "partial" | "wait", "reasoning": "1-2 sentences with an explicit trigger condition"},
 "egp_read": "1-2 sentences on the Egyptian-market layer of his hedge: local premium and souq-dollar vs. official rate"
}
Weights must sum to 100.
''';
}

class AiAnalystRepository {
  Future<AnalysisResult> analyze(Dio dio, String prompt) async {
    final response = await dio.post('/api/analyze', data: {'prompt': prompt});
    final text = response.data['text'] as String;
    return AnalysisResult.fromJson(jsonDecode(text) as Map<String, dynamic>);
  }
}
