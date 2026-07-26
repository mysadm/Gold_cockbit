import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../l10n/strings.dart';

class LanguagePreference {
  LanguagePreference(this._prefs);

  static const _key = 'gold_cockpit_language';

  final SharedPreferences _prefs;

  Future<AppLanguage> get language async {
    final stored = _prefs.getString(_key);
    return stored == 'ar' ? AppLanguage.ar : AppLanguage.en;
  }

  Future<void> setLanguage(AppLanguage value) async {
    await _prefs.setString(_key, value == AppLanguage.ar ? 'ar' : 'en');
  }
}

class LanguageController extends StateNotifier<AppLanguage> {
  LanguageController(this._preference) : super(AppLanguage.en);

  final LanguagePreference _preference;

  Future<void> load() async {
    state = await _preference.language;
  }

  Future<void> setLanguage(AppLanguage value) async {
    await _preference.setLanguage(value);
    state = value;
  }
}

final sharedPreferencesProvider = Provider<SharedPreferences>((ref) {
  throw UnimplementedError('overridden in main() with the resolved SharedPreferences instance');
});

final languageProvider = StateNotifierProvider<LanguageController, AppLanguage>((ref) {
  final controller = LanguageController(LanguagePreference(ref.watch(sharedPreferencesProvider)));
  controller.load();
  return controller;
});
