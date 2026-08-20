import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../../../core/app_theme.dart';
import '../../../core/domain.dart';
import '../../egypt_prices/application/egypt_prices_providers.dart';
import '../../egypt_prices/data/egypt_prices_repository.dart';
import '../application/wallet_providers.dart';
import '../data/wallet_repository.dart';

const Map<String, String> _unitLabels = {
  'oz': 'Ounces (24k)',
  'g24': '24k gold (bullion)',
  'g21': '21k gold (loose grams)',
  'g18': '18k gold (jewelry)',
  'pounds': 'Gold pounds',
};

/// Live international price per unit, mirroring the web app's karat math:
/// gram-24k spot is given, 21k/18k are fractions of it, oz is 24k × ounce
/// grams, and a gold pound is 8g of 21k.
Map<String, double> _intlPricesFor(GramPrices gramPrices) {
  return {
    'oz': gramPrices.g24 * goldOunceGrams,
    'g24': gramPrices.g24,
    'g21': gramPrices.g21,
    'g18': gramPrices.g18,
    'pounds': gramPrices.goldPound,
  };
}

EgyptGoldRow? _findEgyptRow(String karat, EgyptGoldSnapshot? snapshot) {
  if (snapshot == null) return null;
  for (final row in snapshot.rows) {
    if (row.karat == karat) return row;
  }
  return null;
}

double? _egyptBuyFor(String unit, EgyptGoldSnapshot? snapshot) {
  if (unit == 'oz') {
    final row24 = _findEgyptRow('24k', snapshot);
    return row24 == null ? null : row24.buy * goldOunceGrams;
  }
  final karat = switch (unit) {
    'g24' => '24k',
    'g21' => '21k',
    'g18' => '18k',
    'pounds' => 'gold_pound',
    _ => null,
  };
  if (karat == null) return null;
  return _findEgyptRow(karat, snapshot)?.buy;
}

class WalletScreen extends ConsumerStatefulWidget {
  const WalletScreen({super.key, required this.gramPrices});

  final GramPrices gramPrices;

  @override
  ConsumerState<WalletScreen> createState() => _WalletScreenState();
}

class _WalletScreenState extends ConsumerState<WalletScreen> {
  final Map<String, TextEditingController> _holdingsControllers = {
    for (final unit in walletUnits) unit: TextEditingController(),
  };
  bool _holdingsEditing = false;
  bool _holdingsSaving = false;

  String _txUnit = 'g24';
  String _txSide = 'buy';
  final _txAmountController = TextEditingController();
  final _txPriceController = TextEditingController();
  DateTime _txDate = DateTime.now();
  int? _txEditingId;
  bool _txSubmitting = false;

  @override
  void dispose() {
    for (final controller in _holdingsControllers.values) {
      controller.dispose();
    }
    _txAmountController.dispose();
    _txPriceController.dispose();
    super.dispose();
  }

  void _fillHoldingsControllers(WalletHoldings holdings) {
    for (final unit in walletUnits) {
      final value = holdings.forUnit(unit);
      _holdingsControllers[unit]!.text = unit == 'oz' ? value.round().toString() : value.toStringAsFixed(1);
    }
  }

  void _startHoldingsEdit(WalletHoldings holdings) {
    _fillHoldingsControllers(holdings);
    setState(() => _holdingsEditing = true);
  }

