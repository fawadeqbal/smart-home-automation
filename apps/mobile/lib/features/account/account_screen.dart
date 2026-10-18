import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../core/theme/sb_icons_more.dart';
import '../../core/util/format.dart';
import '../../data/repositories/account_repository.dart';
import '../../shared/widgets/common.dart';
import '../../shared/widgets/pill.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/session.dart';
import '../../state/toast.dart';
import '../auth/auth_widgets.dart';
import '../me/change_password.dart';

/// Your account, like the web's /account: who you are, your mobile number, password, two-step
/// sign-in, where you're signed in, and what the assistant remembers.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final where = [
      for (final h in me.homes) '${h.name} (${h.role.label.toLowerCase()})',
      if (me.staff != null) '${me.staff!.orgName} (${me.staff!.role.toLowerCase()})',
    ];
    return RefreshIndicator(
      color: c.on,
      onRefresh: () async {
        ref.invalidate(phoneNumberProvider);
        ref.invalidate(twoStepProvider);
        ref.invalidate(signInSessionsProvider);
        ref.invalidate(memoriesProvider);
      },
      child: ListView(
        padding: EdgeInsets.fromLTRB(18, MediaQuery.paddingOf(context).top + 4, 18, 130),
        children: [
          BackPill(onTap: () => context.pop()),
          const SizedBox(height: 12),
          const PageTitle('Your account', subtitle: 'Your sign-in details, two-step sign-in and where you’re signed in.'),
          const SizedBox(height: 18),
          GroupCard(
            radius: 22,
            children: [
              Padding(
                padding: const EdgeInsets.all(16),
                child: Row(
                  children: [
                    Avatar(me.initials, size: 52, background: c.on, foreground: SbColors.onInk),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(me.name, style: TextStyle(fontSize: 17, fontWeight: FontWeight.w600, color: c.tx)),
                          Text(me.email, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 14, color: c.mu)),
                          if (where.isNotEmpty) Text(where.join(' · '), style: TextStyle(fontSize: 12.5, color: c.mu)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 22),
          const _Phone(),
          const SizedBox(height: 22),
          const GroupLabel('Signing in'),
          GroupCard(
            children: [
              InfoRow(icon: SbIcons.lock, title: 'Change password', subtitle: 'Other phones and computers are signed out', onTap: () => showChangePassword(context)),
            ],
          ),
          const SizedBox(height: 12),
          const _TwoStep(),
          const SizedBox(height: 22),
          const _Sessions(),
          if (me.home != null && !me.home!.readOnly) ...[const SizedBox(height: 22), const _Memories()],
        ],
      ),
    );
  }
}

// ------------------------------------------------------------------ mobile number

class _Phone extends ConsumerStatefulWidget {
  const _Phone();

  @override
  ConsumerState<_Phone> createState() => _PhoneState();
}

class _PhoneState extends ConsumerState<_Phone> {
  final _phone = TextEditingController();
  bool _loaded = false, _busy = false;
  String? _saved;

  @override
  void dispose() {
    _phone.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    setState(() => _busy = true);
    try {
      final v = await ref.read(accountRepositoryProvider).setPhone(_phone.text);
      _phone.text = v ?? '';
      _saved = v;
      ref.read(toastProvider.notifier).show(v == null ? 'Mobile number removed' : 'Saved: $v');
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final me = ref.watch(meProvider);
    final phone = ref.watch(phoneNumberProvider);
    if (!_loaded && phone.hasValue) {
      _loaded = true;
      _saved = phone.value;
      _phone.text = phone.value ?? '';
    }
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const GroupLabel('Mobile number (optional)'),
        GroupCard(
          children: [
            Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'For WhatsApp messages from ${me.staff != null ? 'your company' : 'your installer’s team'}: visit times, answers to your requests and bills.',
                    style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35),
                  ),
                  const SizedBox(height: 10),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _phone,
                          keyboardType: TextInputType.phone,
                          autofillHints: const [AutofillHints.telephoneNumber],
                          style: TextStyle(fontSize: 15.5, color: c.tx),
                          onChanged: (_) => setState(() {}),
                          decoration: InputDecoration(
                            hintText: '0300 1234567',
                            prefixIcon: Padding(padding: const EdgeInsets.only(left: 14, right: 10), child: SbIcon(MoreIcons.phone, size: 18, color: c.mu)),
                            prefixIconConstraints: const BoxConstraints(minWidth: 42),
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      FilledButton(
                        onPressed: _busy || _phone.text.trim() == (_saved ?? '') ? null : _save,
                        style: FilledButton.styleFrom(
                          backgroundColor: c.tx,
                          foregroundColor: c.bg,
                          minimumSize: const Size(76, 50),
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                          textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 15, fontWeight: FontWeight.w600),
                        ),
                        child: Text(_busy ? '…' : 'Save'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}

// ------------------------------------------------------------------ two-step sign-in

class _TwoStep extends ConsumerWidget {
  const _TwoStep();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final c = context.sb;
    final s = ref.watch(twoStepProvider).value;
    if (s == null) return const SizedBox.shrink();
    return GroupCard(
      children: [
        Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  SbIcon(SbIcons.shield, size: 18, color: c.tx),
                  const SizedBox(width: 10),
                  Expanded(child: Text('Two-step sign-in', style: TextStyle(fontSize: 15.5, fontWeight: FontWeight.w600, color: c.tx))),
                  Pill(s.enabled ? 'On' : 'Off', tone: s.enabled ? PillTone.ok : PillTone.mute),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                s.enabled
                    ? 'Signing in asks for a code from your authenticator app as well as your password. '
                        '${s.since != null ? 'On since ${Fmt.day(s.since!)}; ' : ''}${s.recoveryLeft} recovery code${s.recoveryLeft == 1 ? '' : 's'} left.'
                    : 'Ask for a 6-digit code from an app on your phone (Google Authenticator, Microsoft Authenticator, Authy) as well as your password. Someone who learns your password still can’t get in.',
                style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.4),
              ),
              const SizedBox(height: 12),
              if (s.enabled)
                Row(
                  children: [
                    Expanded(child: _Outline(label: 'New recovery codes', onTap: () => _askPassword(context, ref, off: false))),
                    const SizedBox(width: 8),
                    Expanded(child: _Outline(label: 'Turn off', onTap: () => _askPassword(context, ref, off: true))),
                  ],
                )
              else
                BigButton(label: 'Turn on', icon: SbIcons.shield, height: 48, onTap: () => _start(context, ref)),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _start(BuildContext context, WidgetRef ref) async {
    try {
      final setup = await ref.read(accountRepositoryProvider).startTwoStep();
      if (context.mounted) await showSbSheet<void>(context, builder: (_) => _TurnOn(setup: setup));
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    }
  }

  Future<void> _askPassword(BuildContext context, WidgetRef ref, {required bool off}) =>
      showSbSheet<void>(context, builder: (_) => _PasswordCheck(off: off));
}

class _Outline extends StatelessWidget {
  const _Outline({required this.label, required this.onTap});
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        foregroundColor: c.tx,
        side: BorderSide(color: c.ln2),
        minimumSize: const Size.fromHeight(46),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
        textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14.5, fontWeight: FontWeight.w500),
      ),
      child: Text(label),
    );
  }
}

/// Turn on: add the key to an authenticator app (or scan the QR with another phone), then type its code.
class _TurnOn extends ConsumerStatefulWidget {
  const _TurnOn({required this.setup});
  final TwoStepSetup setup;

  @override
  ConsumerState<_TurnOn> createState() => _TurnOnState();
}

class _TurnOnState extends ConsumerState<_TurnOn> {
  final _code = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _enable() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final codes = await ref.read(accountRepositoryProvider).enableTwoStep(_code.text);
      ref.invalidate(twoStepProvider);
      if (!mounted) return;
      Navigator.of(context).pop();
      await showRecoveryCodes(context, codes);
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final s = widget.setup;
    Widget step(int n, String text) => Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Container(
                width: 22,
                height: 22,
                alignment: Alignment.center,
                decoration: BoxDecoration(color: c.sf2, shape: BoxShape.circle),
                child: Text('$n', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: c.tx)),
              ),
              const SizedBox(width: 10),
              Expanded(child: Text(text, style: TextStyle(fontSize: 14, color: c.tx, height: 1.4))),
            ],
          ),
        );
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Turn on two-step sign-in', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 14),
        step(1, 'Open your authenticator app and add an account (usually +).'),
        step(2, 'Choose “Enter a setup key” and paste this key — or scan the code with another phone.'),
        const SizedBox(height: 4),
        GroupCard(children: [CopyRow(label: 'Setup key', value: s.secret, mono: true)]),
        if (s.qrPng != null) ...[
          const SizedBox(height: 12),
          Center(
            child: Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: c.ln2)),
              child: Image.memory(s.qrPng!, width: 170, height: 170, semanticLabel: 'QR code for your authenticator app', filterQuality: FilterQuality.none),
            ),
          ),
        ],
        const SizedBox(height: 14),
        step(3, 'Type the 6-digit code the app shows.'),
        LabeledField(
          label: 'Code',
          controller: _code,
          icon: SbIcons.lock,
          hint: '123 456',
          keyboardType: TextInputType.number,
          autofillHints: const [AutofillHints.oneTimeCode],
          onSubmitted: (_) => _enable(),
        ),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(label: 'Turn on', icon: SbIcons.check, busy: _busy, onTap: _enable),
      ],
    );
  }
}

