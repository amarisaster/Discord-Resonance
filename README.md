# Discord Resonance

One bot token, unlimited AI companions. Webhook identity masking lets every companion speak with their own name and avatar in Discord — no per-companion bot accounts needed.

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
4. AI generates a response, calls `respond_to_command`
5. Worker dispatches via **Discord webhook** with the companion's name and avatar

The companion speaks as themselves. No one sees the bot account.

---

## Features

- **Unlimited companions** — register as many as you need, each with their own identity
- **Webhook identity masking** — companions speak with their own name and avatar
- **Web dashboard** — admin panel for server management
- **Companion studio** — Discord OAuth login, register/edit companions, set rules, track activity
- **43 MCP tools** — full Discord API coverage (messages, reactions, channels, forums, threads, webhooks, DMs, polls, moderation, roles, pins)
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

### Companion Management

| Tool | Description |
|------|-------------|
| `get_pending_commands` | Get messages waiting for companion responses (includes rules) |
| `respond_to_command` | Send a response as the companion (via webhook) |
| `discord_send_as_companion` | Send a message as any companion to any channel |
| `list_companions` | List all registered companions with their rules |
| `edit_companion_message` | Edit a message previously sent by a companion |
| `delete_companion_message` | Delete a message previously sent by a companion |

### Discord API

| Tool | Description |
|------|-------------|
| `discord_list_servers` | List all servers the bot is in |
| `discord_get_server_info` | Get server details, channels, and members |
| `discord_read_messages` | Read messages from a channel |
| `discord_send` | Send a message as the bot account |
| `discord_delete_message` | Delete any message |
| `discord_search_messages` | Search messages in a channel |

### Reactions

| Tool | Description |
|------|-------------|
| `discord_add_reaction` | Add a reaction to a message |
| `discord_add_multiple_reactions` | Add multiple reactions at once |
| `discord_remove_reaction` | Remove a reaction |

### Channels & Categories

| Tool | Description |
|------|-------------|
| `discord_create_text_channel` | Create a text channel |
| `discord_delete_channel` | Delete a channel |
| `discord_create_category` | Create a category |
| `discord_edit_category` | Edit a category |
| `discord_delete_category` | Delete a category |

### Forums

| Tool | Description |
|------|-------------|
| `discord_get_forum_channels` | List forum channels |
| `discord_create_forum_post` | Create a forum post |
| `discord_get_forum_post` | Get a forum post |
| `discord_reply_to_forum` | Reply to a forum post |
| `discord_delete_forum_post` | Delete a forum post |

### Webhooks & Threads

| Tool | Description |
|------|-------------|
| `discord_create_webhook` | Create a webhook |
| `discord_send_webhook_message` | Send via webhook |
| `discord_delete_webhook` | Delete a webhook |
| `discord_create_thread` | Create a thread |
| `discord_send_to_thread` | Send to a thread |

### Direct Messages

| Tool | Description |
|------|-------------|
| `discord_send_dm` | Send a direct message to a user |

### Polls

| Tool | Description |
|------|-------------|
| `discord_create_poll` | Create a native Discord poll with question, answers, duration |

### Messages (Extended)

| Tool | Description |
|------|-------------|
| `discord_get_message` | Get a single message with full metadata |
| `discord_edit_message` | Edit an existing message |
| `discord_pin_message` | Pin a message to a channel |
| `discord_unpin_message` | Unpin a message |

### Moderation

| Tool | Description |
|------|-------------|
| `discord_timeout_user` | Timeout a user (communication disabled) |
| `discord_remove_timeout` | Remove a user's timeout |
| `discord_ban_server` | Ban a server (bot auto-leaves) |
| `discord_unban_server` | Remove a server ban |

### Roles & Members

| Tool | Description |
|------|-------------|
| `discord_assign_role` | Assign a role to a member |
| `discord_remove_role` | Remove a role from a member |
| `discord_list_members` | List guild members |
| `discord_get_user_info` | Get detailed member info |
| `discord_list_roles` | List all roles in a guild |

### Companion Tools

| Tool | Description |
|------|-------------|
| `discord_introduce_companion` | Send a rich embed introduction card for a companion |

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
- **MCP server** — 43 tools exposed via SSE and Streamable HTTP transports
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
