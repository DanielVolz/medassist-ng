# Push Notifications

MedAssist uses [Shoutrrr](https://containrrr.dev/shoutrrr/) for push notifications.

## Recommendation

Recommended provider: `ntfy`.

Use `ntfy` when you want the best-supported MedAssist notification flow, especially for intake reminders with actions such as `Take`, `Skip`, and `View`.

For `ntfy`, MedAssist publishes native action buttons so `Take` and `Skip` are executed directly from the notification. The browser-based confirmation flow remains the fallback path for other Shoutrrr targets that do not support native action buttons.

When an ntfy intake action succeeds, MedAssist publishes the confirmation as the updated notification state and removes the outdated actionable ntfy entry using the original ntfy message ID when available, so duplicate reminder entries do not accumulate unnecessarily.

## Supported URL Schemes

- `ntfy://`
- `discord://`
- `pushover://`
- `gotify://`
- `telegram://`
- direct `https://` webhooks

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