/// Turning off, or making new recovery codes, asks for the password first.
class _PasswordCheck extends ConsumerStatefulWidget {
  const _PasswordCheck({required this.off});
  final bool off;

  @override
  ConsumerState<_PasswordCheck> createState() => _PasswordCheckState();
}

class _PasswordCheckState extends ConsumerState<_PasswordCheck> {
  final _pw = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _pw.dispose();
    super.dispose();
  }

  Future<void> _go() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final repo = ref.read(accountRepositoryProvider);
    try {
      if (widget.off) {
        await repo.disableTwoStep(_pw.text);
        ref.invalidate(twoStepProvider);
        await ref.read(sessionProvider.notifier).reload();
        if (mounted) Navigator.of(context).pop();
        ref.read(toastProvider.notifier).show('Two-step sign-in is off');
      } else {
        final codes = await repo.newRecoveryCodes(_pw.text);
        ref.invalidate(twoStepProvider);
        if (!mounted) return;
        Navigator.of(context).pop();
        await showRecoveryCodes(context, codes);
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = ApiException.from(e).message;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(widget.off ? 'Turn off two-step sign-in?' : 'New recovery codes', style: SbText.title.copyWith(color: c.tx)),
        const SizedBox(height: 4),
        Text(widget.off ? 'Signing in will need only your password.' : 'The old codes stop working.', style: TextStyle(fontSize: 14.5, color: c.mu)),
        const SizedBox(height: 16),
        LabeledField(label: 'Your password', controller: _pw, icon: SbIcons.lock, obscure: true, autofocus: true, onSubmitted: (_) => _go()),
        if (_error != null) ...[
          const SizedBox(height: 12),
          Note(tone: NoteTone.bad, icon: SbIcons.warning, child: Text(_error!)),
        ],
        const SizedBox(height: 16),
        BigButton(
          label: widget.off ? 'Turn off' : 'Make new codes',
          busy: _busy,
          color: widget.off ? c.bad : null,
          foreground: widget.off ? Colors.white : null,
          onTap: _go,
        ),
      ],
    );
  }
}

