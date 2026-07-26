import 'package:dio/dio.dart';

class Scenario {
  final int id;
  final String name;
  final double? bandLow;
  final double? bandHigh;
  final double weightPct;
  final double? probabilityPct;
  final int sortOrder;

  const Scenario({
    required this.id,
    required this.name,
    required this.bandLow,
    required this.bandHigh,
    required this.weightPct,
    required this.probabilityPct,
    required this.sortOrder,
  });

  factory Scenario.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return Scenario(
      id: json['id'] as int,
      name: json['name'] as String,
      bandLow: toDouble(json['band_low']),
      bandHigh: toDouble(json['band_high']),
      weightPct: toDouble(json['weight_pct'])!,
      probabilityPct: toDouble(json['probability_pct']),
      sortOrder: json['sort_order'] as int,
    );
  }
}

class ScenariosRepository {
  Future<List<Scenario>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/scenarios');
    return (response.data as List).map((row) => Scenario.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<Scenario> updateWeight(Dio dio, int id, double weightPct) async {
    final response = await dio.patch('/api/scenarios/$id', data: {'weight_pct': weightPct});
    return Scenario.fromJson(response.data as Map<String, dynamic>);
  }
}
