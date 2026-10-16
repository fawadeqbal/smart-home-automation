import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/features/assistant/reply_text.dart';

void main() {
  test('plainReply drops Markdown signs and joins the lines', () {
    expect(
      plainReply('To add him:\n\n1. Open **People**\n- Tap [Invite](/help?a=x)\n## Done'),
      'To add him: 1. Open People Tap Invite Done',
    );
    expect(plainReply('The fan is on.'), 'The fan is on.');
  });

  testWidgets('ReplyText shows bold as bold and list items as bullets', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(body: ReplyText('Open **People**, then:\n- **Invite someone**\n- pick a role', style: TextStyle())),
    ));
    final rich = tester.widget<RichText>(find.byType(RichText).first);
    final root = rich.text as TextSpan;
    expect(root.toPlainText(), 'Open People, then:\n•  Invite someone\n•  pick a role');
    final bold = <String>[];
    root.visitChildren((span) {
      if (span is TextSpan && span.style?.fontWeight == FontWeight.w700 && span.text != null) bold.add(span.text!);
      return true;
    });
    expect(bold, ['People', 'Invite someone']);
  });
}
