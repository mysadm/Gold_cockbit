import 'package:dio/dio.dart';

class EgyptGoldRow {
  final String karat;
  final double sell;
  final double buy;
  final double? changeAmount;
  final double? changePct;

  const EgyptGoldRow({
    required this.karat,
    required this.sell,
    required this.buy,
    required this.changeAmount,
    required this.changePct,
  });

  factory EgyptGoldRow.fromJson(Map<String, dynamic> json) {
    double? toDouble(dynamic v) => v == null ? null : double.parse(v.toString());
    return EgyptGoldRow(
      karat: json['karat'] as String,
      sell: toDouble(json['sell'])!,
      buy: toDouble(json['buy'])!,
      changeAmount: toDouble(json['changeAmount']),
      changePct: toDouble(json['changePct']),
    );
  }
}

class EgyptGoldSnapshot {
  final String source;
  final DateTime fetchedAt;
  final List<EgyptGoldRow> rows;

  const EgyptGoldSnapshot({required this.source, required this.fetchedAt, required this.rows});

  factory EgyptGoldSnapshot.fromJson(Map<String, dynamic> json) {
    return EgyptGoldSnapshot(
      source: json['source'] as String,
      fetchedAt: DateTime.parse(json['fetchedAt'] as String),
      rows: (json['rows'] as List).map((row) => EgyptGoldRow.fromJson(row as Map<String, dynamic>)).toList(),
    );
  }
}

class EgyptPricesRepository {
  Future<EgyptGoldSnapshot> fetch(Dio dio) async {
    final response = await dio.get('/api/egypt-prices');
    return EgyptGoldSnapshot.fromJson(response.data as Map<String, dynamic>);
  }
}
