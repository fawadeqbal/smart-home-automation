import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../core/routing/routes.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../shared/widgets/common.dart';
import '../../state/session.dart';
import 'auth_widgets.dart';

/// Sign in — the same account as the web app.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _show = false, _busy = false, _forgot = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    if (_busy || _email.text.trim().isEmpty || _password.text.isEmpty) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).signIn(_email.text, _password.text);
      TextInput.finishAutofillContext();
    } catch (e) {
      if (mounted) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final server = Uri.tryParse(ref.watch(serverUrlProvider) ?? '')?.host ?? '';
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    const Align(
                      alignment: Alignment.centerLeft,
                      child: Brand(),
                    ),
                    const SizedBox(height: 40),
                    const SerifHeading('Welcome', 'back.', size: 42),
                    const SizedBox(height: 8),
                    Text(
                      'Sign in to your home.',
                      style: TextStyle(fontSize: 16, color: c.mu),
                    ),
                    const SizedBox(height: 26),
                    LabeledField(
                      label: 'Email',
                      controller: _email,
                      icon: SbIcons.envelope,
                      hint: 'you@example.com',
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [
                        AutofillHints.email,
                        AutofillHints.username,
                      ],
                      textInputAction: TextInputAction.next,
                    ),
                    const SizedBox(height: 18),
                    LabeledField(
                      label: 'Password',
                      controller: _password,
                      icon: SbIcons.lock,
                      hint: 'Your password',
                      obscure: !_show,
                      error: _error != null,
                      autofillHints: const [AutofillHints.password],
                      textInputAction: TextInputAction.go,
                      onSubmitted: (_) => _signIn(),
                      extra: GestureDetector(
                        onTap: () => setState(() => _forgot = !_forgot),
                        child: Text(
                          'Forgot it?',
                          style: TextStyle(
                            fontSize: 13,
                            fontWeight: FontWeight.w500,
                            color: c.acText,
                          ),
                        ),
                      ),
                      trailing: IconButton(
                        tooltip: _show ? 'Hide password' : 'Show password',
                        onPressed: () => setState(() => _show = !_show),
                        icon: SbIcon(
                          _show ? SbIcons.eyeSlash : SbIcons.eye,
                          size: 18,
                          color: c.mu,
                        ),
                      ),
                    ),
                    if (_forgot) ...[
                      const SizedBox(height: 14),
                      const Note(
                        tone: NoteTone.info,
                        icon: SbIcons.lock,
                        child: Text(
                          'Ask whoever invited you — your home owner, or your installer — to send a new invite link. It lets you choose a new password.',
                        ),
                      ),
                    ],
                    if (_error != null) ...[
                      const SizedBox(height: 14),
                      Note(
                        tone: NoteTone.bad,
                        icon: SbIcons.warning,
                        child: Text(_error!),
                      ),
                    ],
                    const SizedBox(height: 22),
                    BigButton(
                      label: _busy ? 'Signing in…' : 'Sign in',
                      icon: _busy ? null : SbIcons.arrowRight,
                      busy: _busy,
                      onTap: _signIn,
                      height: 54,
                    ),
                    const SizedBox(height: 18),
                    Row(
                      children: [
                        Expanded(child: Divider(color: c.ln2)),
                        Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 12),
                          child: Text(
                            'Got an invite?',
                            style: TextStyle(fontSize: 13, color: c.mu),
                          ),
                        ),
                        Expanded(child: Divider(color: c.ln2)),
                      ],
                    ),
                    const SizedBox(height: 14),
                    Text(
                      'Open the link from your email or WhatsApp — it sets up your account in one step. Then sign in here.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 14, color: c.mu, height: 1.45),
                    ),
                    if (!kIsWeb) ...[
                      const SizedBox(height: 24),
                      Center(
                        child: TextButton(
                          onPressed: () => context.go(Routes.server),
                          child: Text(
                            'Server: $server · Change',
                            style: TextStyle(fontSize: 13, color: c.mu),
                          ),
                        ),
                      ),
                    ],
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
