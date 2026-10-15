import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_exception.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/sb_colors.dart';
import '../../core/theme/sb_icons.dart';
import '../../data/models/device.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/sheet.dart';
import '../../state/devices.dart';
import '../../state/session.dart';
import '../../state/toast.dart';

/// Switches [devices] to [on] together, with "— 4 things changed  [Undo]".
Future<void> switchAll(
  WidgetRef ref,
  List<Device> devices, {
  required bool on,
  required String label,
}) async {
  final toast = ref.read(toastProvider.notifier);
  try {
    final result = await ref.read(devicesProvider.notifier).setMany({
      for (final d in devices) d.id: on,
    });
    final n = result.changed;
    final failed = result.failed.isEmpty ? '' : ' · ${result.failed.length} didn’t answer';
    toast.show(
      n == 0 && result.failed.isEmpty
          ? '$label — already done'
          : '$label — $n thing${n == 1 ? '' : 's'} changed$failed',
      error: n == 0 && result.failed.isNotEmpty,
      undo: n == 0
          ? null
          : () async {
              await ref.read(devicesProvider.notifier).setMany(result.previous);
              toast.show('Undone — everything is back');
            },
    );
  } catch (e) {
    toast.show(ApiException.from(e).message, error: true);
  }
}

/// Picks another home (people who belong to more than one).
Future<void> showHomePicker(BuildContext context, WidgetRef ref) {
  final me = ref.read(sessionProvider).value;
  if (me == null) return Future.value();
  return showSbSheet<void>(
    context,
    builder: (ctx) {
      final c = ctx.sb;
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('Your homes', style: SbText.title.copyWith(color: c.tx)),
          const SizedBox(height: 14),
          for (final h in me.homes)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Pressable(
                onTap: () async {
                  Navigator.of(ctx).pop();
                  try {
                    await ref.read(sessionProvider.notifier).openHome(h.id);
                  } catch (e) {
                    ref.read(toastProvider.notifier).show(ApiException.from(e).message, error: true);
                  }
                },
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: h.id == me.home?.id ? c.onSoft : c.sf,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: h.id == me.home?.id ? c.on : c.ln2,
                    ),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 40,
                        height: 40,
                        decoration: BoxDecoration(
                          color: c.on,
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: const Center(
                          child: SbIcon(
                            SbIcons.house,
                            size: 20,
                            color: SbColors.onInk,
                            weight: IconWeight.fill,
                          ),
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              h.name,
                              style: TextStyle(
                                fontSize: 15.5,
                                fontWeight: FontWeight.w600,
                                color: c.tx,
                              ),
                            ),
                            Text(
                              [
                                h.role.label,
                                if (h.city.isNotEmpty) h.city,
                              ].join(' · '),
                              style: TextStyle(fontSize: 13, color: c.mu),
                            ),
                          ],
                        ),
                      ),
                      if (h.id == me.home?.id)
                        SbIcon(
                          SbIcons.check,
                          size: 18,
                          color: c.onText,
                          weight: IconWeight.bold,
                        ),
                    ],
                  ),
                ),
              ),
            ),
        ],
      );
    },
  );
}
