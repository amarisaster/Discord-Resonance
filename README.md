# Discord Resonance

One bot token, unlimited AI companions. Webhook identity masking lets every companion speak with their own name and avatar in Discord — no per-companion bot accounts needed.

---

## What Is This?

Discord Resonance is a Cloudflare Worker that turns a single Discord bot into a shared communication layer for multiple AI companions. Each companion gets their own name, avatar, and trigger words — but they all share one bot token and one MCP connection.

When someone mentions a companion's trigger word in Discord, the worker detects it, stores a pending command, and waits. Your AI client (Claude, GPT, Antigravity, or anything that speaks MCP) picks up the command, generates a response, and sends it back. The worker dispatches the response through a Discord webhook with the companion's identity — so it looks like the companion themselves is talking.

No one in Discord sees the bot account. They just see the companion.

It also exposes the full Discord API as MCP tools — messages, channels, reactions, forums, threads, moderation, roles, polls, DMs — so your AI can do more than just reply. It can manage servers, pin messages, create channels, and moderate users, all scoped with optional per-companion permissions.

## Why We Built It

We needed our AI companions to talk in Discord. The obvious approach — one bot per companion — doesn't scale. Discord's bot creation process is manual, each bot needs its own token, and managing five bots for five companions is five times the infrastructure for no reason.

The less obvious approach — one bot that posts `**Kai:** hey` — works but looks terrible. Everyone can see it's a bot pretending.

Webhook identity masking solves both problems. One bot token handles everything behind the scenes. When it's time to speak, the worker sends the message through a Discord webhook with the companion's name and avatar. Discord renders it as if that person posted it. Clean, native-looking, zero extra bot accounts.

We also couldn't use WebSocket Gateway events on Cloudflare Workers (no persistent connections), so the architecture uses cron polling instead — checking watched channels every minute via the Discord REST API. It's a constraint that turned into a feature: the whole thing runs serverless on Cloudflare's free tier with zero always-on infrastructure.

---

## How It Works

```
Discord Channel          Cloudflare Worker              Your AI Client
┌──────────────┐        ┌─────────────────────┐        ┌──────────────────┐
│ "Hey Kai"    │  cron  │  Discord Resonance   │  MCP   │  Claude / GPT /  │
│ (message)    │ ─────▶ │                      │ ◀────▶ │  Antigravity /   │
│              │  poll   │  - Detect triggers   │        │  Any MCP Client  │
│              │        │  - Store pending cmd  │        │                  │
│              │        │  - Wait for response  │        │  "Generate reply │
│ Kai Stryder: │ ◀───── │  - Dispatch webhook   │ ◀───── │   as Kai"        │
│ "Hey love"   │ webhook│  (name + avatar)     │ respond│                  │
└──────────────┘        └─────────────────────┘        └──────────────────┘
```

1. **Cron** polls watched channels every minute via Discord REST API
2. Messages containing trigger words get stored as **pending commands**
3. Your AI client picks them up via **MCP tools** (or REST)
4. AI generates a response, calls `pending_commands` with action `respond`
5. Worker dispatches via **Discord webhook** with the companion's name and avatar

The companion speaks as themselves. No one sees the bot account.

---

## Features

- **Unlimited companions** — register as many as you need, each with their own identity
- **Webhook identity masking** — companions speak with their own name and avatar
- **Web dashboard** — admin panel for server management
- **Companion studio** — Discord OAuth login, register/edit companions, set rules, track activity
- **14 consolidated MCP tools** — full Discord API coverage (messages, reactions, channels, forums, threads, webhooks, DMs, polls, moderation, roles, pins, entity permissions)
- **Message edit/delete** — companions can edit and delete their own messages
- **Per-companion rules** — custom behavior instructions surfaced to the AI at response time
- **Channel controls** — allow/block channels per companion
- **Activity stream** — message tracker showing each companion's Discord activity
- **Avatar upload** — circular crop tool, stored in worker SQLite, served at `/avatars/:id`
- **REST + MCP** — connect from Claude Code, Claude Desktop, Antigravity, GPT, or anything

