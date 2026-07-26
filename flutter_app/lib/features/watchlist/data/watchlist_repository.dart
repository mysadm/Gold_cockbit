import 'package:dio/dio.dart';

class WatchlistItem {
  final int id;
  final String label;
  final String status;
  final int sortOrder;

  const WatchlistItem({
    required this.id,
    required this.label,
    required this.status,
    required this.sortOrder,
  });

  factory WatchlistItem.fromJson(Map<String, dynamic> json) {
    return WatchlistItem(
      id: json['id'] as int,
      label: json['label'] as String,
      status: json['status'] as String,
      sortOrder: json['sort_order'] as int,
    );
  }
}

String nextStatus(String status) {
  switch (status) {
    case 'support':
      return 'watch';
    case 'watch':
      return 'risk';
    default:
      return 'support';
  }
}

class WatchlistRepository {
  Future<List<WatchlistItem>> fetchAll(Dio dio) async {
    final response = await dio.get('/api/watchlist');
    return (response.data as List).map((row) => WatchlistItem.fromJson(row as Map<String, dynamic>)).toList();
  }

  Future<WatchlistItem> create(Dio dio, {required String label, required String status}) async {
    final response = await dio.post('/api/watchlist', data: {'label': label, 'status': status});
    return WatchlistItem.fromJson(response.data as Map<String, dynamic>);
  }

  Future<WatchlistItem> updateStatus(Dio dio, int id, String status) async {
    final response = await dio.patch('/api/watchlist/$id', data: {'status': status});
    return WatchlistItem.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> delete(Dio dio, int id) => dio.delete('/api/watchlist/$id');
}