/// Recovery codes, shown once: copy or share them somewhere safe.
Future<void> showRecoveryCodes(BuildContext context, List<String> codes) {
  final text = 'Switchboard recovery codes (each works once)\n\n${codes.join('\n')}\n';
  return showSbSheet<void>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Save your recovery codes', style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 4),
          Text('If you lose your phone, each of these lets you sign in once. Keep them somewhere safe — they won’t be shown again.', style: TextStyle(fontSize: 14.5, color: c.mu)),
          const SizedBox(height: 14),
          GroupCard(children: [CopyRow(label: 'Recovery codes', value: codes.join('\n'), mono: true)]),
          const SizedBox(height: 10),
          _Outline(label: 'Share or save them', onTap: () => SharePlus.instance.share(ShareParams(text: text))),
          const SizedBox(height: 10),
          BigButton(label: 'I’ve saved them', onTap: () => Navigator.of(ctx).pop()),
        ],
      );
    },
  );
}

// ------------------------------------------------------------------ where you're signed in

class _Sessions extends ConsumerStatefulWidget {
  const _Sessions();

  @override
  ConsumerState<_Sessions> createState() => _SessionsState();
}

class _SessionsState extends ConsumerState<_Sessions> {
  bool _all = false, _busy = false;

  Future<void> _run(Future<void> Function(AccountRepository r) call, String done) async {
    setState(() => _busy = true);
    try {
      await call(ref.read(accountRepositoryProvider));
      ref.invalidate(signInSessionsProvider);
      ref.read(toastProvider.notifier).show(done);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final list = ref.watch(signInSessionsProvider).value;
    if (list == null) return const SizedBox.shrink();
    final others = list.where((s) => !s.current).length;
    final shown = _all ? list : list.take(5).toList();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const GroupLabel('Where you’re signed in'),
        GroupCard(
          children: [
            for (final s in shown)
              InfoRow(
                icon: s.phone ? MoreIcons.deviceMobile : MoreIcons.desktop,
                title: s.current ? '${s.device} · this one' : s.device,
                subtitle: [
                  if (s.lastUsedAt != null) 'Last used ${Fmt.ago(s.lastUsedAt!).toLowerCase()}',
                  ?s.ip,
                  if (s.createdAt != null) 'signed in ${Fmt.day(s.createdAt!).toLowerCase()}',
                ].join(' · '),
                trailing: s.current
                    ? const Pill('Now', tone: PillTone.ok)
                    : TextButton(
                        onPressed: _busy ? null : () => _run((r) => r.signOutSession(s.id), 'Signed out'),
                        style: TextButton.styleFrom(
                          foregroundColor: c.badText,
                          minimumSize: const Size(44, 40),
                          textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 14, fontWeight: FontWeight.w600),
                        ),
                        child: const Text('Sign out'),
                      ),
              ),
            if (!_all && list.length > 5)
              InfoRow(icon: SbIcons.caretDown, title: 'Show all ${list.length}', onTap: () => setState(() => _all = true), trailing: const SizedBox.shrink()),
          ],
        ),
        if (others > 0) ...[
          const SizedBox(height: 10),
          _Outline(label: 'Sign out everywhere else ($others)', onTap: () => _run((r) => r.signOutOthers(), 'Signed out everywhere else')),
        ],
        const SizedBox(height: 8),
        Text('Something you don’t recognise? Sign it out and change your password.', style: TextStyle(fontSize: 13, color: c.mu)),
      ],
    );
  }
}