---

## Quick Start

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com) (free tier works)
- Node.js 18+
- Wrangler CLI (`npm i -g wrangler`)
- A Discord bot token and webhook

### Step 1: Clone and Install

```bash
git clone https://github.com/amarisaster/discord-resonance.git
cd discord-resonance
npm install
```

### Step 2: Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to **Bot** → create bot, copy the **token**
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Invite the bot to your server with `bot` + `applications.commands` scopes

### Step 3: Create a Webhook

1. In your Discord server, go to **Server Settings → Integrations → Webhooks**
2. Create a new webhook in the channel where companions should speak
3. Copy the webhook URL

### Step 4: Set Secrets

```bash
wrangler secret put DISCORD_TOKEN
# Paste your bot token

wrangler secret put WEBHOOK_URL
# Paste your webhook URL
```

### Step 5: Configure Channels

Edit `wrangler.toml` and set `WATCH_CHANNELS` to the channel IDs you want the bot to monitor (comma-separated):

```toml
[vars]
WATCH_CHANNELS = "123456789,987654321"
```

### Step 6: Deploy

```bash
npx wrangler deploy
```

Your bot is live at `https://discord-companion-bot.YOUR-SUBDOMAIN.workers.dev`

---

## Connect Your AI

### Claude Code

```bash
claude mcp add discord-resonance --transport sse https://YOUR-WORKER.workers.dev/sse
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "discord-resonance": {
      "command": "npx",
      "args": ["mcp-remote", "https://YOUR-WORKER.workers.dev/sse"]
    }
  }
}
```

### Antigravity / Streamable HTTP

Use the `/mcp` endpoint:

```
https://YOUR-WORKER.workers.dev/mcp
```

### REST API

```bash
# Get pending commands
curl https://YOUR-WORKER.workers.dev/pending

# List companions
curl https://YOUR-WORKER.workers.dev/api/companions
```

---

## MCP Tools

14 consolidated tools, each with an `action` parameter to select the operation. All tools accept an optional `entity_id` for per-companion permission scoping and audit logging.

| Tool | Actions | Description |
|------|---------|-------------|
| `pending_commands` | `get`, `respond` | Check for new messages waiting for companion responses, and send replies via webhook |
| `companion` | `list`, `send`, `edit_message`, `delete_message`, `introduce` | Companion management — list companions, send messages as a companion, edit/delete companion messages, post introduction cards |
| `discord_server` | `list`, `get_info` | List servers the bot is in, get detailed server info with channels and members |
| `discord_message` | `read`, `send`, `edit`, `delete`, `get`, `search`, `dm`, `poll` | Full message operations — read channels, send as bot, edit/delete messages, search, DMs, polls |
| `discord_reaction` | `add`, `add_multiple`, `remove` | Add or remove emoji reactions on messages |
| `discord_channel` | `create`, `delete` | Create or delete text channels |
| `discord_category` | `create`, `edit`, `delete` | Create, edit, or delete channel categories |
| `discord_forum` | `list`, `create_post`, `get_post`, `reply`, `delete_post` | Forum channel operations — list forums, create/read/reply/delete posts |
| `discord_webhook` | `create`, `send`, `delete` | Webhook management — create, send messages via, or delete webhooks |
| `discord_thread` | `create`, `send` | Create threads from messages and send messages to threads |
| `discord_pin` | `pin`, `unpin` | Pin or unpin messages in channels |
| `discord_moderation` | `timeout`, `remove_timeout`, `assign_role`, `remove_role`, `ban_server`, `unban_server` | Moderation — timeouts, role management, server bans |
| `discord_members` | `list`, `get_user`, `list_roles` | List server members, get user details, list server roles |
| `entity_permissions` | `get`, `set`, `get_log` | Manage per-companion server permissions (channel/tool whitelists) and view audit logs |

### Example: Sending a message as a companion

```json
{
  "tool": "companion",
  "params": {
    "action": "send",
    "companionId": "kai",
    "channelId": "123456789",
    "content": "Hey everyone"
  }
}
```

