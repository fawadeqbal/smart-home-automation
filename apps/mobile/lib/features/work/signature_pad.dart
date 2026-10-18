import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';

/// The customer signs with a finger: strokes are kept as lines of points, drawn as they go, and turned
/// into a small PNG (a data URL, like the web's canvas) when the signature is saved.
class SignatureController extends ChangeNotifier {
  final List<List<Offset>> _strokes = [];
  Size _size = Size.zero;

  List<List<Offset>> get strokes => _strokes;
  bool get isEmpty => _strokes.every((s) => s.length < 2);

  void _start(Offset p) {
    _strokes.add([p]);
    notifyListeners();
  }

  void _extend(Offset p) {
    if (_strokes.isEmpty) return;
    _strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    _strokes.clear();
    notifyListeners();
  }

  /// The signature as `data:image/png;base64,…`, dark ink on a transparent background; null when empty.
  Future<String?> toDataUrl({double pixelRatio = 2}) async {
    if (isEmpty || _size.isEmpty) return null;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(pixelRatio);
    paintStrokes(canvas, _strokes, const Color(0xFF111827));
    final picture = recorder.endRecording();
    final image = await picture.toImage((_size.width * pixelRatio).round(), (_size.height * pixelRatio).round());
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    image.dispose();
    picture.dispose();
    if (bytes == null) return null;
    return 'data:image/png;base64,${base64Encode(bytes.buffer.asUint8List())}';
  }
}

void paintStrokes(Canvas canvas, List<List<Offset>> strokes, Color color) {
  final paint = Paint()
    ..color = color
    ..strokeWidth = 2.4
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round
    ..style = PaintingStyle.stroke;
  for (final s in strokes) {
    if (s.length == 1) {
      canvas.drawCircle(s.first, 1.2, paint..style = PaintingStyle.fill);
      paint.style = PaintingStyle.stroke;
      continue;
    }
    final path = Path()..moveTo(s.first.dx, s.first.dy);
    for (var i = 1; i < s.length; i++) {
      // smooth the line through the midpoints
      final a = s[i - 1], b = s[i];
      path.quadraticBezierTo(a.dx, a.dy, (a.dx + b.dx) / 2, (a.dy + b.dy) / 2);
    }
    path.lineTo(s.last.dx, s.last.dy);
    canvas.drawPath(path, paint);
  }
}

/// A white pad to sign on (white in the dark theme too, like paper), with "Sign above" and Clear.
class SignaturePad extends StatelessWidget {
  const SignaturePad({super.key, required this.controller, this.height = 180, this.onChanged});
  final SignatureController controller;
  final double height;
  final VoidCallback? onChanged;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Container(
          height: height,
          decoration: BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: c.ln2),
          ),
          clipBehavior: Clip.antiAlias,
          child: LayoutBuilder(
            builder: (context, box) {
              controller._size = box.biggest;
              return GestureDetector(
                key: const ValueKey('signature-pad'),
                behavior: HitTestBehavior.opaque,
                onPanStart: (d) => controller._start(d.localPosition),
                onPanUpdate: (d) => controller._extend(d.localPosition),
                onPanEnd: (_) => onChanged?.call(),
                onTapDown: (d) => controller._start(d.localPosition),
                onTapUp: (_) => onChanged?.call(),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Positioned(
                      left: 20,
                      right: 20,
                      bottom: 36,
                      child: Container(height: 1, color: const Color(0xFFD9D6CE)),
                    ),
                    Positioned.fill(
                      child: RepaintBoundary(
                        child: CustomPaint(painter: _SignaturePainter(controller)),
                      ),
                    ),
                  ],
                ),
              );
            },
          ),
        ),
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(
            children: [
              Expanded(
                child: Text('Sign above with a finger', style: TextStyle(fontSize: 12.5, color: c.mu)),
              ),
              TextButton(
                onPressed: () {
                  controller.clear();
                  onChanged?.call();
                },
                style: TextButton.styleFrom(
                  textStyle: const TextStyle(fontFamily: 'Geist', fontSize: 14, fontWeight: FontWeight.w600),
                ),
                child: const Text('Clear'),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _SignaturePainter extends CustomPainter {
  _SignaturePainter(this.controller) : super(repaint: controller);
  final SignatureController controller;

  @override
  void paint(Canvas canvas, Size size) => paintStrokes(canvas, controller.strokes, const Color(0xFF111827));

  @override
  bool shouldRepaint(_SignaturePainter old) => true;
}
