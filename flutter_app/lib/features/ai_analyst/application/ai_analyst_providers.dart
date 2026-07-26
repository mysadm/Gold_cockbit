import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../data/ai_analyst_repository.dart';

final aiAnalystRepositoryProvider = Provider<AiAnalystRepository>((ref) => AiAnalystRepository());
