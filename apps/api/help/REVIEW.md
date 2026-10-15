# Help Center starter set: review list

All 7 policy articles are drafts (`published: false`). Every number or promise I had to choose is marked inline as `[[check: …]]`, so you can search for `[[check`. When you've decided, replace the default, delete the marker, and publish the article in the console. This file is not loaded as an article.

## 1. Policy defaults to confirm

### policy/warranty.md
| Text | Default chosen |
|---|---|
| Board warranty length | 12 months from installation |
| Workmanship warranty length | 6 months from installation |
| Warranty visits and labour | Free (visit + labour + part) |
| Proof of purchase | No receipt needed; the home's record in the system is enough |
| Surge damage | Excluded (surges, lightning, voltage swings, faulty UPS/inverter/generator) |
| Wi-Fi extender | Advised; supplied at extra cost |
| Firmware/app updates | Free for as long as the home uses Switchboard |

### policy/service-visits-and-charges.md
| Text | Default chosen |
|---|---|
| First visit | Free, no obligation (matches the website) |
| Remote help | Always free |
| Service visit within city limits | Rs 1,500 |
| Out-of-city visit | Rs 1,500 + travel, quoted beforehand |
| Labour after the first hour | Rs 1,000 per hour |
| Out-of-warranty board replacement | Quoted at the time |
| Add-ons (new board/device/sensor/button) | Quoted before work |
| On-site Wi-Fi re-setup (router changed, boards offline) | Normal visit fee |
| Visit fee if the problem turns out to be under warranty | Waived |
| Visit lead time | Within 2 working days in Lahore, Karachi, Islamabad |
| Payment methods | Cash, bank transfer, JazzCash, Easypaisa |
| Payment timing | When the work is done (new installs: advance) |
| Missed visit | Visit fee may be charged without 2 hours' notice |

### policy/cancellations-and-refunds.md
| Text | Default chosen |
|---|---|
| Advance | 50% when the price is accepted |
| Balance | Due when installation is finished and tested |
| Full-refund window | Cancel more than 48 hours before installation day |
| Late cancellation | Advance minus Rs 1,500 |
| Special-order parts | Their cost may be kept |
| Return window after installation | 7 days |
| Refund after installation | Hardware refunded minus installation labour |
| Service visits | Not refundable once work is done |
| Refund methods | Bank transfer, JazzCash, Easypaisa |
| Refund time | Within 10 working days |
| Account closure | Home removed on request |
| Phone number for cancellations | (blank) |

