import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'language_preference.dart';
import '../l10n/strings.dart';
import '../features/market/presentation/market_screen.dart';

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

    final destinations = <_ShellDestination>[
      _ShellDestination(strings.marketTab, const MarketScreen()),
      _ShellDestination(strings.scenariosTab, const Placeholder()),
      _ShellDestination(strings.dcaTab, const Placeholder()),
      _ShellDestination(strings.watchTab, const Placeholder()),
      _ShellDestination(strings.calcTab, const Placeholder()),
      _ShellDestination(strings.egyptTab, const Placeholder()),
      _ShellDestination(strings.aiTab, const Placeholder()),
      _ShellDestination(strings.settingsTab, const Placeholder()),
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
