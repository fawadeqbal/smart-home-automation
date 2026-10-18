import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';

import '../../core/theme/sb_colors.dart';

/// The strokes of a signature, and turning them into a PNG (dark ink, see-through background, like the web's).
class SignOffController extends ChangeNotifier {
  final List<List<Offset>> strokes = [];
  Size size = Size.zero;

  bool get isEmpty => strokes.every((s) => s.length < 2);

  void start(Offset p) {
    strokes.add([p]);
    notifyListeners();
  }

  void add(Offset p) {
    if (strokes.isEmpty) return start(p);
    strokes.last.add(p);
    notifyListeners();
  }

  void clear() {
    strokes.clear();
    notifyListeners();
  }

  /// The drawing at twice its size on screen.
  Future<Uint8List?> toPng({double scale = 2}) async {
    if (isEmpty || size.isEmpty) return null;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder)..scale(scale);
    paintStrokes(canvas, strokes, const Color(0xFF111827));
    final image = await recorder.endRecording().toImage((size.width * scale).ceil(), (size.height * scale).ceil());
    final data = await image.toByteData(format: ui.ImageByteFormat.png);
    return data?.buffer.asUint8List();
  }
}

void paintStrokes(Canvas canvas, List<List<Offset>> strokes, Color ink) {
  final paint = Paint()
    ..color = ink
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
    for (final p in s.skip(1)) {
      path.lineTo(p.dx, p.dy);
    }
    canvas.drawPath(path, paint);
  }
}

/// Sign with a finger. It takes the touch at once, so drawing down doesn't scroll the page instead.
/// Always on white (a signature is dark ink), in both themes.
class SignOffPad extends StatelessWidget {
  const SignOffPad({super.key, required this.controller, this.height = 170});
  final SignOffController controller;
  final double height;

  @override
  Widget build(BuildContext context) {
    final c = context.sb;
    return Semantics(
      label: 'Sign here with your finger',
      child: Container(
        height: height,
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(16), border: Border.all(color: c.ln2)),
        clipBehavior: Clip.antiAlias,
        child: LayoutBuilder(
          builder: (context, box) {
            controller.size = Size(box.maxWidth, box.maxHeight);
            return RawGestureDetector(
              gestures: {EagerGestureRecognizer: GestureRecognizerFactoryWithHandlers<EagerGestureRecognizer>(EagerGestureRecognizer.new, (_) {})},
              child: Listener(
                behavior: HitTestBehavior.opaque,
                onPointerDown: (e) => controller.start(e.localPosition),
                onPointerMove: (e) => controller.add(e.localPosition),
                child: ListenableBuilder(
                  listenable: controller,
                  builder: (context, _) => CustomPaint(
                    size: Size(box.maxWidth, box.maxHeight),
                    painter: _SignOffPainter(controller.strokes, controller.strokes.fold(0, (a, s) => a + s.length)),
                    child: controller.isEmpty
                        ? const Center(child: Text('Sign here', style: TextStyle(fontSize: 15, color: Color(0xFF9AA0A6))))
                        : null,
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _SignOffPainter extends CustomPainter {
  _SignOffPainter(this.strokes, this.points);
  final List<List<Offset>> strokes;
  final int points;

  @override
  void paint(Canvas canvas, Size size) {
    final line = Paint()
      ..color = const Color(0xFFE5E7EB)
      ..strokeWidth = 1;
    canvas.drawLine(Offset(16, size.height - 34), Offset(size.width - 16, size.height - 34), line);
    paintStrokes(canvas, strokes, const Color(0xFF111827));
  }

  @override
  bool shouldRepaint(_SignOffPainter old) => old.points != points || old.strokes.length != strokes.length;
}