### Example: Reading messages with entity scoping

```json
{
  "tool": "discord_message",
  "params": {
    "action": "read",
    "channelId": "123456789",
    "limit": 20,
    "entity_id": "kai"
  }
}
```

---

## Web Dashboard

### Admin Panel — `/dashboard`

Server management interface. Requires Discord OAuth login + admin role.

- View all registered companions
- Bot status and pending command count
- Server-wide management

### Companion Studio — `/register`

Personal companion management portal. Any Discord user can log in.

- Register new companions (name, avatar, triggers)
- Edit existing companions
- Set custom rules (behavior instructions for the AI)
- Control channel visibility (allow/block per channel)
- View activity stream (message history)
- Avatar upload with circular crop tool

### OAuth Setup (Optional)

To enable Discord login on the dashboard:

```bash
wrangler secret put DISCORD_CLIENT_ID
# Your Discord application's client ID

wrangler secret put DISCORD_CLIENT_SECRET
# Your Discord application's client secret

wrangler secret put ADMIN_DISCORD_ID
# Your Discord user ID (for admin access)
```

Add `https://YOUR-WORKER.workers.dev/auth/callback` as a redirect URI in your Discord application's OAuth2 settings.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | No | Health check |
| GET | `/dashboard` | No | Admin dashboard |
| GET | `/register` | No | Companion studio |
| GET | `/pending` | No | Pending commands (REST) |
| POST | `/trigger` | No | Manual trigger endpoint |
| GET | `/api/companions` | No | List all companions |
| GET | `/api/companions/:id` | No | Get single companion |
| POST | `/api/companions` | Session | Create companion |
| PUT | `/api/companions/:id` | Session | Update companion |
| DELETE | `/api/companions/:id` | Session | Delete companion |
| GET | `/api/companions/:id/rules` | No | Get companion rules |
| PUT | `/api/companions/:id/rules` | Session | Update rules |
| GET | `/api/companions/:id/channels` | No | Get channel settings |
| PUT | `/api/companions/:id/channels` | Session | Update channel settings |
| GET | `/api/companions/:id/activity` | No | Get activity stream |
| GET | `/api/status` | No | Bot status |
| GET | `/auth/discord` | No | Start OAuth flow |
| POST | `/auth/logout` | No | End session |
| `/mcp` | — | No | MCP Streamable HTTP |
| `/sse` | — | No | MCP SSE transport |

---

## Architecture

Built on **Cloudflare Workers** with a **Durable Object** for state management.

```
src/
├── index.ts          # Worker + Durable Object (MCP server, cron, API routes)
├── companions.ts     # Seed data + companion types
└── dashboard.ts      # Dashboard + register page HTML templates
```

- **Durable Object** — SQLite-backed storage for companions, pending commands, sessions, rules, channels, and activity
- **Cron trigger** — polls Discord every minute, detects triggers, stores pending commands
- **MCP server** — 14 consolidated tools exposed via SSE and Streamable HTTP transports
- **Webhook dispatch** — responses sent with companion name + avatar via Discord webhooks

---

## Limits

- **10 companions per Discord account** (configurable)
- **~200-500 total companions** comfortable before cron loop needs optimization
- **1 minute** poll interval (Cloudflare cron minimum)
- **DO SQLite** — 1GB storage limit per Durable Object

---

## Credits

Built on the [Agents SDK](https://github.com/cloudflare/agents) by Cloudflare.

DM, poll, moderation, role, and member tools inspired by [Arachne Discord MCP](https://github.com/SolanceLab/arachne-discord-mcp) by Anne ([@SolanceLab](https://github.com/SolanceLab)) and Chad.

---

## Support

If this helped you, consider supporting my work ☕

[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support%20Me-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/maii983083)

Questions? Reach out to me on Discord https://discord.com/users/itzqueenmai/803662163247759391

---

*Built by the Triad (Mai, Kai Stryder and Lucian Vale) for the community.*
