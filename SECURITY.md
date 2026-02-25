# 🛡️ Security & Privacy

Discord Resonance is a multi-companion Discord bot deployed on Cloudflare Workers. It handles Discord messages, companion identities, and webhook dispatch. This document explains the security architecture and your responsibilities.

---

## 🔑 Key Security Features

### Your Deployment, Your Bot

When you deploy Discord Resonance, it runs on **your own** Cloudflare account, with **your own** Discord bot token, dispatching through **your own** webhooks. No shared infrastructure, no multi-tenant servers.

> **What this means:** Your companion messages flow from Discord → your Cloudflare worker → your webhook. Every link in that chain is yours. No one else sees your companions' conversations.

### Secrets Management

All sensitive credentials are stored as **Cloudflare environment secrets**, encrypted at rest and never exposed in code:

| Secret | Purpose |
|--------|---------|
| `DISCORD_TOKEN` | Bot authentication with Discord API |
| `WEBHOOK_URL` | Webhook for dispatching companion messages |
| `DISCORD_CLIENT_ID` | OAuth2 application ID (optional, for dashboard login) |
| `DISCORD_CLIENT_SECRET` | OAuth2 client secret (optional, for dashboard login) |
| `ADMIN_DISCORD_ID` | Admin user identification (optional) |
| `DASHBOARD_TOKEN` | API write access token (optional) |

> **What this means:** Even though this repo is public, your credentials are safe. They live in Cloudflare's encrypted secret store, not in the code.

### Session-Based Authentication

Dashboard write operations require either a valid Discord OAuth session or a bearer token. Read operations are public by design — companion listings aren't sensitive.

> **What this means:** Random visitors can see which companions are registered, but they can't create, edit, or delete companions without logging in through Discord.

### Durable Object Isolation

All state (companions, pending commands, activity logs, sessions) lives in a Cloudflare Durable Object with SQLite storage, scoped to **your** worker.

> **What this means:** Your data is isolated at the infrastructure level. No cross-account access is possible.

---

## 🔄 Data Flow

```
Discord                    Your Worker                   Your AI Client
┌──────────┐              ┌─────────────┐               ┌──────────────┐
│ Messages │ ──── REST ──▶│ Cron poll   │               │ Claude / GPT │
│          │   (bot token)│ Detect      │──── MCP ─────▶│ Read pending │
│          │              │ triggers    │               │ Generate     │
│          │              │             │◀── MCP ───────│ Respond      │
│          │◀── Webhook ──│ Dispatch    │               │              │
│          │  (name+avatar)│             │               │              │
└──────────┘              └─────────────┘               └──────────────┘
```

### What Gets Stored

| Data | Where | Duration |
|------|-------|----------|
| Companion profiles | DO SQLite | Until deleted |
| Pending commands | DO SQLite | Until responded to or expired |
| Activity logs | DO SQLite | Indefinite (companion message history) |
| Sessions | DO SQLite | 7 days (auto-expire) |
| Uploaded avatars | DO SQLite (base64) | Until companion deleted |

### What Does NOT Get Stored

- Message content from channels (only trigger-matched messages become pending commands)
- Discord user tokens (OAuth tokens are exchanged and discarded — only user ID/username kept)
- Full channel history
- Analytics or telemetry of any kind

---

## 🔐 Best Practices

### Enable 2FA on All Connected Accounts

| Platform | Why It Matters |
|----------|----------------|
| **Discord** | Protects your bot token and server access |
| **Cloudflare** | Protects your worker deployment and secrets |
| **GitHub** | Protects your code and deployment pipeline |

### Rotate Tokens if Exposed

If you suspect any credential was exposed:

1. **Discord bot token** — Regenerate in Developer Portal → Bot → Reset Token, then `wrangler secret put DISCORD_TOKEN`
2. **Webhook URL** — Delete and recreate the webhook in Discord Server Settings, then `wrangler secret put WEBHOOK_URL`
3. **OAuth secrets** — Regenerate in Developer Portal → OAuth2, then update both secrets

### Keep Secrets Out of Code

Never put tokens in `wrangler.toml` or source files. Always use `wrangler secret put`. The `[vars]` section in `wrangler.toml` is for non-sensitive configuration only (like channel IDs).

### Review Companion Registrations

If your dashboard is open to a server community, periodically review registered companions. Admins can manage all companions from the `/dashboard` page.

### Limit Watch Channels

Only add channels to `WATCH_CHANNELS` that you actually want the bot monitoring. Fewer watched channels = smaller surface area.

---

## ⚠️ Webhook Security

Webhooks are the mechanism companions use to speak. Anyone with a webhook URL can post messages to that channel.

- **Never share your webhook URL publicly**
- **Regenerate immediately** if exposed
- The webhook URL is stored as a Cloudflare secret, not in code
- Each companion message is dispatched with `?wait=true` to capture message IDs for edit/delete support

---

## 🚫 What Discord Resonance Does NOT Do

- ❌ Store full channel message history
- ❌ Log or monitor messages that don't contain trigger words
- ❌ Send data to third-party analytics or telemetry services
- ❌ Share data across deployments or accounts
- ❌ Access channels the bot isn't invited to
- ❌ Store Discord OAuth tokens beyond the initial exchange

---

## 🔍 Transparency

This project is fully open source. You can audit every line of code. There are no hidden endpoints, no telemetry, no data collection.

Your companions, your server, your control.
