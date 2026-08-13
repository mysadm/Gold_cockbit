import 'package:dio/dio.dart';

class DcaPlan {
  final String startDate;
  final double totalInvestmentEgp;

  const DcaPlan({required this.startDate, required this.totalInvestmentEgp});

  factory DcaPlan.fromJson(Map<String, dynamic> json) {
    return DcaPlan(
      startDate: json['start_date'] as String,
      totalInvestmentEgp: double.parse(json['total_investment_egp'].toString()),
    );
  }
}

class DcaPlanRepository {
  Future<DcaPlan> fetch(Dio dio) async {
    final response = await dio.get('/api/dca-plan');
    return DcaPlan.fromJson(response.data as Map<String, dynamic>);
  }

  Future<DcaPlan> update(Dio dio, {String? startDate, double? totalInvestmentEgp}) async {
    final data = <String, dynamic>{
      if (startDate != null) 'start_date': startDate,
      if (totalInvestmentEgp != null) 'total_investment_egp': totalInvestmentEgp,
    };
    final response = await dio.patch('/api/dca-plan', data: data);
    return DcaPlan.fromJson(response.data as Map<String, dynamic>);
  }
}
