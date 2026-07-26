import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:gold_cockpit_mobile/core/language_preference.dart';
import 'package:gold_cockpit_mobile/l10n/strings.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('LanguagePreference', () {
    test('defaults to English when unset', () async {
      final prefs = await SharedPreferences.getInstance();
      final preference = LanguagePreference(prefs);
      expect(await preference.language, AppLanguage.en);
    });

    test('setLanguage persists and is read back', () async {
      final prefs = await SharedPreferences.getInstance();
      final preference = LanguagePreference(prefs);

      await preference.setLanguage(AppLanguage.ar);

      expect(await preference.language, AppLanguage.ar);
    });
  });

  group('LanguageController', () {
    test('starts with the persisted language and updates on toggle', () async {
      SharedPreferences.setMockInitialValues({'gold_cockpit_language': 'ar'});
      final prefs = await SharedPreferences.getInstance();
      final controller = LanguageController(LanguagePreference(prefs));
      await controller.load();

      expect(controller.state, AppLanguage.ar);

      await controller.setLanguage(AppLanguage.en);
      expect(controller.state, AppLanguage.en);
      expect(await LanguagePreference(prefs).language, AppLanguage.en);
    });
  });
}
