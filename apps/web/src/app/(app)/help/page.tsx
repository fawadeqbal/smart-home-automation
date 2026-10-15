'use client';
import Link from 'next/link';
import { useSession } from '@/lib/session';

const VOICE = [
  'Turn on the bedroom light',
  'Switch off everything in the kitchen',
  'Is the front door open?',
  'What is the temperature in the living room?',
  'Batti band karo (Urdu works too)',
];

export default function HelpPage() {
  const { isAdmin } = useSession();
  return (
    <div className="help-page">
      <div className="page-head">
        <div>
          <h1>Help</h1>
          <p className="muted">Everything you can do here, in plain words.</p>
        </div>
      </div>

      <section className="card card-pad stack">
        <h2>Using your home</h2>
        <dl className="faq">
          <dt>How do I switch a light on or off?</dt>
          <dd>On <Link href="/">Home</Link>, tap its tile. It turns amber when it is on. The change takes about a second; a spinner shows while it happens.</dd>
          <dt>Can I just talk to it?</dt>
          <dd>Yes. Tap the purple microphone on Home, speak, and tap again to send. You can also type. Try:
            <ul>{VOICE.map((v) => <li key={v}>“{v}”</li>)}</ul>
            The assistant only controls the rooms you have access to.</dd>
          <dt>A tile is grey and says “Offline”.</dt>
          <dd>The little controller board behind that switch has lost Wi‑Fi or power. The wall switch still works. It comes back by itself when the board reconnects{isAdmin ? <> — see <Link href="/diagnostics">Diagnostics</Link> for details</> : ''}.</dd>
          <dt>What does “View history” show?</dt>
          <dd>When a light was switched and by whom (app, voice or wall switch), or a sensor’s readings over time.</dd>
          <dt>Why can’t I see some rooms?</dt>
          <dd>The home owner decides who can see and control each room. Ask them in <b>Family</b>.</dd>
        </dl>
      </section>

      {isAdmin && (
        <>
          <section className="card card-pad stack">
            <h2>Boards (set up by your installer)</h2>
            <dl className="faq">
              <dt>What is a board?</dt>
              <dd>A small Wi‑Fi controller (NodeMCU / ESP8266) hidden behind a switchboard. Lights, relays, sensors and wall buttons are wired to its pins, and it talks to this app over Wi‑Fi.</dd>
              <dt>Adding a new board</dt>
              <dd>
                <ol>
                  <li>Your installer company adds the board to its inventory and assigns it to your home.</li>
                  <li>On site, the installer powers it and connects it to your Wi‑Fi (the <b>HomeNode‑xxxxxx</b> setup page).</li>
                  <li>It shows as <b>ready to install</b> in their console; they name it after its room and wire your lights to it.</li>
                </ol>
              </dd>
              <dt>Adding a light, sensor or wall button</dt>
              <dd>The installer opens the board → <b>Devices</b> → <b>Add device</b>, picks what it is and which pin it is wired to. You see every pin under <Link href="/diagnostics">Diagnostics</Link>.</dd>
              <dt>Which pin do I use?</dt>
              <dd>Board → <b>Pins & wiring</b> (installers). Green rings are free, blue are in use, yellow are power (3V, G = ground, VIN/VU = 5 V), grey are reserved. Good first choices: <b>D1</b> for a relay, <b>D2</b> for a temperature sensor, <b>D5</b> for a wall button.</dd>
              <dt>What do the board’s colours mean?</dt>
              <dd><span className="text-ok">Green</span> = healthy. <span className="text-warn">Amber</span> = working but needs attention (weak Wi‑Fi, low voltage, low memory, still saving settings). <span className="text-bad">Red</span> = disconnected or it refused the settings.</dd>
              <dt>The board’s little blue light</dt>
              <dd>Fast blinking = can’t find Wi‑Fi. Slow blinking = Wi‑Fi OK but can’t reach this app (check the server address and the PC’s firewall). Off = connected. Hold <b>FLASH</b> right after pressing <b>RST</b> to open its Wi‑Fi setup again.</dd>
              <dt>Safety</dt>
              <dd>Mains electricity (220 V) can kill. Test with an LED first and switch off the breaker before wiring a real bulb, or ask an electrician.</dd>
            </dl>
          </section>
          <section className="card card-pad stack">
            <h2>Rooms and people</h2>
            <dl className="faq">
              <dt>Rooms</dt>
              <dd>Group devices by room. Access is given per room, so a guest can control the guest room only.</dd>
              <dt>Inviting someone</dt>
              <dd>In <Link href="/people">People</Link>, create an invite link and send it. They choose their own password. Then pick, room by room, whether they can <b>see</b> or <b>control</b>.</dd>
            </dl>
          </section>
        </>
      )}
    </div>
  );
}
