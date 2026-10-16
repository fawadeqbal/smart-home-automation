import 'package:flutter_test/flutter_test.dart';
import 'package:switchboard_home/features/me/change_password.dart';

void main() {
  test('the phone checks a new password like the server does', () {
    expect(passwordProblem('short1'), 'Use at least 8 characters.');
    expect(passwordProblem('onlyletters'), 'Add a number or a symbol.');
    expect(passwordProblem('Pakistan123'), 'That password is too common. Choose another one.');
    expect(passwordProblem('lamp-post-42'), isNull);
  });
}
