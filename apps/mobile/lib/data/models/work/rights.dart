import 'package:flutter/foundation.dart';

import '../json.dart';

/// A role on the company's team, as the API writes it (`SUPERADMIN`, `INSTALLER`, `SUPPORT`).
enum StaffRole {
  superadmin('Super admin'),
  installer('Installer'),
  support('Support');

  const StaffRole(this.label);
  final String label;

  /// An unknown role gets the fewest rights (support only reads).
  static StaffRole fromJson(Object? value) => enumOf(values, value, support);
}

/// What a staff member may do on the phone. The API decides in the end; the screens use this to hide
/// what someone can't do (the same rules as the web console):
///
/// * super admins: everything in the company;
/// * installers: the homes assigned to them (Home.installerId) — boards, devices, firmware, the
///   installation report; they can take a ticket but not hand it to someone else;
/// * support: reads every home, changes nothing there. They do answer tickets (that is their job,
///   and the API lets them), so the ticket screens are the one place they can write.
@immutable
class WorkRights {
  const WorkRights({required this.role, required this.userId});

  final StaffRole role;
  final String userId;

  bool get isSuper => role == StaffRole.superadmin;
  bool get isInstaller => role == StaffRole.installer;
  bool get readOnly => role == StaffRole.support;

  /// Boards, devices, wall buttons, firmware and restarts in a home with this installer.
  bool canSetup(String? homeInstallerId) =>
      isSuper || (isInstaller && homeInstallerId != null && homeInstallerId == userId);

  /// Ticks, photos and the customer's signature on the installation report.
  bool canEditInstallation(String? homeInstallerId) => canSetup(homeInstallerId);

  /// Opening a signed report again (the signature is removed).
  bool get canReopenInstallation => isSuper;

  /// Looking at another person's day (installers only see their own).
  bool get canPickInstaller => !isInstaller;

  /// Answering tickets and changing their status and priority.
  bool get canWorkTickets => true;

  /// Handing a ticket to anyone on the team; installers can only take one themselves.
  bool get canAssignTickets => !isInstaller;

  /// Boards in stock (support may look), and giving one to a home (super admins).
  bool get seesStock => !isInstaller;
  bool get canAssignStock => isSuper;

  /// The website's visit requests (installers get theirs in Today).
  bool get seesVisitRequests => !isInstaller;

  /// Quotes: everyone may read them.
  bool get seesQuotes => true;
}
