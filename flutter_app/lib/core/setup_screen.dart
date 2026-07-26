import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'app_config.dart';
import 'app_shell.dart';
import '../l10n/strings.dart';

class SetupScreen extends ConsumerStatefulWidget {
  const SetupScreen({super.key});

  @override
  ConsumerState<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends ConsumerState<SetupScreen> {
  final _baseUrlController = TextEditingController(text: AppConfig.defaultBaseUrl);
  final _apiKeyController = TextEditingController();
  String? _urlError;

  @override
  void dispose() {
    _baseUrlController.dispose();
    _apiKeyController.dispose();
    super.dispose();
  }

  /// Returns true (and clears any previous error) if the entered base URL is
  /// well-formed enough to be usable; otherwise sets an inline error and
  /// returns false.
  bool _validateBaseUrl(Strings strings) {
    final text = _baseUrlController.text.trim();
    if (text.isEmpty) {
      setState(() => _urlError = strings.invalidUrlError);
      return false;
    }
    final uri = Uri.tryParse(text);
    final isValid = uri != null &&
        (uri.scheme == 'http' || uri.scheme == 'https') &&
        uri.host.isNotEmpty;
    if (!isValid) {
      setState(() => _urlError = strings.invalidUrlError);
      return false;
    }
    setState(() => _urlError = null);
    return true;
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
              decoration: InputDecoration(
                labelText: strings.baseUrlFieldLabel,
                errorText: _urlError,
              ),
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
                if (!_validateBaseUrl(strings)) {
                  return;
                }
                final ctx = context;
                await config.setBaseUrl(_baseUrlController.text.trim());
                if (_apiKeyController.text.isNotEmpty) {
                  await config.setApiKey(_apiKeyController.text);
                }
                if (mounted) {
                  // ignore: use_build_context_synchronously
                  if (Navigator.of(ctx).canPop()) {
                    // ignore: use_build_context_synchronously
                    Navigator.of(ctx).pop();
                  } else {
                    // ignore: use_build_context_synchronously
                    Navigator.of(ctx).pushReplacement(
                      MaterialPageRoute(builder: (_) => const AppShell()),
                    );
                  }
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
