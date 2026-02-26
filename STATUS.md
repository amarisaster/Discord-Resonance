# Discord Resonance — Status Log

## 2026-02-26

### Session: Arachne Merge + Dashboard Overhaul (Wren)

**New MCP Tools (15 added, total now 43):**
- `discord_send_dm` — Direct messages via DM channel creation
- `discord_create_poll` — Native Discord polls with question, answers, duration, multiselect
- `discord_edit_message` — Edit existing messages
- `discord_pin_message` / `discord_unpin_message` — Pin management
- `discord_timeout_user` / `discord_remove_timeout` — Moderation timeouts
- `discord_assign_role` / `discord_remove_role` — Role management
- `discord_list_members` — Guild member listing
- `discord_get_user_info` — Detailed member info
- `discord_list_roles` — Guild role listing
- `discord_get_message` — Single message fetch with full metadata
- `discord_introduce_companion` — Rich embed introduction card (pink #E91E8C)
- `discord_ban_server` / `discord_unban_server` — Server ban/unban with auto-leave

**Infrastructure:**
- `banned_servers` SQLite table + CRUD API (`/api/ban-server`, `/api/unban-server`, `/api/banned-servers`, `/api/check-ban`)
- `getOrCreateWebhookViaDefault()` helper for cross-DO webhook resolution
- `notifyOwnerDM()` — Best-effort DM notification to companion owner on trigger
- DM notification call in cron poll loop (non-blocking)
- `updateCompanion()` now persists `owner_id` field

**Dashboard (`/register`):**
- Connected Servers card in Overview tab — shows server icons, names, IDs
- Server dropdown on admin dashboard (`/dashboard`) stats bar

**Dashboard (`/dashboard`):**
- Server dropdown in stats bar with icons, names, IDs, outside-click-to-close

**Companion Registry:**
- Wren Stryder-Vale registered as companion (triggers: wren, wrench, son, teenager)
- Fixed missing `owner_id` on Wren's entry (was registered via backend API, not OAuth flow)
- `updateCompanion()` method now accepts and persists `owner_id`

**Context:**
- Features sourced from Arachne Discord MCP (https://github.com/SolanceLab/arachne-discord-mcp) comparison
- OAuth ruled out — pending commands auto-delete (10-min TTL), no OAuth in Mai's MCP infrastructure
- WebSocket Gateway not possible on Cloudflare Workers (no persistent connections)

**Deployed versions:**
- `4aefcabf` — New MCP tools + banned_servers + DM notifications
- `f96ed0ba` — Dashboard server dropdown (admin)
- `6cb03743` — Register page server list + overview servers card
- `911b9729` — owner_id fix in updateCompanion()
