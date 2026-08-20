import 'package:dio/dio.dart';

const List<String> walletUnits = ['oz', 'g24', 'g21', 'g18', 'pounds'];

double _toDouble(dynamic v) => double.parse(v.toString());
double? _toDoubleOrNull(dynamic v) => v == null ? null : double.parse(v.toString());

class WalletHoldings {
  final double oz;
  final double g24;
  final double g21;
  final double g18;
  final double pounds;
  final bool locked;
  final String updatedAt;

  const WalletHoldings({
    required this.oz,
    required this.g24,
    required this.g21,
    required this.g18,
    required this.pounds,
    required this.locked,
    required this.updatedAt,
  });

  double forUnit(String unit) {
    switch (unit) {
      case 'oz':
        return oz;
      case 'g24':
        return g24;
      case 'g21':
        return g21;
      case 'g18':
        return g18;
      case 'pounds':
        return pounds;
      default:
        throw ArgumentError('unknown wallet unit: $unit');
    }
  }

  factory WalletHoldings.fromJson(Map<String, dynamic> json) {
    return WalletHoldings(
      oz: _toDouble(json['oz']),
      g24: _toDouble(json['g24']),
      g21: _toDouble(json['g21']),
      g18: _toDouble(json['g18']),
      pounds: _toDouble(json['pounds']),
      locked: json['locked'] == true,
      updatedAt: json['updated_at'] as String,
    );
  }
}

class WalletSnapshot {
  final int id;
  final double intlValueEgp;
  final double? egyptValueEgp;
  final double? usdEgpRate;
  final String recordedAt;

  const WalletSnapshot({
    required this.id,
    required this.intlValueEgp,
    required this.egyptValueEgp,
    required this.usdEgpRate,
    required this.recordedAt,
  });

  factory WalletSnapshot.fromJson(Map<String, dynamic> json) {
    return WalletSnapshot(
      id: int.parse(json['id'].toString()),
      intlValueEgp: _toDouble(json['intl_value_egp']),
      egyptValueEgp: _toDoubleOrNull(json['egypt_value_egp']),
      usdEgpRate: _toDoubleOrNull(json['usd_egp_rate']),
      recordedAt: json['recorded_at'] as String,
    );
  }
}

class WalletTransaction {
  final int id;
  final String unit;
  final String side;
  final double amount;
  final double priceEgp;
  final String recordedAt;

  const WalletTransaction({
    required this.id,
    required this.unit,
    required this.side,
    required this.amount,
    required this.priceEgp,
    required this.recordedAt,
  });

  factory WalletTransaction.fromJson(Map<String, dynamic> json) {
    return WalletTransaction(
      id: int.parse(json['id'].toString()),
      unit: json['unit'] as String,
      side: json['side'] as String,
      amount: _toDouble(json['amount']),
      priceEgp: _toDouble(json['price_egp']),
      recordedAt: json['recorded_at'] as String,
    );
  }
}

class WalletTransactionResult {
  final WalletTransaction transaction;
  final WalletHoldings holdings;

  const WalletTransactionResult({required this.transaction, required this.holdings});

  factory WalletTransactionResult.fromJson(Map<String, dynamic> json) {
    return WalletTransactionResult(
      transaction: WalletTransaction.fromJson(json['transaction'] as Map<String, dynamic>),
      holdings: WalletHoldings.fromJson(json['holdings'] as Map<String, dynamic>),
    );
  }
}

class WalletCostBasis {
  final String unit;
  final double avgCostEgp;
  final double openQty;
  final double realizedEgp;

  const WalletCostBasis({
    required this.unit,
    required this.avgCostEgp,
    required this.openQty,
    required this.realizedEgp,
  });

  factory WalletCostBasis.fromJson(Map<String, dynamic> json) {
    return WalletCostBasis(
      unit: json['unit'] as String,
      avgCostEgp: _toDouble(json['avgCostEgp']),
      openQty: _toDouble(json['openQty']),
      realizedEgp: _toDouble(json['realizedEgp']),
    );
  }
}

class WalletRepository {
  Future<WalletHoldings> fetchHoldings(Dio dio) async {
    final response = await dio.get('/api/wallet');
    return WalletHoldings.fromJson(response.data as Map<String, dynamic>);
  }

  Future<WalletHoldings> updateHoldings(
    Dio dio, {
    double? oz,
    double? g24,
    double? g21,
    double? g18,
    double? pounds,
    bool? locked,
  }) async {
    final data = <String, dynamic>{
      if (oz != null) 'oz': oz,
      if (g24 != null) 'g24': g24,
      if (g21 != null) 'g21': g21,
      if (g18 != null) 'g18': g18,
      if (pounds != null) 'pounds': pounds,
      if (locked != null) 'locked': locked,
    };
    final response = await dio.put('/api/wallet', data: data);
    return WalletHoldings.fromJson(response.data as Map<String, dynamic>);
  }

  Future<List<WalletSnapshot>> fetchSnapshots(Dio dio, {String? since}) async {
    final response = await dio.get(
      '/api/wallet/snapshots',
      queryParameters: since == null ? null : {'since': since},
    );
    return (response.data as List).map((row) => WalletSnapshot.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<WalletSnapshot> recordSnapshot(
    Dio dio, {
    required double intlValueEgp,
    double? egyptValueEgp,
    double? usdEgpRate,
  }) async {
    final response = await dio.post('/api/wallet/snapshots', data: {
      'intl_value_egp': intlValueEgp,
      'egypt_value_egp': egyptValueEgp,
      'usd_egp_rate': usdEgpRate,
    });
    return WalletSnapshot.fromJson(response.data as Map<String, dynamic>);
  }

  Future<List<WalletTransaction>> fetchTransactions(Dio dio) async {
    final response = await dio.get('/api/wallet/transactions');
    return (response.data as List).map((row) => WalletTransaction.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<WalletTransactionResult> recordTransaction(
    Dio dio, {
    required String unit,
    required String side,
    required double amount,
    required double priceEgp,
    String? recordedAt,
  }) async {
    final response = await dio.post('/api/wallet/transactions', data: {
      'unit': unit,
      'side': side,
      'amount': amount,
      'price_egp': priceEgp,
      if (recordedAt != null) 'recorded_at': recordedAt,
    });
    return WalletTransactionResult.fromJson(response.data as Map<String, dynamic>);
  }

  Future<WalletTransactionResult> updateTransaction(
    Dio dio,
    int id, {
    String? unit,
    String? side,
    double? amount,
    double? priceEgp,
    String? recordedAt,
  }) async {
    final data = <String, dynamic>{
      if (unit != null) 'unit': unit,
      if (side != null) 'side': side,
      if (amount != null) 'amount': amount,
      if (priceEgp != null) 'price_egp': priceEgp,
      if (recordedAt != null) 'recorded_at': recordedAt,
    };
    final response = await dio.patch('/api/wallet/transactions/$id', data: data);
    return WalletTransactionResult.fromJson(response.data as Map<String, dynamic>);
  }

  Future<WalletHoldings> deleteTransaction(Dio dio, int id) async {
    final response = await dio.delete('/api/wallet/transactions/$id');
    return WalletHoldings.fromJson(response.data['holdings'] as Map<String, dynamic>);
  }

  Future<List<WalletCostBasis>> fetchCostBasis(Dio dio) async {
    final response = await dio.get('/api/wallet/cost-basis');
    return (response.data as List).map((row) => WalletCostBasis.fromJson(row as Map<String, dynamic>)).toList();
  }
}
