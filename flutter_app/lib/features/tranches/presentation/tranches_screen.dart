import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../../core/api_client.dart' show apiClientProvider;
import '../../../core/app_theme.dart';
import '../../../core/domain.dart';
import '../application/tranches_providers.dart';
import '../data/dca_plan_repository.dart';
import '../data/tranches_repository.dart';

class TranchesScreen extends ConsumerStatefulWidget {
  const TranchesScreen({super.key});

  @override
  ConsumerState<TranchesScreen> createState() => _TranchesScreenState();
}

class _TranchesScreenState extends ConsumerState<TranchesScreen> {
  final _investmentController = TextEditingController();
  bool _investmentControllerInitialized = false;

  @override
  void dispose() {
    _investmentController.dispose();
    super.dispose();
  }

  Future<void> _updatePlan({String? startDate, double? totalInvestmentEgp}) async {
    final repository = ref.read(dcaPlanRepositoryProvider);
    final dio = ref.read(apiClientProvider).dio;
    try {
      await repository.update(dio, startDate: startDate, totalInvestmentEgp: totalInvestmentEgp);
      if (!mounted) return;
      ref.invalidate(dcaPlanProvider);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Error updating plan: $e')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final dcaPlanAsync = ref.watch(dcaPlanProvider);
    final tranchesAsync = ref.watch(tranchesListProvider);

    return Container(
      decoration: const BoxDecoration(gradient: AppColors.backgroundGradient),
      child: dcaPlanAsync.when(
        data: (plan) => _buildBody(plan, tranchesAsync),
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, stack) => Center(child: Text('$error')),
      ),
    );
  }

  Widget _buildBody(DcaPlan plan, AsyncValue<List<Tranche>> tranchesAsync) {
    if (!_investmentControllerInitialized) {
      _investmentController.text = plan.totalInvestmentEgp.toStringAsFixed(0);
      _investmentControllerInitialized = true;
    }
    final startDate = DateTime.parse(plan.startDate);

    return tranchesAsync.when(
      data: (tranches) => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: AppDecorations.panel,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('DCA PLAN', style: AppTextStyles.label()),
                const SizedBox(height: 12),
                OutlinedButton(
                  key: const Key('startDateButton'),
                  onPressed: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: startDate,
                      firstDate: DateTime(2000),
                      lastDate: DateTime(2100),
                    );
                    if (picked == null) return;
                    final formatted =
                        '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
                    await _updatePlan(startDate: formatted);
                  },
                  child: Text('Start date: ${plan.startDate}'),
                ),
                const SizedBox(height: 12),
                TextField(
                  key: const Key('investmentAmountField'),
                  controller: _investmentController,
                  keyboardType: TextInputType.number,
                  style: AppTextStyles.number(size: 15),
                  decoration: const InputDecoration(labelText: 'Total investment (EGP)'),
                  onSubmitted: (value) async {
                    final amount = double.tryParse(value);
                    if (amount == null) return;
                    await _updatePlan(totalInvestmentEgp: amount);
                  },
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          for (final tranche in tranches)
            _TrancheTile(tranche: tranche, startDate: startDate, totalInvestmentEgp: plan.totalInvestmentEgp),
        ],
      ),
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (error, stack) => Center(child: Text('$error')),
    );
  }
}

class _TrancheTile extends StatelessWidget {
  const _TrancheTile({
    required this.tranche,
    required this.startDate,
    required this.totalInvestmentEgp,
  });

  final Tranche tranche;
  final DateTime startDate;
  final double totalInvestmentEgp;

  static String _formatDate(DateTime date) => '${date.year}-${date.month.toString().padLeft(2, '0')}';

  @override
  Widget build(BuildContext context) {
    final window = calculateTrancheWindow(startDate, tranche.trancheNumber - 1);
    final status = calculateTrancheWindowStatus(window, DateTime.now());
    final plannedAmount = totalInvestmentEgp * tranche.planPct / 100;
    final displayAmount = tranche.amountEgp ?? plannedAmount;
    final isActive = status == TrancheWindowStatus.active;
    final isDone = status == TrancheWindowStatus.done;

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isActive ? const Color(0xFFFFFAE6) : Colors.white,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isActive ? AppColors.gold : (isDone ? AppColors.green : AppColors.cardBorder),
          width: isActive || isDone ? 2 : 1,
        ),
      ),
      child: Row(
        children: [
          Text('${tranche.planPct.toStringAsFixed(0)}%', style: AppTextStyles.heroNumber(size: 22)),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Tranche ${tranche.trancheNumber} · ${tranche.planPct.toStringAsFixed(0)}%',
                  style: AppTextStyles.label(color: AppColors.dark, weight: FontWeight.w600, size: 13),
                ),
                Text(
                  '${_formatDate(window.start)} – ${_formatDate(window.end)} · ${tranche.status}'
                  '${isActive ? ' · active window' : ''}',
                  style: AppTextStyles.label(color: isActive ? AppColors.gold : AppColors.gray, size: 12),
                ),
              ],
            ),
          ),
          Text('${displayAmount.toStringAsFixed(0)} EGP', style: AppTextStyles.number(size: 14)),
        ],
      ),
    );
  }
}
