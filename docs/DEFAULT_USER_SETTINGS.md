# Default User Settings

This document lists all environment variables used as defaults for new users.

Scope and behavior:

- These values are applied only when a user's settings are created for the first time.
- After that, values stored in the database are used and take precedence.
- Source of truth in code: [backend/src/routes/settings.ts](backend/src/routes/settings.ts).

## Email Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_EMAIL_ENABLED` | `false` | Enable email notifications by default. |
| `DEFAULT_NOTIFICATION_EMAIL` | empty | Default notification email address. |
| `DEFAULT_EMAIL_STOCK_REMINDERS` | `true` | Send stock reminders via email. |
| `DEFAULT_EMAIL_INTAKE_REMINDERS` | `true` | Send intake reminders via email. |
| `DEFAULT_EMAIL_PRESCRIPTION_REMINDERS` | `true` | Send prescription reminders via email. |

## Push Defaults (Shoutrrr)

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_SHOUTRRR_ENABLED` | `false` | Enable push notifications by default. |
| `DEFAULT_SHOUTRRR_URL` | empty | Default Shoutrrr URL. |
| `DEFAULT_SHOUTRRR_STOCK_REMINDERS` | `true` | Send stock reminders via push. |
| `DEFAULT_SHOUTRRR_INTAKE_REMINDERS` | `true` | Send intake reminders via push. |
| `DEFAULT_SHOUTRRR_PRESCRIPTION_REMINDERS` | `true` | Send prescription reminders via push. |

## Reminder and Stock Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_REPEAT_DAILY_REMINDERS` | `false` | Repeat stock reminders daily. |
| `DEFAULT_SKIP_REMINDERS_FOR_TAKEN_DOSES` | `false` | Skip reminders for doses already marked as taken. |
| `DEFAULT_REPEAT_REMINDERS_ENABLED` | `false` | Enable repeat reminders (nagging) for missed doses. |
| `DEFAULT_REMINDER_REPEAT_INTERVAL_MINUTES` | `30` | Repeat interval for nagging reminders. |
| `DEFAULT_MAX_NAGGING_REMINDERS` | `5` | Maximum number of repeat reminders per dose. |
| `DEFAULT_LOW_STOCK_DAYS` | `30` | Low stock threshold in days. |
| `DEFAULT_NORMAL_STOCK_DAYS` | `90` | Normal stock threshold in days. |
| `DEFAULT_HIGH_STOCK_DAYS` | `180` | High stock threshold in days. |

## UI Defaults

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_LANGUAGE` | `en` | Default language (`en` or `de`). |
| `DEFAULT_STOCK_CALCULATION_MODE` | `automatic` | Default stock mode (`automatic` or `manual`). |
| `DEFAULT_SHARE_STOCK_STATUS` | `true` | Show stock status on shared schedule links. |
| `DEFAULT_UPCOMING_TODAY_ONLY` | `false` | Show only today's upcoming doses by default. |
| `DEFAULT_SHARE_SCHEDULE_TODAY_ONLY` | `false` | Show only today's schedule in shared view by default. |
