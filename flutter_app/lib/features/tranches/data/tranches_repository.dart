import 'package:dio/dio.dart';

class Tranche {
  final int id;
  final int trancheNumber;
  final double planPct;
  final double? amountEgp;
  final double? gramEquivalent;
  final String status;
  final DateTime? purchasedAt;

  const Tranche({
    required this.id,
    required this.trancheNumber,
    required this.planPct,
    required this.amountEgp,
    required this.gramEquivalent,
    required this.status,
    required this.purchasedAt,
  });

  factory Tranche.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return Tranche(
      id: int.parse(json['id'].toString()),
      trancheNumber: json['tranche_number'] as int,
      planPct: toDouble(json['plan_pct'])!,
      amountEgp: toDouble(json['amount_egp']),
      gramEquivalent: toDouble(json['gram_equivalent']),
      status: json['status'] as String,
      purchasedAt: json['purchased_at'] == null ? null : DateTime.parse(json['purchased_at'] as String),
    );
  }
}

class TranchesRepository {
  Future<List<Tranche>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/tranches');
    return (response.data as List).map((row) => Tranche.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<Tranche> updateStatus(Dio dio, int id, String status) async {
    final response = await dio.patch('/api/tranches/$id', data: {'status': status});
    return Tranche.fromJson(response.data as Map<String, dynamic>);
  }
}
