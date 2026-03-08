# Discord Commit Bot

This repo includes a local Git hook that posts every new commit to a Discord channel.

## 1) Create a Discord webhook

In Discord:
1. Open your server channel settings.
2. Go to **Integrations** -> **Webhooks**.
3. Create a webhook and copy the webhook URL.

## 2) Install the hook

From repo root:

```bash
./scripts/install-discord-commit-hook.sh "https://discord.com/api/webhooks/..."
```

You can also set the webhook later:

```bash
git config discord.webhookUrl "https://discord.com/api/webhooks/..."
```

Optional: force a specific GitHub username for posts:

```bash
git config github.username "your-github-username"
```

## 3) Commit normally

Every `git commit` triggers `.git/hooks/post-commit`, which runs:

```bash
node scripts/discord-commit-notifier.js
```

The bot posts:
- repository + branch
- commit hash + message
- GitHub username (not Git real name/email)
- changed files

## Override options

- One-off webhook override:

```bash
DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." git commit -m "..."
```

- Local config key used by default:

```bash
git config --get discord.webhookUrl
```

- Optional GitHub username config:

```bash
git config --get github.username
```

## Separate Link Webhook

Use a second webhook for first-run link pings (`Palladium Links`) from `apps.js`:

```bash
git config discord.linksWebhookUrl "https://discord.com/api/webhooks/..."
```

`discord.webhookUrl` remains the commit webhook used by `scripts/discord-commit-notifier.js`.

## Link Checker Webhook Bot

Use a dedicated webhook for blocker checks (separate from commit posts and first-run links):

```bash
git config discord.linkCheckerWebhookUrl "https://discord.com/api/webhooks/..."
```

Run a check and post result to Discord:

```bash
node scripts/link-check-discord.js "https://example.com"
```

Or call the backend endpoint directly:

```bash
curl "http://localhost:1338/link-check-discord?url=https://example.com"
```

## Real Bot Mode (No Webhook Required)

You can run these as real Discord bots via Bot token + channel IDs.

### Required local config keys

```bash
git config discord.botToken "YOUR_BOT_TOKEN"
```

Commit bot target channel:

```bash
git config discord.commitChannelId "1480022214303682700"
```

Link checker target channel:

```bash
git config discord.linkCheckerChannelId "1480327216826155059"
```

Link command listener channels (`/link <url>`):

```bash
git config discord.linkCommandChannelIds "1480327216826155059"
```

Community bot channels:

```bash
git config discord.welcomeChannelId "1480334877961355304"
git config discord.rulesChannelId "1480324913561862184"
```

### Bot scripts

- Commit posts: `scripts/discord-commit-notifier.js` (auto-runs via post-commit hook)
- `/link` command listener: `scripts/discord-link-command-bot.js`
- Welcome + rules community bot: `scripts/discord-community-bot.js`

`./start.sh` now auto-starts the link command bot and community bot when required config is present.

### Application IDs (stored for reference)

```bash
git config discord.commitApplicationId "1480333781066973224"
git config discord.linkCheckerApplicationId "1480334007118987456"
git config discord.communityApplicationId "1480333349297066075"
```
