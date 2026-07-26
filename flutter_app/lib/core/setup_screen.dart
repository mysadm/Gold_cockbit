import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app_config.dart';
import 'app_shell.dart';
import 'secure_store.dart';
import '../l10n/strings.dart';

final appConfigProvider = Provider<AppConfig>((ref) => AppConfig(const FlutterSecureStore()));

class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key});

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  final _baseUrlController = TextEditingController(text: AppConfig.defaultBaseUrl);
  final _apiKeyController = TextEditingController();

  @override
  void dispose() {
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const strings = Strings(AppLanguage.en);
    final config = ref.watch(appConfigProvider);

    return Scaffold(
      appBar: AppBar(title: Text(strings.connectionSetupHeading)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            TextField(
              key: const Key('baseUrlField'),
              controller: _baseUrlController,
              decoration: InputDecoration(labelText: strings.baseUrlFieldLabel),
            ),
            TextField(
              key: const Key('apiKeyField'),
              controller: _apiKeyController,
              decoration: InputDecoration(labelText: strings.apiKeyFieldLabel),
              obscureText: true,
            ),
            const SizedBox(height: 16),
            ElevatedButton(
              key: const Key('saveButton'),
              onPressed: () async {
                final ctx = context;
                await config.setBaseUrl(_baseUrlController.text);
                if (_apiKeyController.text.isNotEmpty) {
                  await config.setApiKey(_apiKeyController.text);
                }
                if (mounted) {
                  // ignore: use_build_context_synchronously
                  Navigator.of(ctx).pushReplacement(
                    MaterialPageRoute(builder: (_) => const AppShell()),
                  );
                }
              },
              child: Text(strings.saveButton),
            ),
          ],
        ),
      ),
    );
  }
}
