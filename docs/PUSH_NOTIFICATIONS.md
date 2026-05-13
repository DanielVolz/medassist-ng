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