  Future<void> _saveHoldings(WalletHoldings current) async {
    final repository = ref.read(walletRepositoryProvider);
    final dio = ref.read(apiClientProvider).dio;
    setState(() => _holdingsSaving = true);
    try {
      await repository.updateHoldings(
        dio,
        oz: double.tryParse(_holdingsControllers['oz']!.text) ?? current.oz,
        g24: double.tryParse(_holdingsControllers['g24']!.text) ?? current.g24,
        g21: double.tryParse(_holdingsControllers['g21']!.text) ?? current.g21,
        g18: double.tryParse(_holdingsControllers['g18']!.text) ?? current.g18,
        pounds: double.tryParse(_holdingsControllers['pounds']!.text) ?? current.pounds,
        locked: current.locked ? null : true,
      );
      if (!mounted) return;
      setState(() => _holdingsEditing = false);
      ref.invalidate(walletHoldingsProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error saving wallet: $e')));
    } finally {
      if (mounted) setState(() => _holdingsSaving = false);
    }
  }

  void _resetTxForm() {
    _txEditingId = null;
    _txUnit = 'g24';
    _txSide = 'buy';
    _txAmountController.clear();
    _txPriceController.clear();
    _txDate = DateTime.now();
  }

  void _startEditTransaction(WalletTransaction tx) {
    setState(() {
      _txEditingId = tx.id;
      _txUnit = tx.unit;
      _txSide = tx.side;
      _txAmountController.text = tx.unit == 'oz' ? tx.amount.round().toString() : tx.amount.toString();
      _txPriceController.text = tx.priceEgp.toString();
      _txDate = DateTime.parse(tx.recordedAt.substring(0, 10));
    });
  }

  String _isoDate(DateTime date) =>
      '${date.year.toString().padLeft(4, '0')}-${date.month.toString().padLeft(2, '0')}-${date.day.toString().padLeft(2, '0')}';

  Future<void> _submitTransaction() async {
    final amount = double.tryParse(_txAmountController.text);
    if (amount == null || amount <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter an amount greater than zero')));
      return;
    }
    final price = double.tryParse(_txPriceController.text) ?? 0;
    final repository = ref.read(walletRepositoryProvider);
    final dio = ref.read(apiClientProvider).dio;
    setState(() => _txSubmitting = true);
    try {
      final normalizedAmount = _txUnit == 'oz' ? amount.roundToDouble() : amount;
      if (_txEditingId != null) {
        await repository.updateTransaction(
          dio,
          _txEditingId!,
          unit: _txUnit,
          side: _txSide,
          amount: normalizedAmount,
          priceEgp: price,
          recordedAt: _isoDate(_txDate),
        );
      } else {
        await repository.recordTransaction(
          dio,
          unit: _txUnit,
          side: _txSide,
          amount: normalizedAmount,
          priceEgp: price,
          recordedAt: _isoDate(_txDate),
        );
      }
      if (!mounted) return;
      setState(_resetTxForm);
      ref.invalidate(walletHoldingsProvider);
      ref.invalidate(walletTransactionsProvider);
      ref.invalidate(walletCostBasisProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error recording transaction: $e')));
    } finally {
      if (mounted) setState(() => _txSubmitting = false);
    }
  }

  Future<void> _deleteTransaction(int id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: const Text('Delete this transaction? Your wallet balance will be adjusted accordingly.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          TextButton(onPressed: () => Navigator.pop(context, true), child: const Text('Delete')),
        ],
      ),
    );
    if (confirmed != true) return;
    final repository = ref.read(walletRepositoryProvider);
    final dio = ref.read(apiClientProvider).dio;
    try {
      await repository.deleteTransaction(dio, id);
      if (!mounted) return;
      if (_txEditingId == id) setState(_resetTxForm);
      ref.invalidate(walletHoldingsProvider);
      ref.invalidate(walletTransactionsProvider);
      ref.invalidate(walletCostBasisProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error deleting transaction: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final holdingsAsync = ref.watch(walletHoldingsProvider);
    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: holdingsAsync.when(
        data: (holdings) => _buildBody(holdings),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('$error')),
      ),
    );
  }

