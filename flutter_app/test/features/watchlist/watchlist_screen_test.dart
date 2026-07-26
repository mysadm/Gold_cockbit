import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gold_cockpit_mobile/core/api_client.dart';
import 'package:gold_cockpit_mobile/core/app_config.dart';
import 'package:gold_cockpit_mobile/core/secure_store.dart';
import 'package:gold_cockpit_mobile/features/watchlist/application/watchlist_providers.dart';
import 'package:gold_cockpit_mobile/features/watchlist/data/watchlist_repository.dart';
import 'package:gold_cockpit_mobile/features/watchlist/presentation/watchlist_screen.dart';

class _FakeSecureStore implements SecureStore {
  final Map<String, String> _values = {};
  @override
  Future<String?> read(String key) async => _values[key];
  @override
  Future<void> write(String key, String value) async => _values[key] = value;
}

/// A repository stub whose every mutating call fails, so tests can assert
/// the screen surfaces the failure instead of swallowing it silently.
class _FailingWatchlistRepository extends WatchlistRepository {
  @override
  Future<List<WatchlistItem>> fetchAll(Dio dio) async => const [
        WatchlistItem(id: 1, label: 'Oil prices', status: 'support', sortOrder: 0),
      ];

  @override
  Future<WatchlistItem> create(Dio dio, {required String label, required String status}) {
    throw DioException(requestOptions: RequestOptions(path: '/api/watchlist'), message: 'boom');
  }

  @override
  Future<WatchlistItem> updateStatus(Dio dio, int id, String status) {
    throw DioException(requestOptions: RequestOptions(path: '/api/watchlist/$id'), message: 'boom');
  }

  @override
  Future<void> delete(Dio dio, int id) {
    throw DioException(requestOptions: RequestOptions(path: '/api/watchlist/$id'), message: 'boom');
  }
}

void main() {
  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          apiClientProvider.overrideWithValue(ApiClient(AppConfig(_FakeSecureStore()))),
          watchlistRepositoryProvider.overrideWithValue(_FailingWatchlistRepository()),
        ],
        child: const MaterialApp(home: Scaffold(body: WatchlistScreen())),
      ),
    );
    await tester.pumpAndSettle();
  }

  testWidgets('shows a SnackBar instead of throwing when adding an item fails', (tester) async {
    await pumpScreen(tester);

    await tester.enterText(find.byKey(const Key('newItemField')), 'New risk factor');
    await tester.tap(find.byKey(const Key('addButton')));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
  });

  testWidgets('shows a SnackBar instead of throwing when cycling status fails', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.text('Oil prices'));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
  });

  testWidgets('shows a SnackBar instead of throwing when deleting fails', (tester) async {
    await pumpScreen(tester);

    await tester.tap(find.byIcon(Icons.close));
    await tester.pumpAndSettle();

    expect(find.byType(SnackBar), findsOneWidget);
  });
}
