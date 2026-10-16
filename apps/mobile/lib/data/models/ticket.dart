import 'json.dart';

/// One line in a help request's conversation.
class TicketMessage {
  const TicketMessage({required this.body, this.by, this.staff = false, this.event = false, this.at});

  factory TicketMessage.fromJson(Json j) =>
      TicketMessage(body: str(j['body']), by: strOrNull(j['by']), staff: boolean(j['staff']), event: boolean(j['event']), at: dateOrNull(j['at']));

  final String body;
  final String? by;

  /// Written by the installer's team.
  final bool staff;

  /// "Status: Solved" and the like.
  final bool event;
  final DateTime? at;
}

/// A help request from this home (`/support/tickets`).
class Ticket {
  const Ticket({required this.id, required this.number, required this.title, this.status = 'OPEN', this.statusText = '', this.updatedAt, this.messages = const []});

  factory Ticket.fromJson(Json j) => Ticket(
        id: str(j['id']),
        number: integer(j['number']),
        title: str(j['title'], 'Help request'),
        status: str(j['status'], 'OPEN'),
        statusText: str(j['statusText']),
        updatedAt: dateOrNull(j['updatedAt']),
        messages: asJsonList(j['messages']).map(TicketMessage.fromJson).toList(),
      );

  final String id;
  final int number;
  final String title;
  final String status;
  final String statusText;
  final DateTime? updatedAt;
  final List<TicketMessage> messages;

  bool get done => status == 'RESOLVED' || status == 'CLOSED';
  bool get waitingForYou => status == 'WAITING';
}