  Widget _buildBody(WalletHoldings holdings) {
    if (!_holdingsEditing && !holdings.locked) {
      // First-time entry: nothing saved yet, start editable automatically.
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted && !_holdingsEditing) _startHoldingsEdit(holdings);
      });
    }

    final intlPrices = _intlPricesFor(widget.gramPrices);
    final egyptAsync = ref.watch(egyptPricesProvider);
    final egyptSnapshot = egyptAsync.value;
    final transactionsAsync = ref.watch(walletTransactionsProvider);

    double totalIntl = 0;
    double totalEgypt = 0;
    bool hasEgyptForAll = true;
    for (final unit in walletUnits) {
      final qty = holdings.forUnit(unit);
      totalIntl += qty * intlPrices[unit]!;
      final egyptPrice = _egyptBuyFor(unit, egyptSnapshot);
      if (egyptPrice == null) {
        hasEgyptForAll = false;
      } else {
        totalEgypt += qty * egyptPrice;
      }
    }
    final hasHoldings = walletUnits.any((unit) => holdings.forUnit(unit) > 0);

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Text('My Wallet Value', style: AppTextStyles.title(size: 15)),
        const SizedBox(height: 12),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: AppDecorations.panel,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final unit in walletUnits)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Expanded(child: Text(_unitLabels[unit]!, style: AppTextStyles.label(color: AppColors.gray, size: 13))),
                      SizedBox(
                        width: 110,
                        child: _holdingsEditing
                            ? TextField(
                                key: Key('holdingsField_$unit'),
                                controller: _holdingsControllers[unit],
                                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                                textAlign: TextAlign.end,
                                style: AppTextStyles.number(size: 14),
                              )
                            : Text(
                                unit == 'oz'
                                    ? holdings.oz.round().toString()
                                    : holdings.forUnit(unit).toStringAsFixed(1),
                                textAlign: TextAlign.end,
                                style: AppTextStyles.number(size: 14),
                              ),
                      ),
                    ],
                  ),
                ),
              const SizedBox(height: 8),
              if (_holdingsEditing)
                FilledButton(
                  key: const Key('saveHoldingsButton'),
                  onPressed: _holdingsSaving ? null : () => _saveHoldings(holdings),
                  child: Text(_holdingsSaving ? 'Saving…' : 'Save amounts'),
                )
              else
                Row(
                  children: [
                    Expanded(
                      child: Text(
                        'These amounts are locked so they stay in sync with your buy/sell transaction history.',
                        style: AppTextStyles.label(color: AppColors.lightGray, size: 11),
                      ),
                    ),
                    TextButton(
                      key: const Key('requestCorrectionButton'),
                      onPressed: () => _startHoldingsEdit(holdings),
                      child: const Text('Request correction'),
                    ),
                  ],
                ),
            ],
          ),
        ),
        if (hasHoldings) ...[
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(20),
            decoration: AppDecorations.panel,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Valuation', style: AppTextStyles.title(size: 14)),
                const SizedBox(height: 8),
                for (final unit in walletUnits.where((u) => holdings.forUnit(u) > 0))
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 3),
                    child: Row(
                      children: [
                        Expanded(child: Text(_unitLabels[unit]!, style: AppTextStyles.label(color: AppColors.gray, size: 13))),
                        Text('${(holdings.forUnit(unit) * intlPrices[unit]!).toStringAsFixed(0)} EGP',
                            style: AppTextStyles.number(size: 13)),
                      ],
                    ),
                  ),
                const Divider(height: 24),
                Row(
                  children: [
                    Expanded(child: Text('Total', style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.bold, size: 13))),
                    Text('${totalIntl.toStringAsFixed(0)} EGP (intl)',
                        style: AppTextStyles.number(size: 14, weight: FontWeight.bold, color: AppColors.green)),
                  ],
                ),
                const SizedBox(height: 4),
                if (hasEgyptForAll)
                  Text('${totalEgypt.toStringAsFixed(0)} EGP at live Egyptian market price',
                      style: AppTextStyles.label(color: AppColors.lightGray, size: 11))
                else
                  Text('Egypt-market value unavailable — check the Egypt Prices tab',
                      style: AppTextStyles.label(color: AppColors.lightGray, size: 11)),
              ],
            ),
          ),
        ],
        const SizedBox(height: 16),
        Container(
          padding: const EdgeInsets.all(20),
          decoration: AppDecorations.panel,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                _txEditingId != null ? 'Edit transaction' : 'Record a buy or sell',
                style: AppTextStyles.title(size: 14),
              ),
              const SizedBox(height: 8),
              DropdownButton<String>(
                key: const Key('txUnitDropdown'),
                value: _txUnit,
                items: [for (final unit in walletUnits) DropdownMenuItem(value: unit, child: Text(_unitLabels[unit]!))],
                onChanged: (value) => setState(() => _txUnit = value ?? _txUnit),
              ),
              Material(
                type: MaterialType.transparency,
                child: Row(
                  children: [
                    Expanded(
                      child: RadioListTile<String>(
                        key: const Key('txSideBuy'),
                        title: const Text('Buy'),
                        value: 'buy',
                        groupValue: _txSide,
                        onChanged: (value) => setState(() => _txSide = value ?? _txSide),
                      ),
                    ),
                    Expanded(
                      child: RadioListTile<String>(
                        key: const Key('txSideSell'),
                        title: const Text('Sell'),
                        value: 'sell',
                        groupValue: _txSide,
                        onChanged: (value) => setState(() => _txSide = value ?? _txSide),
                      ),
                    ),
                  ],
                ),
              ),
              TextField(
                key: const Key('txAmountField'),
                controller: _txAmountController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: AppTextStyles.number(size: 14),
                decoration: const InputDecoration(labelText: 'Amount'),
              ),
              TextField(
                key: const Key('txPriceField'),
                controller: _txPriceController,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                style: AppTextStyles.number(size: 14),
                decoration: const InputDecoration(labelText: 'Price (EGP)'),
              ),
              const SizedBox(height: 8),
              OutlinedButton(
                key: const Key('txDateButton'),
                onPressed: () async {
                  final picked = await showDatePicker(
                    context: context,
                    initialDate: _txDate,
                    firstDate: DateTime(2000),
                    lastDate: DateTime(2100),
                  );
                  if (picked == null) return;
                  setState(() => _txDate = picked);
                },
                child: Text('Date: ${_isoDate(_txDate)}'),
              ),
              const SizedBox(height: 12),
              Row(
                children: [
                  FilledButton(
                    key: const Key('submitTxButton'),
                    onPressed: _txSubmitting ? null : _submitTransaction,
                    child: Text(_txSubmitting
                        ? 'Recording…'
                        : (_txEditingId != null ? 'Save changes' : 'Record transaction')),
                  ),
                  if (_txEditingId != null)
                    TextButton(
                      onPressed: () => setState(_resetTxForm),
                      child: const Text('Cancel'),
                    ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        transactionsAsync.when(
          data: (transactions) => Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              for (final tx in transactions.take(10))
                Container(
                  key: Key('tx_${tx.id}'),
                  margin: const EdgeInsets.only(bottom: 8),
                  padding: const EdgeInsets.symmetric(horizontal: 4),
                  child: ListTile(
                    contentPadding: EdgeInsets.zero,
                    tileColor: Colors.white,
                    title: Text(
                      '${tx.side == 'buy' ? 'Buy' : 'Sell'} · ${_unitLabels[tx.unit] ?? tx.unit}',
                    ),
                    subtitle: Text(
                      '${tx.unit == 'oz' ? tx.amount.round() : tx.amount.toStringAsFixed(1)} · '
                      '${tx.priceEgp.toStringAsFixed(0)} EGP · ${tx.recordedAt.substring(0, 10)}',
                    ),
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          icon: const Icon(Icons.edit, color: AppColors.gray),
                          onPressed: () => _startEditTransaction(tx),
                        ),
                        IconButton(
                          icon: const Icon(Icons.delete_outline, color: AppColors.gray),
                          onPressed: () => _deleteTransaction(tx.id),
                        ),
                      ],
                    ),
                  ),
                ),
            ],
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, stack) => Text('$error'),
        ),
      ],
    );
  }
}
