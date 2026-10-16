import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/config/app_settings.dart';
import '../../core/network/api_exception.dart';
import '../../core/routing/routes.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/repositories/auth_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sheet.dart';
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
  bool _show = false, _busy = false, _forgot = false, _sending = false;
  String? _error;
  /// after "Email me a link": true = sent (if the account exists), false = this server sends no email
  bool? _mailed;

  Future<void> _sendLink() async {
    final email = _email.text.trim();
    if (_sending) return;
    if (!email.contains('@')) {
      setState(() => _error = 'Type your email above first.');
      return;
    }
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      final mail = await ref.read(authRepositoryProvider).forgotPassword(email);
      if (mounted) setState(() => _mailed = mail);
    } catch (e) {
      if (mounted) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

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
      final ticket = await ref.read(sessionProvider.notifier).signIn(_email.text, _password.text);
      if (ticket != null) {
        if (mounted) setState(() => _busy = false);
        if (mounted) await showSbSheet<void>(context, builder: (_) => _CodeStep(ticket: ticket));
        return;
      }
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
                      if (_mailed == null)
                        Note(
                          tone: NoteTone.info,
                          icon: SbIcons.lock,
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text('We’ll email a link to the address above. Open it to choose a new password.'),
                              const SizedBox(height: 8),
                              GestureDetector(
                                onTap: _sendLink,
                                child: Text(
                                  _sending ? 'Sending…' : 'Email me a link',
                                  style: TextStyle(fontWeight: FontWeight.w600, color: c.acText),
                                ),
                              ),
                            ],
                          ),
                        )
                      else if (_mailed == true)
                        const Note(
                          tone: NoteTone.ok,
                          icon: SbIcons.check,
                          child: Text(
                            'If this email has an account, a link is on its way. It works once, for one hour. Look in Spam too.',
                          ),
                        )
                      else
                        const Note(
                          tone: NoteTone.info,
                          icon: SbIcons.lock,
                          child: Text(
                            'This server doesn’t send email. Ask your home owner, or your installer’s company, for a password link: People, your name, Password link.',
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


/// Two-step sign-in: the 6-digit code from the authenticator app, or a recovery code.
class _CodeStep extends ConsumerStatefulWidget {
  const _CodeStep({required this.ticket});
  final String ticket;

  @override
  ConsumerState<_CodeStep> createState() => _CodeStepState();
}

class _CodeStepState extends ConsumerState<_CodeStep> {
  final _code = TextEditingController();
  bool _busy = false;
  bool _recovery = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    if (_busy || _code.text.trim().length < 6) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).signInWithCode(widget.ticket, _code.text);
      TextInput.finishAutofillContext();
      if (mounted) Navigator.of(context).pop();
    } catch (e) {
      if (mounted) setState(() => _error = ApiException.from(e).message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('One more step', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text(
          _recovery
              ? 'Type one of the recovery codes you saved when you turned on two-step sign-in.'
              : 'Open your authenticator app and type the 6-digit code for Switchboard.',
          style: TextStyle(fontSize: 14.5, color: c.mu),
        ),
        const SizedBox(height: 14),
        TextField(
          controller: _code,
          autofocus: true,
          keyboardType: _recovery ? TextInputType.text : TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          maxLength: _recovery ? 12 : 7,
          onSubmitted: (_) => _go(),
          decoration: InputDecoration(hintText: _recovery ? 'abcd-efgh' : '123 456', errorText: _error),
        ),
        const SizedBox(height: 8),
        BigButton(label: 'Sign in', busy: _busy, onTap: _go),
        TextButton(
          onPressed: () => setState(() {
            _recovery = !_recovery;
            _code.clear();
            _error = null;
          }),
          child: Text(_recovery ? 'Use the app’s code instead' : 'No phone? Use a recovery code', style: TextStyle(color: c.acText)),
        ),
      ],
    );
  }
}
