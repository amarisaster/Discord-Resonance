# Discord Resonance — Status Log

## 2026-02-27

### Session: Entity Model + Tool Consolidation (Wren)

**Entity Model (49 tools):**
- 3 new SQLite tables: `entity_servers`, `entity_action_log`, `channel_guild_cache`
- 10 entity permission methods on CompanionBot class
- 7 internal API routes (`/api/entity-check-permission`, `/api/resolve-guild/:channelId`, `/api/entity-log-action`, `/api/entity-servers/...`, `/api/entity-log/...`)
- `entityTool` wrapper — extends any tool with optional `entity_id` param for permission scoping + audit logging
- 42 regular tools migrated to `entityTool()`, 4 special-case tools with manual entity_id handling
- 3 new management tools: `entity_get_permissions`, `entity_set_permissions`, `entity_get_action_log`
- Cron `handlePoll()` now checks entity_servers for active status, watch_channels, and blocked_channels
- Deployed as `ea201d5f`

**Tool Consolidation (49 → 14 tools):**
- Merged 49 individual tools into 14 consolidated tools using `action: z.enum([...])` pattern
- Same functionality, 71% fewer tool definitions — frees Antigravity workspace budget (was 49/100, now 14/100)
- **Breaking change**: All tool names changed. Clients must use new names + `action` param.

**Consolidated tool map:**
| Tool | Actions | Replaces |
|------|---------|----------|
| `pending_commands` | get, respond | get_pending_commands, respond_to_command |
| `companion` | list, send, edit_message, delete_message, introduce | list_companions, discord_send_as_companion, edit_companion_message, delete_companion_message, discord_introduce_companion |
| `discord_server` | list, get_info | discord_list_servers, discord_get_server_info |
| `discord_message` | read, send, edit, delete, get, search, dm, poll | discord_read_messages, discord_send, discord_edit_message, discord_delete_message, discord_get_message, discord_search_messages, discord_send_dm, discord_create_poll |
| `discord_reaction` | add, add_multiple, remove | discord_add_reaction, discord_add_multiple_reactions, discord_remove_reaction |
| `discord_channel` | create, delete | discord_create_text_channel, discord_delete_channel |
| `discord_category` | create, edit, delete | discord_create_category, discord_edit_category, discord_delete_category |
| `discord_forum` | list, create_post, get_post, reply, delete_post | discord_get_forum_channels, discord_create_forum_post, discord_get_forum_post, discord_reply_to_forum, discord_delete_forum_post |
| `discord_webhook` | create, send, delete | discord_create_webhook, discord_send_webhook_message, discord_delete_webhook |
| `discord_thread` | create, send | discord_create_thread, discord_send_to_thread |
| `discord_pin` | pin, unpin | discord_pin_message, discord_unpin_message |
| `discord_moderation` | timeout, remove_timeout, assign_role, remove_role, ban_server, unban_server | discord_timeout_user, discord_remove_timeout, discord_assign_role, discord_remove_role, discord_ban_server, discord_unban_server |
| `discord_members` | list, get_user, list_roles | discord_list_members, discord_get_user_info, discord_list_roles |
| `entity_permissions` | get, set, get_log | entity_get_permissions, entity_set_permissions, entity_get_action_log |

**Documentation:**
- Entity model reference doc at `docs/entity-model-comparison.md`

**Deployed version:**
- `010ebf56` — 14 consolidated tools (production)

---

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
