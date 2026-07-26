import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/features/calculator/presentation/calculator_screen.dart';

void main() {
  testWidgets('entering an EGP amount shows the karat breakdown', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: CalculatorScreen(gram24k: 5000, gram21k: 4375, gram18k: 3750),
        ),
      ),
    );

    await tester.enterText(find.byKey(const Key('amountField')), '10000');
    await tester.pump();

    expect(find.textContaining('2.00'), findsOneWidget); // 10000 / 5000 = 2.00g at 24k
  });
}
