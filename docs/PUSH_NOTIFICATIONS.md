# Push Notifications

MedAssist uses [Shoutrrr](https://containrrr.dev/shoutrrr/) for push notifications.

## Recommendation

Recommended provider: `ntfy`.

Use `ntfy` when you want the best-supported MedAssist notification flow, especially for intake reminders with actions such as `Take`, `Skip`, and `View`.

For `ntfy`, MedAssist publishes native action buttons so `Take` and `Skip` are executed directly from the notification. Each intake reminder is sent separately per dose, even when several medications have the same schedule time or reminders become due in the same scheduler run. ntfy messages remain separate even when action links cannot be created.

Discord and direct HTTP/HTTPS webhook messages use per-dose reminders with a `Respond` link when an action context is available. Opening this link displays the existing confirmation page; taking or skipping the dose requires an explicit confirmation click. Opening a link never marks a dose taken. Pushover, Telegram, Gotify, and `generic://` webhooks do not currently render these dose actions and retain grouped reminders.

Intake reminder emails are sent as one combined message for all selected doses. Each medication entry has its own translated `Respond` link in HTML and plain text when an action context is available; a missing context leaves only that entry without a link and does not split the email. Native ntfy actions and message/email links require a reachable `PUBLIC_APP_URL`.

This batching applies to advance, catch-up/missed, and repeat intake reminders. The email subject and summary cover all selected medications, with repeat text reflecting the selected nagging reminders. Actionable push messages remain separate per dose and use that dose's own reminder count and repeat information. Reminder state advances only for doses covered by a successful delivery on at least one channel; a successful combined email covers every dose in it. A failed per-dose push delivery does not prevent attempts for the remaining doses.

Intake reminder counters are stored by dose and schedule time, so doses sharing a medication name or intake time remain independent. Existing name/time reminder entries are still read as a compatibility fallback. Older application versions do not understand the new keys and may resend reminders after a downgrade.

When an ntfy intake action succeeds, MedAssist publishes the confirmation as the updated notification state and removes the outdated actionable ntfy entry using the original ntfy message ID when available, so duplicate reminder entries do not accumulate unnecessarily.

## Supported URL Schemes

- `ntfy://`
- `discord://`
- `pushover://`
- `gotify://`
- `generic://` JSON/HTTP POST webhooks
- `telegram://`
- direct `https://` webhooks

Outbound webhook targets are validated before delivery. Localhost, private-network IP ranges, link-local IPv6 addresses, and internal hostnames are rejected to keep notification delivery from becoming a server-side request path into the local network.

Self-hosted ntfy services may use public or local targets without additional server configuration. ntfy targets may use HTTP or HTTPS, direct IPs, localhost, internal hostnames, loopback, link-local, metadata, and private IPv6 addresses. This explicit local-target exception also applies to ntfy action updates and deletes. Other notification providers remain protected from local-network targets, and ntfy redirects remain blocked.

## Configuration

Configure push notifications in the app under `Settings -> Push`, or set defaults for new users with environment variables.

Notification action links such as `Take`, `Skip`, and `View` use `PUBLIC_APP_URL` as their base URL. Set this to the public MedAssist URL that the receiving device can actually reach.

Good examples:

```text
https://med.example.com
https://medtest.example.com
```

Bad examples for notification actions:

```text
http://localhost:3000
http://backend-dev:3000
http://192.168.x.x:3000
```

Push-related default variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_SHOUTRRR_ENABLED` | `false` | Enable push notifications by default |
| `DEFAULT_SHOUTRRR_URL` | — | Default Shoutrrr URL |
| `DEFAULT_SHOUTRRR_STOCK_REMINDERS` | `true` | Send stock reminders via push |
| `DEFAULT_SHOUTRRR_INTAKE_REMINDERS` | `true` | Send intake reminders via push |
| `DEFAULT_SHOUTRRR_PRESCRIPTION_REMINDERS` | `true` | Send prescription reminders via push |

For the full default-user-settings reference, see [DEFAULT_USER_SETTINGS.md](DEFAULT_USER_SETTINGS.md).

## URL Examples

### ntfy

```text
ntfy://ntfy.sh/your-topic
ntfy://user:password@your-server.com/topic
https://ntfy.local.danielvolz.org/medis
```

### Pushover

```text
pushover://shoutrrr:API_TOKEN@USER_KEY/
```

### Gotify

```text
gotify://your-server.com/TOKEN
gotify://your-server.com:443/path/to/gotify/TOKEN?priority=1
```

### Generic HTTP webhook

```text
generic://your-server.com/message?token=TOKEN&@content-type=application/json&template=json
```

MedAssist sends Generic notifications as `POST` requests over HTTPS by default; `disabletls=true` selects HTTP. `template=json` sends a JSON object with `title` and `message`; ordinary query parameters such as `token` are forwarded to the target endpoint. Use `__` to forward a query name that is otherwise a Generic option, for example `__template=custom` forwards `template=custom` while `template=json` still selects the JSON payload template.

The `contenttype` option sets both `Content-Type` and `Accept` and defaults to `application/json`. Explicit `@` headers override these values case-insensitively. Generic URLs containing a username or password are rejected; use explicit webhook headers or query parameters supported by the target instead.

### Discord

```text
discord://TOKEN@WEBHOOK_ID
```

### Telegram

```text
telegram://TOKEN@telegram?chats=CHAT_ID
telegram://TOKEN@telegram?chats=@your_channel,-1001234567890
```

For all supported services and options, see the [Shoutrrr documentation](https://containrrr.dev/shoutrrr/v0.8/services/overview/).

## Troubleshooting

### ntfy `Take` / `Skip` fails with a connection timeout

If the ntfy client shows an error such as `failed to connect to ... port 443`, the failure usually happens before MedAssist can process the action token.

Check these points first:

1. `PUBLIC_APP_URL` points to your real public MedAssist URL, not to `localhost`, a Docker service name, or another internal-only address.
2. The same URL opens from the same phone and network outside the notification flow.
3. If the failure only happens on your home Wi-Fi, retry once on mobile data. That strongly helps distinguish an app issue from missing NAT loopback / hairpin routing on the local network.

### ntfy shows an old actionable entry after a successful action

MedAssist updates the notification state after a successful ntfy action and removes the stale actionable entry using the original ntfy message ID when available.

If an outdated actionable entry still remains visible, verify that the action actually reached MedAssist and that your ntfy server accepted both the confirmation publish and the follow-up delete of the original message.
