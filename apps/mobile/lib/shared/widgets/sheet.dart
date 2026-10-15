import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';

/// Opens a bottom sheet the way the design draws them: rounded top, a grab handle, up to 88% tall.
Future<T?> showSbSheet<T>(
  BuildContext context, {
  required WidgetBuilder builder,
  bool scrollable = true,
}) {
  final c = context.sb;
  return showModalBottomSheet<T>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    showDragHandle: false,
    backgroundColor: c.sf,
    barrierColor: const Color(0x6B0A0B0E),
    constraints: BoxConstraints(
      maxHeight: MediaQuery.sizeOf(context).height * .88,
      maxWidth: 640,
    ),
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(32)),
    ),
    builder: (ctx) {
      final body = Padding(
        padding: EdgeInsets.fromLTRB(
          20,
          10,
          20,
          28 + MediaQuery.viewInsetsOf(ctx).bottom + MediaQuery.paddingOf(ctx).bottom,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: Container(
                width: 40,
                height: 5,
                margin: const EdgeInsets.only(bottom: 14),
                decoration: BoxDecoration(
                  color: c.sf3,
                  borderRadius: BorderRadius.circular(999),
                ),
              ),
            ),
            builder(ctx),
          ],
        ),
      );
      return scrollable ? SingleChildScrollView(child: body) : body;
    },
  );
}
