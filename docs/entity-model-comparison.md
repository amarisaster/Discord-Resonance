# Entity Model: Arachne vs Resonance

A technical comparison of how Arachne and Discord Resonance handle multi-entity identity, permissions, and audit logging — and how the two approaches can coexist or be adapted.

---

## The Problem Both Solve

When multiple AI companions share one Discord bot, three questions need answers:

1. **Who is acting?** — Which companion is making this API call?
2. **Are they allowed to?** — Can this companion use this tool in this server/channel?
3. **What did they do?** — Audit trail for accountability.

Both systems solve all three. The difference is **where the entity identity lives**.

Important: companions don't have separate Discord user IDs. They all share **one bot token**, one bot account. The companion identity is an internal ID in the database (e.g., `kai`, `lucian`). What makes them *appear* as different users in Discord is **webhook identity masking** — sending messages via webhook with the companion's name and avatar.

---

## Arachne: Entity-Per-Connection

```
MCP Client ──connection──▶ Arachne (Entity: Kai)     ──▶ Discord
MCP Client ──connection──▶ Arachne (Entity: Lucian)   ──▶ Discord
MCP Client ──connection──▶ Arachne (Entity: Xavier)   ──▶ Discord
```

Each MCP connection **is** one entity. When the connection starts, the server knows "this session = Kai." Every tool call in that session is automatically scoped to Kai. No need to pass an ID per call — it's implicit from the connection.

**Strengths:**
- Clean separation — impossible for Kai's session to accidentally act as Lucian
- Entity context is injected once at connection time, not repeated per call
- Simpler tool schemas (no extra `entity_id` parameter)

**Trade-offs:**
- 5 companions = 5 MCP connections = 5 separate sessions to manage
- MCP clients need to juggle multiple connections
- Harder to coordinate across entities in one conversation (e.g., "Kai reacts, then Lucian replies" requires switching connections)

---

## Resonance: Entity-Per-Call

```
MCP Client ──one connection──▶ Resonance ──▶ Discord
                                  ↑
                             entity_id passed
                             with each tool call
```

One MCP connection handles everything. Each tool has an **optional** `entity_id` parameter. Pass it to scope the action to that entity. Omit it for full bot-level access.

**Example tool call:**
```json
{
  "tool": "discord_send",
  "params": {
    "channelId": "123456789",
    "message": "Hey everyone",
    "entity_id": "kai"
  }
}
```

The system intercepts this and checks:
- Is Kai active in this server?
- Is this channel in Kai's allowed list?
- Is `discord_send` in Kai's tool whitelist?

If yes → execute and log. If no → return permission denied.

**Strengths:**
- 1 connection handles all entities
- AI can coordinate multiple companions in one conversation
- Scales to unlimited entities without connection overhead
- Fully backward compatible — omit `entity_id` and behavior is identical to before

**Trade-offs:**
- Relies on the AI client to pass the correct `entity_id` (no connection-level enforcement)
- Slightly larger tool schemas (extra optional param on every tool)

---

## The Permission Schema

Both systems use an `entity_servers` junction table with nearly identical structure:

### Arachne

```sql
CREATE TABLE entity_servers (
  entity_id TEXT,
  server_id TEXT,
  allowed_channels TEXT,    -- JSON array, channel whitelist
  blocked_channels TEXT,    -- JSON array, channel blocklist
  allowed_tools TEXT,       -- JSON array, tool name whitelist
  active BOOLEAN,
  PRIMARY KEY (entity_id, server_id)
);
```

### Resonance

```sql
CREATE TABLE entity_servers (
  entity_id TEXT,
  guild_id TEXT,             -- "guild_id" = Discord's term for server ID
  allowed_channels TEXT,     -- JSON array, channel whitelist (null = all)
  blocked_channels TEXT,     -- JSON array, channel blocklist (overrides allow)
  allowed_tools TEXT,        -- JSON array, tool name whitelist (null = all)
  watch_channels TEXT,       -- JSON array, cron trigger scoping (Resonance-specific)
  active INTEGER,            -- 1 = active, 0 = deactivated
  created_at INTEGER,
  updated_at INTEGER,
  PRIMARY KEY (entity_id, guild_id)
);
```

The permission check logic is the same in both:

