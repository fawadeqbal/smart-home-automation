import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_client.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/repositories/auth_repository.dart';
import '../../shared/widgets/common.dart';
import 'auth_widgets.dart';

/// First launch on a phone: where is your Switchboard? (The address your installer gave you.)
class ServerScreen extends ConsumerStatefulWidget {
  const ServerScreen({super.key});

  @override
  ConsumerState<ServerScreen> createState() => _ServerScreenState();
}

class _ServerScreenState extends ConsumerState<ServerScreen> {
  late final _url = TextEditingController(
    text: ref.read(serverUrlProvider) ?? '',
  );
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _url.dispose();
    super.dispose();
  }

  Future<void> _connect() async {
    final raw = _url.text.trim();
    if (raw.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    final url = ServerUrl.normalize(raw);
    final probe = AuthRepository(
      ApiClient(server: url, cookies: ref.read(sessionCookiesProvider)),
    );
    final ok = await probe.serverReachable();
    if (!mounted) return;
    if (!ok) {
      setState(() {
        _busy = false;
        _error =
            'Can’t find Switchboard at $url. Check the address, and that this phone is online (or on the home Wi‑Fi).';
      });
      return;
    }
    await ref.read(serverUrlProvider.notifier).set(url);
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Brand(),
                    ),
                    const SizedBox(height: 40),
                    const SerifHeading('Find your', 'home.'),
                    const SizedBox(height: 8),
                    Text(
                      'Enter your Switchboard address — your installer gave it to you, or it’s the address you open in the browser.',
                      style: TextStyle(fontSize: 16, color: c.mu),
                    ),
                    const SizedBox(height: 26),
                    LabeledField(
                      label: 'Server address',
                      controller: _url,
                      icon: SbIcons.globe,
                      hint: 'home.fawadiqbal.dev',
                      keyboardType: TextInputType.url,
                      autofillHints: const [AutofillHints.url],
                      textInputAction: TextInputAction.go,
                      onSubmitted: (_) => _connect(),
                      error: _error != null,
                      autofocus: true,
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Note(
                        tone: NoteTone.bad,
                        icon: SbIcons.warning,
                        child: Text(_error!),
                      ),
                    ],
                    const SizedBox(height: 20),
                    BigButton(
                      label: 'Continue',
                      icon: SbIcons.arrowRight,
                      busy: _busy,
                      onTap: _connect,
                      height: 54,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
