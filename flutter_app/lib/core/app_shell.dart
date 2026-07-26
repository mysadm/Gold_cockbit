import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'language_preference.dart';
import '../l10n/strings.dart';
import '../features/market/presentation/market_screen.dart';
import '../features/market/application/market_providers.dart';
import '../features/calculator/presentation/calculator_screen.dart';
import '../features/scenarios/presentation/scenarios_screen.dart';
import '../features/tranches/presentation/tranches_screen.dart';
import '../features/watchlist/presentation/watchlist_screen.dart';
import '../features/egypt_prices/presentation/egypt_prices_screen.dart';
import '../features/ai_analyst/presentation/ai_analyst_screen.dart';
import '../features/llm_providers/presentation/llm_providers_screen.dart';
import 'setup_screen.dart';

class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _selectedIndex = 0;

  @override
  Widget build(BuildContext context) {
    final language = ref.watch(languageProvider);
    final strings = Strings(language);

    final marketAsync = ref.watch(marketSnapshotProvider(0));
    final spot = marketAsync.value?.spotUsd ?? 0;
    final usdEgp = marketAsync.value?.usdEgp ?? 0;
    final gramPrices = marketAsync.value?.gramPrices;

    final destinations = <_ShellDestination>[
      _ShellDestination(strings.marketTab, const MarketScreen()),
      _ShellDestination(strings.scenariosTab, ScenariosScreen(spot: spot)),
      _ShellDestination(strings.dcaTab, const TranchesScreen()),
      _ShellDestination(strings.watchTab, const WatchlistScreen()),
      _ShellDestination(
        strings.calcTab,
        CalculatorScreen(
          gram24k: gramPrices?.g24 ?? 0,
          gram21k: gramPrices?.g21 ?? 0,
          gram18k: gramPrices?.g18 ?? 0,
        ),
      ),
      _ShellDestination(strings.egyptTab, const EgyptPricesScreen()),
      _ShellDestination(strings.aiTab, AiAnalystScreen(spot: spot, usdEgp: usdEgp)),
      _ShellDestination(strings.settingsTab, const LlmProvidersScreen()),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Text(destinations[_selectedIndex].label),
        actions: [
          IconButton(
            key: const Key('languageToggle'),
            icon: const Icon(Icons.translate),
            onPressed: () {
              final next = language == AppLanguage.en ? AppLanguage.ar : AppLanguage.en;
              ref.read(languageProvider.notifier).setLanguage(next);
            },
          ),
        ],
      ),
      drawer: Drawer(
        child: ListView(
          children: [
            DrawerHeader(child: Text(strings.title)),
            for (var i = 0; i < destinations.length; i++)
              ListTile(
                title: Text(destinations[i].label),
                selected: i == _selectedIndex,
                onTap: () {
                  setState(() => _selectedIndex = i);
                  Navigator.pop(context);
                },
              ),
            const Divider(),
            ListTile(
              key: const Key('connectionSettingsTile'),
              leading: const Icon(Icons.settings_ethernet),
              title: Text(strings.connectionSettingsMenuItem),
              onTap: () {
                Navigator.pop(context);
                Navigator.of(context).push(
                  MaterialPageRoute(builder: (_) => const SetupScreen()),
                );
              },
            ),
          ],
        ),
      ),
      body: destinations[_selectedIndex].screen,
    );
  }
}

class _ShellDestination {
  final String label;
  final Widget screen;
  const _ShellDestination(this.label, this.screen);
}