// ------------------------------------------------------------------ the assistant's memory

class _Memories extends ConsumerStatefulWidget {
  const _Memories();

  @override
  ConsumerState<_Memories> createState() => _MemoriesState();
}

class _MemoriesState extends ConsumerState<_Memories> {
  final _text = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _text.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function(AccountRepository r) call) async {
    setState(() => _busy = true);
    try {
      await call(ref.read(accountRepositoryProvider));
      ref.invalidate(memoriesProvider);
    } catch (e) {
      ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    final list = ref.watch(memoriesProvider).value ?? const <Memory>[];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const GroupLabel('What the assistant remembers'),
        GroupCard(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
              child: Text(
                list.isEmpty
                    ? 'Nothing yet. Say “remember that…” to the assistant, or add one here. Only you see these.'
                    : 'Things you asked it to remember in this home. Only you see these. You can also say “forget that”.',
                style: TextStyle(fontSize: 13.5, color: c.mu, height: 1.35),
              ),
            ),
            for (final m in list)
              InfoRow(
                icon: SbIcons.sparkle,
                title: m.text,
                trailing: IconButton(
                  tooltip: 'Forget',
                  onPressed: _busy ? null : () => _run((r) => r.forget(m.id)),
                  icon: SbIcon(SbIcons.trash, size: 17, color: c.mu),
                ),
              ),
            Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _text,
                      maxLength: 300,
                      style: TextStyle(fontSize: 15, color: c.tx),
                      onChanged: (_) => setState(() {}),
                      decoration: const InputDecoration(hintText: 'e.g. Ali’s room is the upstairs bedroom', counterText: ''),
                    ),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: _busy || _text.text.trim().length < 2
                        ? null
                        : () => _run((r) async {
                              await r.remember(_text.text);
                              _text.clear();
                            }),
                    style: FilledButton.styleFrom(
                      backgroundColor: c.tx,
                      foregroundColor: c.bg,
                      minimumSize: const Size(64, 50),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
                      textStyle: const TextStyle(fontFamily: SbFonts.sans, fontSize: 15, fontWeight: FontWeight.w600),
                    ),
                    child: const Text('Add'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
