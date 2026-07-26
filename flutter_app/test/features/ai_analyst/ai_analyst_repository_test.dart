import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/ai_analyst/data/ai_analyst_repository.dart';
import 'package:gold_cockpit_mobile/features/scenarios/data/scenarios_repository.dart';
import 'package:gold_cockpit_mobile/features/watchlist/data/watchlist_repository.dart';

void main() {
  group('AnalysisResult.fromJson', () {
    test('parses a full analysis JSON payload', () {
      final json = jsonDecode('''
      {
        "one_liner": "Hedge holding steady",
        "trends": ["Fed pivot expected", "CB buying continues"],
        "suggested_weights": {"deesc": 30, "base": 50, "stag": 20},
        "weights_reasoning": "CB buying dominates",
        "tranche2": {"verdict": "deploy", "reasoning": "Window is open"},
        "egp_read": "Pound stable this week"
      }
      ''') as Map<String, dynamic>;

      final result = AnalysisResult.fromJson(json);

      expect(result.oneLiner, 'Hedge holding steady');
      expect(result.trends, hasLength(2));
      expect(result.suggestedWeights, {'deesc': 30, 'base': 50, 'stag': 20});
      expect(result.trancheVerdict, 'deploy');
      expect(result.egpRead, 'Pound stable this week');
    });

    test('tolerates missing optional fields', () {
      final result = AnalysisResult.fromJson({'one_liner': 'Minimal'});
      expect(result.oneLiner, 'Minimal');
      expect(result.trends, isEmpty);
      expect(result.suggestedWeights, isNull);
      expect(result.trancheVerdict, isNull);
    });
  });

  group('buildAnalysisPrompt', () {
    test('includes spot, EGP rate, scenario weights, and watchlist in the prompt', () {
      final scenarios = [
        Scenario(id: 1, name: 'De-escalation', bandLow: 5800, bandHigh: 6300, weightPct: 35, probabilityPct: null, sortOrder: 0),
      ];
      final watchlist = [
        WatchlistItem(id: 1, label: 'Oil prices', status: 'support', sortOrder: 0),
      ];

      final prompt = buildAnalysisPrompt(
        spot: 5000,
        usdEgp: 50,
        scenarios: scenarios,
        watchlist: watchlist,
        langName: 'English',
      );

      expect(prompt, contains('5000'));
      expect(prompt, contains('50'));
      expect(prompt, contains('De-escalation'));
      expect(prompt, contains('Oil prices'));
    });
  });
}
