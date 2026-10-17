# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Three audiences, weighted equally; each surface is tuned for the people who use it.

- **Homeowners and their families** (owner, home admin, member, guest). Non-technical households in Pakistan, often elders and children, mostly on phones. Job: switch lights, fans and appliances, run scenes and timers, see what happened, invite family, ask the assistant. Members and guests see only the rooms shared with them.
- **The service company's staff** (super admin, installer, support). Fawad's own company is the only one (self-hosted, no plan limits). Super admin runs the console: homes, board inventory, visit requests, tickets, team, Help Center. Installers see only their assigned homes ("My jobs") and do on-site work: install boards, configure pins, set up rooms, send the owner invite. Support reads everything and changes nothing.
- **Prospective customers** on the public landing page, deciding whether to book a free home visit.

## Product Purpose

Switchboard lets a local installer turn an ordinary Pakistani home into one controlled from a phone, the web and by voice, using ESP8266 boards wired behind existing fittings. The company installs, monitors and supports every home; the household just uses it. Success: families control their home without thinking about it, and staff can see and fix board problems before customers notice.

## Positioning

A done-for-you service, not a DIY gadget: a real expert in the customer's city visits, installs, names every device, invites the family, and keeps watching the home afterwards. Built for local conditions: load-shedding (UPS/solar, state kept after power returns), mixed Urdu/English voice, WhatsApp as the sharing channel, rupee electricity estimates.

## Operating Context

- Owners use the web app (installable PWA) and an Android phone app; the web app must work well at phone width.
- Staff use the console on laptops and on site from phones (installers wiring boards).
- No email for invites: every invite is a link to copy or share on WhatsApp. Password reset email via Gmail is being added.
- Boards go offline often (power cuts, weak Wi-Fi, ISP drops); the UI distinguishes power cuts from internet outages and shows board connection history.
- A home's life: create home and owner invite, assign boards from inventory, installer installs and configures pins, rooms, owner accepts invite. A board's life: In stock, Assigned, Installed, Faulty.

## Capabilities and Constraints

- Stack: Next.js 15 / React 19 app in `apps/web`, hand-written CSS (`src/app/globals.css`, `auth.css`, `landing.css`), no UI library. Light and dark themes via `html[data-theme]`.
- Owner side: home, rooms, device cards and device pages, automations (timers, scenes, rules), people and room rights, activity, energy estimates, summaries, notifications, diagnostics, support tickets, help, account (two-step sign-in, sessions).
- Console: overview, homes, boards/inventory, connectivity, visit requests, tickets, team, roles, Help Center editor, firmware, settings, console assistant.
- Assistant: chat and voice ("Hey Switchboard" wake word, hidden until the model ships), available to owners and, in the console, to staff.
- Local control without internet is phone-app only (browsers can't reach http boards).
- Screens are English only for now; the assistant handles Urdu and Roman Urdu.
- Known gaps the UI must not paper over: no AC temperature/fan speed control, momentary wall buttons only until firmware with wall-switch support ships, devices restore their state after a power cut.

## Brand Commitments

- Name: **Switchboard** (keep).
- Logo: the toggle mark (the `toggle-right` switch icon) stays.
- Visual direction (chosen 17 Oct 2026): the category standard, played straight at full craft. Benchmarks the work must sit alongside: Apple Home and Google Home (owner side: rounded tiles, big tappable states, calm type, soft colour), Tesla / Ring apps (device-first, one hero control, a first-class dark mode), and Linear / Vercel (staff console: crisp, dense, fast). No ironic or novelty styling.

## Evidence on Hand

- Landing photos are Unsplash images with credits in `src/components/landing/Landing.tsx`.
- Service cities named on the landing page: Lahore, Karachi, Islamabad.
- No customer testimonials, customer counts, ratings or press exist. Do not invent them.
- No published prices beyond the energy calculator's tariff default (Rs 60 per unit).

## Product Principles

1. The household should never need to understand the hardware; staff should always be able to.
2. Say what is true: never promise a capability the boards or firmware don't have.
3. Rights are visible: people see only what they may see, and the UI says plainly why something is locked.
4. Offline is normal, not an error: board and internet drops are explained in plain words with what to do.
5. One company, one face: the household experiences a local service with real people behind it.

## Accessibility & Inclusion

Elders and children use the owner side: large touch targets, readable type sizes, clear on/off states that don't rely on color alone, and plain English copy.