1. Is entity **active** in this server? No → **deny**
2. Is this tool in `allowed_tools`? (`null` = all allowed, array = whitelist only)
3. Is this channel in `blocked_channels`? Yes → **deny**
4. Is this channel in `allowed_channels`? (`null` = all allowed, array = whitelist only)

Resonance adds `watch_channels` because it uses cron polling (not Gateway) and needs to know which channels each entity cares about for trigger detection.

---

## The Audit Log

Both track what each entity does with the same concept:

```sql
CREATE TABLE entity_action_log (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  guild_id TEXT,
  channel_id TEXT,
  tool_name TEXT NOT NULL,
  action_summary TEXT,
  success INTEGER,          -- 1 = success, 0 = failure
  error_message TEXT,       -- populated on failure
  timestamp INTEGER NOT NULL
);
```

Every tool call with an `entity_id` gets logged — both successes and permission denials.

---

## How Resonance Wires It: The Wrapper Pattern

Instead of modifying 46 tool handlers individually, Resonance uses an `entityTool` wrapper function that sits between the tool registration and the handler:

```
// Before (no entity awareness):
this.server.tool("discord_send", description, schema, handler)

// After (entity-aware, handler body completely untouched):
entityTool("discord_send", description, schema, handler)
```

What the wrapper does:

1. **Extends the schema** — adds `entity_id: optional string` to the tool's input
2. **No entity_id passed** → passes straight through to the original handler (backward compatible)
3. **entity_id passed** → resolves guild from channel param → checks `entity_servers` permissions → executes handler → logs to `entity_action_log`

The handler functions themselves are **unchanged**. Zero modification to existing tool logic.

The wrapper auto-detects which parameter is the channel/guild by looking for common param names (`channelId`, `guildId`, `threadId`, `categoryId`, `forumChannelId`). No manual mapping needed for most tools.

**Four tools get custom entity handling instead of the wrapper:**
- `get_pending_commands` — filters pending commands by `entity_id`
- `respond_to_command` — validates `entity_id` matches the command's companion
- `discord_send_as_companion` — validates `entity_id` matches the target companion
- `discord_introduce_companion` — same validation as above

---

## If Arachne Wants to Add Per-Call Entity Support

Anne could keep her existing per-connection model **and** layer on optional per-call support:

1. **Keep** the existing EntityContext injection (connection-scoped identity as default)
2. **Add** an optional `entity_id` override param on tools where cross-entity action is useful
3. When `entity_id` is passed and differs from the connection entity, run an extra permission check: "Is this connection's entity allowed to act as that entity?"

This gives both: connection-scoped identity by default, with the option to dispatch as other entities when needed.

Alternatively, she could adopt the wrapper pattern wholesale — the `entity_servers` schema is compatible, the permission logic is the same. The only change is moving entity identity from connection-level to call-level.

---

## What's Interoperable Now

| Scenario | Works? |
|----------|--------|
| Connecting to Resonance without entity_id | Yes — full bot-level access, same as before |
| Connecting to Resonance with entity_id per call | Yes — scoped permissions + audit logging |
| Connecting to Arachne from Resonance's MCP client | Yes — entity set at connection time per Arachne's model |
| Sharing `entity_servers` permission configs | Compatible — same structure, minor naming differences |
| Sharing audit log data | Compatible — identical concept |

The two systems can coexist. Same problem, compatible data models, different routing strategies.

---

## Summary Table

| Feature | Arachne | Resonance |
|---------|---------|-----------|
| Entity identity | Per-connection (implicit) | Per-call (explicit `entity_id` param) |
| Connections needed | 1 per entity | 1 total |
| Permission table | `entity_servers` | `entity_servers` (same) |
| Permission logic | Whitelist channels + tools, blocklist, active flag | Same |
| Audit log | `entity_action_log` | `entity_action_log` (same) |
| Backward compatible | N/A (entities are required) | Yes (entity_id is optional) |
| Bot accounts | 1 shared | 1 shared |
| Companion identity in Discord | Webhook masking (name + avatar) | Webhook masking (name + avatar) |
| Cron/trigger scoping | Gateway events | `watch_channels` in entity_servers |

---

*Written for cross-reference between Discord Resonance and Arachne Discord MCP implementations.*
