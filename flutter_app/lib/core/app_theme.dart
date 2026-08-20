import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// Design tokens matching the web app (src/styles.css) and Figma port.
class AppColors {
  AppColors._();

  static const green = Color(0xFF00B240);
  static const dark = Color(0xFF1A1A1A);
  static const gray = Color(0xFF555555);
  static const lightGray = Color(0xFF888888);
  static const border = Color(0xFFDFE8DC);
  static const cardBorder = Color(0xFFE3EBDF);
  static const heroFill = Color(0xFFE8F7ED);
  static const cellFill = Color(0xFFFDFDFD);
  static const gradientTop = Color(0xFFF8FBF8);
  static const gradientBottom = Color(0xFFF1F5EF);
  static const red = Color(0xFFDB4F4F);
  static const gold = Color(0xFFD39D1D);

  static const backgroundGradient = LinearGradient(
    begin: Alignment.topCenter,
    end: Alignment.bottomCenter,
    colors: [gradientTop, gradientBottom],
  );
}

/// Text styles matching the web app's font stack: Cairo for UI copy,
/// IBM Plex Mono for numbers/prices, Fraunces for large hero numbers.
class AppTextStyles {
  AppTextStyles._();

  static TextStyle label({Color color = AppColors.gray, double size = 12, FontWeight weight = FontWeight.normal}) =>
      GoogleFonts.cairo(fontSize: size, color: color, fontWeight: weight);

  static TextStyle title({Color color = AppColors.dark, double size = 22}) =>
      GoogleFonts.cairo(fontSize: size, color: color, fontWeight: FontWeight.bold);

  static TextStyle button({Color color = AppColors.green, double size = 13}) =>
      GoogleFonts.cairo(fontSize: size, color: color, fontWeight: FontWeight.bold);

  static TextStyle number({Color color = AppColors.dark, double size = 15, FontWeight weight = FontWeight.normal}) =>
      GoogleFonts.ibmPlexMono(fontSize: size, color: color, fontWeight: weight);

  static TextStyle heroNumber({Color color = AppColors.dark, double size = 56}) =>
      GoogleFonts.fraunces(fontSize: size, color: color, fontWeight: FontWeight.bold);
}

/// Reusable decorations matching the web app's .panel / .cell / .board styles.
class AppDecorations {
  AppDecorations._();

  static BoxDecoration panel = BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(16),
    border: Border.all(color: AppColors.cardBorder),
    boxShadow: [
      BoxShadow(color: Colors.black.withValues(alpha: 0.03), blurRadius: 24, offset: const Offset(0, 8)),
    ],
  );

  static BoxDecoration cell({bool hero = false}) => BoxDecoration(
        color: hero ? AppColors.heroFill : AppColors.cellFill,
      );

  static BoxDecoration outlinedPill = BoxDecoration(
    color: Colors.white,
    borderRadius: BorderRadius.circular(999),
    border: Border.all(color: AppColors.green),
  );

  static BoxDecoration filledPill = BoxDecoration(
    color: AppColors.green,
    borderRadius: BorderRadius.circular(10),
  );

  static BoxDecoration tableBorder = BoxDecoration(
    borderRadius: BorderRadius.circular(8),
    border: Border.all(color: AppColors.border),
  );
}

ThemeData buildAppTheme() {
  final base = ThemeData(useMaterial3: true, colorSchemeSeed: AppColors.green, brightness: Brightness.light);
  return base.copyWith(
    scaffoldBackgroundColor: AppColors.gradientTop,
    textTheme: GoogleFonts.cairoTextTheme(base.textTheme),
    appBarTheme: AppBarTheme(
      backgroundColor: Colors.white,
      foregroundColor: AppColors.dark,
      elevation: 0,
      titleTextStyle: AppTextStyles.title(size: 18),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: const BorderSide(color: AppColors.cardBorder),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.green,
        side: const BorderSide(color: AppColors.green),
        textStyle: AppTextStyles.button(),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
        textStyle: AppTextStyles.button(color: Colors.white, size: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(vertical: 14),
        elevation: 0,
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.green,
        foregroundColor: Colors.white,
        textStyle: AppTextStyles.button(color: Colors.white, size: 15),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        padding: const EdgeInsets.symmetric(vertical: 14),
        elevation: 0,
      ),
    ),
    chipTheme: base.chipTheme.copyWith(
      backgroundColor: AppColors.green,
      labelStyle: AppTextStyles.button(color: Colors.white, size: 12),
      side: BorderSide.none,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
    ),
    listTileTheme: ListTileThemeData(
      titleTextStyle: AppTextStyles.label(color: AppColors.dark, size: 14, weight: FontWeight.w600),
      subtitleTextStyle: AppTextStyles.label(color: AppColors.gray, size: 12),
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      labelStyle: AppTextStyles.label(),
      enabledBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFFC4C4C4))),
      focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: AppColors.green)),
    ),
  );
}
