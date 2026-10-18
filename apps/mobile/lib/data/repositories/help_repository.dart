import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';
import '../models/help.dart';
import '../models/json.dart';

/// The Help Center's published articles, as a homeowner sees them (the same feed the web reads).
class HelpRepository {
  const HelpRepository(this._api);
  final ApiClient _api;

  Future<List<HelpArticle>> articles() async {
    final list = asJsonList(asJson(await _api.get<Object?>('/help/feed', query: {'articles': '1', 'view': 'customer'}))['articles'])
        .map(HelpArticle.fromJson)
        .toList()
      ..sort((a, b) => a.title.toLowerCase().compareTo(b.title.toLowerCase()));
    return list;
  }
}

final helpRepositoryProvider = Provider<HelpRepository>((ref) => HelpRepository(ref.watch(apiClientProvider)));

/// Kept while the app runs (articles change rarely); pull to refresh reloads it.
final helpArticlesProvider = FutureProvider<List<HelpArticle>>((ref) => ref.read(helpRepositoryProvider).articles());
