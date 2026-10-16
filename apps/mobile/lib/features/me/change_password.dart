import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/repositories/auth_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';

/// The same rules as the server (apps/api/src/auth/auth.controller.ts): the server has the last word.
String? passwordProblem(String pw) {
  const common = ['password', 'password1', '12345678', '123456789', '1234567890', '11111111', '00000000', 'qwertyui',
      'qwerty123', 'iloveyou', 'abc12345', 'switchboard', 'pakistan', 'pakistan1', 'pakistan123', 'welcome1'];
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (!RegExp(r'[\d\W_]').hasMatch(pw)) return 'Add a number or a symbol.';
  if (common.contains(pw.toLowerCase())) return 'That password is too common. Choose another one.';
  return null;
}

/// "Change password" from Me: the current one, then the new one twice.
Future<void> showChangePassword(BuildContext context) =>
    showSbSheet<void>(context, builder: (_) => const _ChangePassword());

class _ChangePassword extends ConsumerStatefulWidget {
  const _ChangePassword();

  @override
  ConsumerState<_ChangePassword> createState() => _ChangePasswordState();
}

class _ChangePasswordState extends ConsumerState<_ChangePassword> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _again = TextEditingController();
  bool _busy = false, _show = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _again.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final problem = passwordProblem(_next.text) ??
        (_next.text != _again.text ? 'The two new passwords are not the same.' : null);
    if (_current.text.isEmpty) {
      setState(() => _error = 'Type your current password.');
      return;
    }
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).changePassword(_current.text, _next.text);
      if (mounted) Navigator.of(context).pop();
      ref.read(toastProvider.notifier).show('Password changed. Your other devices were signed out.');
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = ApiException.from(e).message;
          _busy = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final eye = IconButton(
      tooltip: _show ? 'Hide passwords' : 'Show passwords',
      onPressed: () => setState(() => _show = !_show),
      icon: SbIcon(_show ? SbIcons.eyeSlash : SbIcons.eye, size: 18, color: c.mu),
    );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Change password', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text('You stay signed in on this phone; other devices are signed out.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        LabeledField(label: 'Current password', controller: _current, icon: SbIcons.lock, obscure: !_show,
            autofocus: true, trailing: eye, autofillHints: const [AutofillHints.password]),
        const SizedBox(height: 12),
        LabeledField(label: 'New password', controller: _next, icon: SbIcons.lock, obscure: !_show,
            hint: '8+ characters, with a number or symbol', autofillHints: const [AutofillHints.newPassword]),
        const SizedBox(height: 12),
        LabeledField(label: 'New password again', controller: _again, icon: SbIcons.lock, obscure: !_show,
            autofillHints: const [AutofillHints.newPassword], textInputAction: TextInputAction.done, onSubmitted: (_) => _save()),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Change password', icon: SbIcons.check, busy: _busy, onTap: _save),
      ],
    );
  }
}
