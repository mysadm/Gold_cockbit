import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/app_theme.dart';
import '../../../core/domain.dart';
import '../../../core/language_preference.dart';
import '../../../l10n/strings.dart';

class CalculatorScreen extends ConsumerStatefulWidget {
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
  ConsumerState<CalculatorScreen> createState() => _CalculatorScreenState();
}

class _CalculatorScreenState extends ConsumerState<CalculatorScreen> {
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
    final strings = Strings(ref.watch(languageProvider));
    final breakdown = _breakdown;

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(strings.calcHeading, style: AppTextStyles.title(size: 15)),
          const SizedBox(height: 12),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: AppDecorations.panel,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  key: const Key('amountField'),
                  controller: _controller,
                  keyboardType: TextInputType.number,
                  onChanged: _onChanged,
                  style: AppTextStyles.number(size: 15),
                  decoration: InputDecoration(labelText: strings.calcAmountLabel),
                ),
                const SizedBox(height: 16),
                if (breakdown != null)
                  Container(
                    decoration: AppDecorations.tableBorder,
                    child: Column(
                      children: [
                        _TableRow(
                          cells: [strings.calcColKarat, strings.calcColPerGram, strings.calcColQuantity],
                          header: true,
                        ),
                        _TableRow(cells: [
                          strings.calc24k,
                          '${widget.gram24k.toStringAsFixed(0)} EGP',
                          '${breakdown.twentyFourK.toStringAsFixed(2)}g',
                        ], highlight: true),
                        _TableRow(cells: [
                          strings.calc21k,
                          '${widget.gram21k.toStringAsFixed(0)} EGP',
                          '${breakdown.twentyOneK.toStringAsFixed(2)}g',
                        ]),
                        _TableRow(cells: [
                          strings.calc18k,
                          '${widget.gram18k.toStringAsFixed(0)} EGP',
                          '${breakdown.eighteenK.toStringAsFixed(2)}g',
                        ]),
                      ],
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _TableRow extends StatelessWidget {
  const _TableRow({required this.cells, this.header = false, this.highlight = false});

  final List<String> cells;
  final bool header;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 9),
      decoration: BoxDecoration(
        color: highlight ? const Color(0xFFF3FBF4) : Colors.white,
        border: const Border(bottom: BorderSide(color: AppColors.border)),
      ),
      child: Row(
        children: [
          for (final cell in cells)
            Expanded(
              child: Text(
                cell,
                style: header
                    ? AppTextStyles.label(weight: FontWeight.bold, size: 11)
                    : (cells.indexOf(cell) == 0
                        ? AppTextStyles.label(color: AppColors.dark, size: 13)
                        : AppTextStyles.number(size: 13)),
              ),
            ),
        ],
      ),
    );
  }
}
