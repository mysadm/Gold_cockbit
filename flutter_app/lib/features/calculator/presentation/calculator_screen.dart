import 'package:flutter/material.dart';
import '../../../core/domain.dart';
import '../../../l10n/strings.dart';

class CalculatorScreen extends StatefulWidget {
  const CalculatorScreen({
    super.key,
    required this.gram24k,
    required this.gram21k,
    required this.gram18k,
  });

  final double gram24k;
  final double gram21k;
  final double gram18k;

  @override
  State<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends State<CalculatorScreen> {
  final _controller = TextEditingController();
  KaratBreakdown? _breakdown;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _onChanged(String value) {
    final amount = double.tryParse(value);
    setState(() {
      _breakdown = amount == null
          ? null
          : calculateKaratBreakdown(amount, widget.gram24k, widget.gram21k, widget.gram18k);
    });
  }

  @override
  Widget build(BuildContext context) {
    const strings = Strings(AppLanguage.en);
    final breakdown = _breakdown;

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          TextField(
            key: const Key('amountField'),
            controller: _controller,
            keyboardType: TextInputType.number,
            onChanged: _onChanged,
            decoration: const InputDecoration(labelText: 'EGP amount'),
          ),
          const SizedBox(height: 16),
          if (breakdown != null) ...[
            Text('${strings.g24}: ${breakdown.twentyFourK.toStringAsFixed(2)}g'),
            Text('${strings.g21}: ${breakdown.twentyOneK.toStringAsFixed(2)}g'),
            Text('${strings.g18}: ${breakdown.eighteenK.toStringAsFixed(2)}g'),
          ],
        ],
      ),
    );
  }
}
