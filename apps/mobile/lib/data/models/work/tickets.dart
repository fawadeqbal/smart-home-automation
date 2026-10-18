import 'package:flutter/foundation.dart';

import '../json.dart';
import 'homes.dart';
import 'rights.dart';

/// Where a ticket stands, as the API writes it.
enum TicketState {
  open('Open', Tone.warn),
  inProgress('Being worked on', Tone.info),
  waiting('Waiting for the home', Tone.warn),
  resolved('Solved', Tone.ok),
  closed('Closed', Tone.mute);

  const TicketState(this.label, this.tone);
  final String label;
  final Tone tone;

  String get json => switch (this) {
    inProgress => 'IN_PROGRESS',
    _ => name.toUpperCase(),
  };

  bool get isOpen => this == open || this == inProgress || this == waiting;

  static TicketState fromJson(Object? v) => switch (str(v)) {
    'IN_PROGRESS' => inProgress,
    'WAITING' => waiting,
    'RESOLVED' => resolved,
    'CLOSED' => closed,
    _ => open,
  };
}

enum TicketPriority {
  urgent('Urgent', Tone.bad),
  high('High', Tone.warn),
  normal('Normal', Tone.mute),
  low('Low', Tone.mute);

  const TicketPriority(this.label, this.tone);
  final String label;
  final Tone tone;

  String get json => name.toUpperCase();
  static TicketPriority fromJson(Object? v) => enumOf(values, v, normal);
}

const ticketCategories = {
  'fault': 'Something isn’t working',
  'installation': 'New work or a change',
  'billing': 'Billing',
  'question': 'A question',
  'other': 'Something else',
};

@immutable
class StaffMessage {
  const StaffMessage({
    required this.id,
    required this.body,
    this.by,
    this.at,
    this.internal = false,
    this.event = false,
    this.staff = false,
  });

  factory StaffMessage.fromJson(Json json) => StaffMessage(
    id: str(json['id']),
    body: str(json['body']),
    by: strOrNull(json['by']),
    at: dateOrNull(json['at']),
    internal: boolean(json['internal']),
    event: boolean(json['event']),
    staff: boolean(json['staff']),
  );

  final String id;
  final String body;
  final String? by;
  final DateTime? at;

  /// A note only the team sees.
  final bool internal;

  /// "Status: Solved", "Assigned to Ravi" — written by the system.
  final bool event;

  /// Written by the team (not the home).
  final bool staff;
}

/// A ticket as the team sees it (`/platform/tickets`, `/platform/tickets/:id`).
@immutable
class StaffTicket {
  const StaffTicket({
    required this.id,
    required this.number,
    required this.title,
    this.category = 'fault',
    this.state = TicketState.open,
    this.priority = TicketPriority.normal,
    this.homeId = '',
    this.home = '',
    this.city = '',
    this.nodeId,
    this.openedBy,
    this.assigneeId,
    this.assignee,
    this.dueAt,
    this.overdue = false,
    this.createdAt,
    this.updatedAt,
    this.rating,
    this.ratingComment,
    this.messages = const [],
    this.last,
    this.team = const [],
    this.contactName,
    this.contactWhatsapp,
    this.company = '',
    this.node,
  });

  factory StaffTicket.fromJson(Json json) {
    final last = asJson(json['last']);
    final contact = asJson(json['contact']);
    final node = asJson(json['node']);
    return StaffTicket(
      id: str(json['id']),
      number: integer(json['number']),
      title: str(json['title'], 'Request'),
      category: str(json['category'], 'fault'),
      state: TicketState.fromJson(json['status']),
      priority: TicketPriority.fromJson(json['priority']),
      homeId: str(json['homeId']),
      home: str(json['home']),
      city: str(json['city']),
      nodeId: strOrNull(json['nodeId']),
      openedBy: strOrNull(json['openedBy']),
      assigneeId: strOrNull(json['assigneeId']),
      assignee: strOrNull(json['assignee']),
      dueAt: dateOrNull(json['dueAt']),
      overdue: boolean(json['overdue']),
      createdAt: dateOrNull(json['createdAt']),
      updatedAt: dateOrNull(json['updatedAt']),
      rating: json['rating'] is num ? (json['rating'] as num).round() : null,
      ratingComment: strOrNull(json['ratingComment']),
      messages: asJsonList(json['messages']).map(StaffMessage.fromJson).toList(),
      last: last.isEmpty
          ? null
          : StaffMessage(
              id: 'last',
              body: str(last['text']),
              by: strOrNull(last['by']),
              internal: boolean(last['internal']),
              at: dateOrNull(last['at']),
            ),
      team: [
        for (final s in asJsonList(json['staff']))
          (id: str(s['id']), name: str(s['name'], 'Someone'), role: StaffRole.fromJson(s['staffRole'])),
      ],
      contactName: strOrNull(contact['name']),
      contactWhatsapp: strOrNull(contact['whatsapp']),
      company: str(json['company']),
      node: node.isEmpty
          ? null
          : (id: str(node['id']), name: str(node['name'], str(node['id'])), online: boolean(node['online'])),
    );
  }

  final String id;
  final int number;
  final String title;
  final String category;
  final TicketState state;
  final TicketPriority priority;
  final String homeId, home, city;
  final String? nodeId;
  final String? openedBy;
  final String? assigneeId, assignee;

  /// When it should be answered by.
  final DateTime? dueAt;
  final bool overdue;
  final DateTime? createdAt, updatedAt;
  final int? rating;
  final String? ratingComment;
  final List<StaffMessage> messages;

  /// The newest message (in the list).
  final StaffMessage? last;

  /// The team, to hand it to someone (in a single ticket).
  final List<({String id, String name, StaffRole role})> team;
  final String? contactName, contactWhatsapp;
  final String company;
  final ({String id, String name, bool online})? node;

  String get categoryLabel => ticketCategories[category] ?? category;

  /// The last thing the team told the home (not a team-only note), for a WhatsApp update.
  String? get lastReply => messages.reversed.where((m) => !m.event && !m.internal && m.staff).firstOrNull?.body;

  bool matches(String term) {
    final t = term.trim().toLowerCase();
    return t.isEmpty || '$number $title $home $city'.toLowerCase().contains(t);
  }
}

/// The team's queue (`/platform/tickets`).
@immutable
class TicketQueue {
  const TicketQueue({this.tickets = const [], this.open = 0, this.overdue = 0});

  factory TicketQueue.fromJson(Json json) => TicketQueue(
    tickets: asJsonList(json['tickets']).map(StaffTicket.fromJson).toList(),
    open: integer(json['open']),
    overdue: integer(json['overdue']),
  );

  final List<StaffTicket> tickets;
  final int open, overdue;
}

const _rank = {TicketPriority.urgent: 0, TicketPriority.high: 1, TicketPriority.normal: 2, TicketPriority.low: 3};

/// Open ones: overdue first, then the most urgent; solved ones as the server sends them (newest first).
List<StaffTicket> sortTickets(List<StaffTicket> list) {
  final out = [...list];
  out.sort((a, b) {
    if (a.state.isOpen != b.state.isOpen) return a.state.isOpen ? -1 : 1;
    if (!a.state.isOpen) return 0;
    if (a.overdue != b.overdue) return a.overdue ? -1 : 1;
    return _rank[a.priority]!.compareTo(_rank[b.priority]!);
  });
  return out;
}
