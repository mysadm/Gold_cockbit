enum AppLanguage { ar, en }

class Strings {
  final AppLanguage lang;
  const Strings(this.lang);

  bool get isAr => lang == AppLanguage.ar;

  String get eyebrow => isAr ? 'غرفة عمليات الذهب' : 'GOLD HEDGE COCKPIT';
  String get title => isAr ? 'غرفة عمليات الذهب' : 'Gold Cockpit';

  String get marketTab => isAr ? 'السوق' : 'Market';
  String get scenariosTab => isAr ? 'السيناريوهات' : 'Scenarios';
  String get dcaTab => isAr ? 'خطة الدخول' : 'DCA Plan';
  String get watchTab => isAr ? 'لوحة المتابعة' : 'Watchlist';
  String get calcTab => isAr ? 'الحاسبة' : 'Calculator';
  String get egyptTab => isAr ? 'السوق المصري' : 'Egypt Prices';
  String get walletTab => isAr ? 'محفظتي' : 'My Wallet';
  String get aiTab => isAr ? 'المحلل الذكي' : 'AI Analyst';
  String get settingsTab => isAr ? 'الإعدادات' : 'Settings';

  String get g24 => isAr ? 'جرام 24' : '24k gram';
  String get g21 => isAr ? 'جرام 21' : '21k gram';
  String get g18 => isAr ? 'جرام 18' : '18k gram';
  String get goldPound => isAr ? 'الجنيه الذهب' : 'Gold pound';
  String get ounce => isAr ? 'الأونصة' : 'Ounce';
  String get ounceConversionNote => isAr ? 'التحويل المباشر بدون مصنعية' : 'direct conversion, no premium';
  String get inclPremiumNote => isAr ? 'جنيه · شامل المصنعية' : 'EGP · incl. premium';
  String get goldPoundNote => isAr ? 'جنيه · 8 جرام عيار 21' : 'EGP · 8g of 21k';
  String get pullLiveMarket => isAr ? '⟳ تحديث الأسعار مباشرة' : '⟳ PULL LIVE MARKET';

  String get calcHeading => isAr ? 'حاسبة الشراء بالأعيرة' : 'KARAT PURCHASE CALCULATOR';
  String get calcAmountLabel => isAr ? 'المبلغ (جنيه)' : 'Amount (EGP)';
  String get calcColKarat => isAr ? 'العيار' : 'Karat';
  String get calcColPerGram => isAr ? 'سعر الجرام' : 'Per gram';
  String get calcColQuantity => isAr ? 'الكمية' : 'Quantity';
  String get calc24k => isAr ? 'عيار 24 (سبائك)' : '24k (bullion)';
  String get calc21k => isAr ? 'عيار 21' : '21k';
  String get calc18k => isAr ? 'عيار 18 (مشغولات)' : '18k (jewelry)';

  String get scenarioDeescalation => isAr ? 'تغيرات جيوسياسية' : 'Geopolitical Changes';
  String get scenarioBase => isAr ? 'السيناريو الأساسي' : 'Base Case';
  String get scenarioStagflation => isAr ? 'فخ الركود التضخمي' : 'Stagflation Trap';
  String get weightedTargetLabel => isAr ? 'السعر المستهدف المرجّح' : 'Probability-weighted target';

  String get signalSupport => isAr ? 'داعم' : 'Support';
  String get signalWatch => isAr ? 'مراقبة' : 'Watch';
  String get signalRisk => isAr ? 'خطر' : 'Risk';
  String get addWatchItemHint => isAr ? 'متغير جديد…' : 'New variable…';
  String get addButton => isAr ? 'أضف' : 'Add';
  String get deleteButton => isAr ? 'حذف' : 'Delete';

  String get aiGoButton => isAr ? 'حلّل السوق' : 'Analyze the market';
  String get aiTrendsHeading => isAr ? 'اللي حرّك السوق' : 'What moved the market';
  String get aiWeightsHeading => isAr ? 'الأوزان المقترحة' : 'Suggested weights';
  String get aiTrancheHeading => isAr ? 'قرار الدفعة الثانية' : 'Tranche 2 call';
  String get aiEgpHeading => isAr ? 'قراءة الجنيه' : 'EGP read';
  String get aiApplyButton => isAr ? 'طبّق الأوزان دي' : 'Apply these weights';
  String get aiNoProvider => isAr ? 'مفيش مزوّد مُفعّل' : 'No active provider';

  String get settingsHeading => isAr ? 'إعدادات نموذج الذكاء الاصطناعي' : 'AI Model Settings';
  String get settingsLabelField => isAr ? 'الاسم' : 'Label';
  String get settingsModelField => isAr ? 'الموديل' : 'Model';
  String get settingsBaseUrlField => isAr ? 'رابط الخادم' : 'Base URL';
  String get settingsApiKeyField => isAr ? 'مفتاح API' : 'API key';
  String get settingsSaveButton => isAr ? 'حفظ' : 'Save';
  String get settingsActivateButton => isAr ? 'تفعيل' : 'Set active';
  String get settingsTestButton => isAr ? 'اختبار الاتصال' : 'Test connection';

  String get connectionSetupHeading => isAr ? 'إعداد الاتصال' : 'Connection setup';
  String get baseUrlFieldLabel => isAr ? 'عنوان الخادم' : 'Server base URL';
  String get apiKeyFieldLabel => isAr ? 'مفتاح API (اختياري)' : 'API key (optional)';
  String get saveButton => isAr ? 'حفظ' : 'Save';
  String get invalidUrlError =>
      isAr ? 'من فضلك أدخل رابطًا صحيحًا (http:// أو https://)' : 'Enter a valid http:// or https:// URL';
  String get connectionSettingsMenuItem => isAr ? 'إعدادات الاتصال' : 'Connection settings';
}