### policy/privacy-and-data.md
| Text | Default chosen |
|---|---|
| Device history retention | "Not deleted automatically" (that's what the code does: StateEvent and Command rows are never pruned). Decide on a period, or keep it as is. |
| Activity (audit) log retention | "Not deleted automatically" (same as above) |
| Visit request (lead) retention | "Not deleted automatically" (same as above) |
| Assistant transcripts in server logs | Retention not stated. The voice service logs what was heard and the reply (`log.info` in `speech/recognizer.py` and `conversation.py`). |
| AI provider | "Runs on our server". **Must be checked:** with `LLM_PROVIDER=claude`, request text plus the device list goes to Anthropic's API. With `ollama`, it stays on the server. |
| Sharing with third parties | Don't sell or share; list exceptions (hosting, AI provider if external) |
| Hosting provider and country | (blank) |
| Backups | "Regular backups". The CI deploy keeps the last 10 database backups. Confirm the schedule and retention. |
| Export/delete request deadline | 30 days. There's no self-service delete in the app, so this is done by staff. |
| Privacy contact | (blank) |

### policy/electrical-safety.md
| Text | Default chosen |
|---|---|
| Who wires mains | "Trained team members". Decide if a qualified electrician is required. |
| Distribution companies named | LESCO, K-Electric, IESCO "and others" |
| Heavy loads (AC, geyser, motor) | Only through a properly rated contactor/relay. Decide if the contactor is charged extra. |
| Unsafe wiring | Won't install on burnt/loose wiring or without a working breaker. Decide if earthing is required. |
| Wet areas | Not without a suitable waterproof enclosure |
| Sensor disclaimer | Convenience alerts, not certified smoke/gas alarms |
| Appliances not put on timers/remote | Examples: iron, heater near curtains. Make a list. |

### policy/acceptable-use-and-account-security.md
| Text | Default chosen |
|---|---|
| Staff never ask for passwords | Stated as a promise |
| Suspected compromise | "Tell us straight away" (no process defined) |
| How owners update contact details | Not defined. The app has no way for users to change their own email or name. |
| Misuse against household members | "Watch or control someone without their knowledge" is not allowed |
| Suspension rights | We may disable an account or pause access |
| Staff confidentiality | Staff use customer access only to serve that customer |

### policy/support-hours-and-response-times.md
| Text | Default chosen |
|---|---|
| Support days and hours | Monday–Saturday, 10:00–19:00 PKT |
| Closed days | Sundays and public holidays |
| Out-of-hours response | Automatic alerts 24/7; people respond in hours. **The landing page says "Looked after 24/7".** Decide which is true. |
| New visit request | Call within 1 working day (matches the website and console text) |
| App message first reply | Within 4 working hours |
| Urgent (whole home offline / safety) | Same working day |
| Visit lead time | Within 2 working days in Lahore, Karachi, Islamabad |
| Remote fixes | Usually during the first reply |
| Reply channels | Phone or WhatsApp |
| Support number | (blank) |

## 2. Facts in the other articles I wasn't sure about

- **How customers get the phone app** (`usage/install-the-app.md`). The repo has a built APK and iOS project, but nothing says how customers get it (Play Store, sideloaded APK, TestFlight). I wrote "Ask your installer how to get it" and didn't promise an iPhone app.
- **"Hey Switchboard" availability** (`usage/hey-switchboard-hands-free.md`). `wake.json` (web and phone) names `hey_switchboard.onnx`, and that file isn't in the repo, so the switch stays hidden until the trained model is deployed. The phone-app hands-free code is in commit `94bcd71` on branch `hey-switchboard`, which isn't merged into `main`. The article describes the feature as built, and says that if the switch isn't shown, hands-free isn't available.
- **Boards' connection encrypted** (`faq/security.md`). This is true only if production boards use "Encrypted: yes" on port 8883 (`MQTT_PUBLIC_PORT=8883`). Confirm for home.fawadiqbal.dev.
- **"Each board may only use its own messages"** (`faq/security.md`). The broker ACL does that, but every board shares one `MQTT_NODE_PASSWORD`, so anyone with it could connect under another board's ID. Fine within one company, but don't over-promise.
- **Self-claiming stock** (`process/board-stock-assign-install.md`). I wrote that a board that connects appears in **In stock** by itself. That's true only while the server has a single organization created as self-hosted (`selfHosted=true`). If production was seeded differently, boards must be added by ID.
- **Data usage** (`faq/data-usage.md`). There's no number in the article on purpose. A rough estimate from the code (telemetry JSON once a minute, DHT reading every 30 s, MQTT keep-alive 15 s, TLS overhead) is in the order of tens of MB per board per month. Measure it on a real board before quoting a figure.
- **Owner password reset / change of owner** (`troubleshooting/cant-sign-in.md`, `usage/roles-access-and-removing-people.md`, `process/support-escalation.md`). The app has no way to do either. The articles say "contact your installer" and escalate to a super admin, but there's no documented procedure. Today it would need a database change.
- **"They'll contact you by phone or WhatsApp"** (`process/get-help.md`). This is inferred: the app has no reply channel for support requests.
- **Existing rocker switches** (`faq/existing-switches.md`). The firmware only supports momentary push-buttons (`toggle_button`). I said it depends on the switchboards and is decided at the free visit, and didn't promise that existing switches work as they are.
- **Visit form cities** (`process/book-a-free-visit.md`). Lahore, Karachi, Islamabad, Somewhere else, as on the website. Confirm you really serve all three.
