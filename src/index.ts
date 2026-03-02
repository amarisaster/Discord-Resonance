/**
 * Discord Companion Bot — Soul Worker
 * Multi-entity MCP server for Discord
 *
 * Architecture:
 * - Cron trigger polls Discord REST API every minute for new messages
 * - Detects companion trigger words, stores as pending commands
 * - Claude/Antigravity connects via /mcp, polls get_pending_commands
 * - Claude generates response, calls respond_to_command
 * - Worker dispatches response via Discord webhook with companion name + avatar
 * - Vessel (Node.js) can also POST to /trigger as alternative input
 */

import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { Companion, SEED_COMPANIONS } from "./companions";
import { renderDashboard, renderRegisterPage } from "./dashboard";

const DISCORD_API = 'https://discord.com/api/v10';

interface Env {
  COMPANION_BOT: DurableObjectNamespace<CompanionBot>;
  DISCORD_TOKEN: string;
  WATCH_CHANNELS: string;
  WEBHOOK_URL: string;
  DASHBOARD_TOKEN?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
  ADMIN_DISCORD_ID?: string;
}

interface PendingCommand {
  id: string;
  companion_id: string;
  content: string;
  author: { username: string; id?: string };
  channel_id: string;
  webhook_url?: string;
  timestamp: number;
}

// Helper: Discord API request with bot token
async function discordRequest(env: Env, endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = `${DISCORD_API}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${env.DISCORD_TOKEN}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    return { error: true, status: response.status, message: text };
  }

  if (response.status === 204) return {};
  return response.json();
}

// Helper: Split long messages at Discord's 2000 character limit
function splitMessage(content: string, maxLength: number = 2000): string[] {
  if (content.length <= maxLength) return [content];
  const chunks: string[] = [];
  let remaining = content;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at last newline before limit
    let splitAt = remaining.lastIndexOf('\n', maxLength);
    // If no newline, try last space
    if (splitAt <= 0) splitAt = remaining.lastIndexOf(' ', maxLength);
    // If still nothing, hard split
    if (splitAt <= 0) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).replace(/^\n/, '');
  }
  return chunks;
}

// ========== Durable Object: CompanionBot ==========

export class CompanionBot extends McpAgent<Env> {
  server = new McpServer({
    name: "discord-companion-bot",
    version: "1.0.0",
  });

  // SQLite-backed pending commands (survives DO eviction)
  private dbReady = false;

  private ensureTable() {
    if (this.dbReady) return;
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pending_commands (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      content TEXT NOT NULL,
      author_username TEXT NOT NULL,
      author_id TEXT,
      channel_id TEXT NOT NULL,
      webhook_url TEXT,
      timestamp INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS channel_cursors (
      channel_id TEXT PRIMARY KEY,
      last_message_id TEXT NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS avatars (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      content_type TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS companions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar_url TEXT NOT NULL,
      triggers TEXT NOT NULL,
      human_name TEXT,
      human_info TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      discord_id TEXT NOT NULL,
      discord_username TEXT NOT NULL,
      discord_avatar TEXT,
      discord_global_name TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )`);
    // Per-companion custom rules/instructions
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS companion_rules (
      companion_id TEXT PRIMARY KEY,
      rules TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    // Per-companion channel permissions (blocklist)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS companion_channels (
      companion_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      blocked INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (companion_id, channel_id)
    )`);
    // Activity log for message tracking
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS companion_activity (
      id TEXT PRIMARY KEY,
      companion_id TEXT NOT NULL,
      type TEXT NOT NULL,
      channel_id TEXT,
      content TEXT,
      author TEXT,
      message_id TEXT,
      webhook_url TEXT,
      timestamp INTEGER NOT NULL
    )`);
    // Per-channel webhook cache (auto-created)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS channel_webhooks (
      channel_id TEXT PRIMARY KEY,
      webhook_url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    // Banned servers — bot auto-leaves if re-invited
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS banned_servers (
      guild_id TEXT PRIMARY KEY,
      reason TEXT,
      banned_at INTEGER NOT NULL
    )`);
    // Entity model: per-server companion config (permissions, channel/tool whitelists)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS entity_servers (
      entity_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      allowed_channels TEXT,
      blocked_channels TEXT,
      allowed_tools TEXT,
      watch_channels TEXT,
      active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (entity_id, guild_id)
    )`);
    // Entity model: audit trail for entity-scoped actions
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS entity_action_log (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      guild_id TEXT,
      channel_id TEXT,
      tool_name TEXT NOT NULL,
      action_summary TEXT,
      success INTEGER DEFAULT 1,
      error_message TEXT,
      timestamp INTEGER NOT NULL
    )`);
    // Entity model: channel → guild resolution cache
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS channel_guild_cache (
      channel_id TEXT PRIMARY KEY,
      guild_id TEXT NOT NULL,
      cached_at INTEGER NOT NULL
    )`);
    // Admin-controlled restricted channels — blocked for all companions unless exception granted
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS restricted_channels (
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      restricted_by TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (channel_id, guild_id)
    )`);
    // Per-companion exceptions for restricted channels (admin-granted only)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS channel_exceptions (
      companion_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      guild_id TEXT NOT NULL,
      granted_by TEXT,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (companion_id, channel_id, guild_id)
    )`);
    // Migration: add owner_id to companions (idempotent)
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE companions ADD COLUMN owner_id TEXT`);
    } catch (_) { /* column already exists */ }
    // Migration: add message_id and webhook_url to activity (idempotent)
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE companion_activity ADD COLUMN message_id TEXT`);
    } catch (_) {}
    try {
      this.ctx.storage.sql.exec(`ALTER TABLE companion_activity ADD COLUMN webhook_url TEXT`);
    } catch (_) {}
    this.dbReady = true;
    this.seedCompanions();
  }

  // Seed companions from hardcoded data if table is empty
  private seedCompanions() {
    const count = this.ctx.storage.sql.exec(`SELECT COUNT(*) as cnt FROM companions`).toArray();
    if ((count[0] as any).cnt > 0) return;

    const now = Date.now();
    for (const c of Object.values(SEED_COMPANIONS)) {
      this.ctx.storage.sql.exec(
        `INSERT INTO companions (id, name, avatar_url, triggers, human_name, human_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        c.id, c.name, c.avatar_url, JSON.stringify(c.triggers), c.human_name || null, c.human_info || null, now, now
      );
    }
    console.log(`Seeded ${Object.keys(SEED_COMPANIONS).length} companions`);
  }

  // ===== Companion CRUD =====

  getAllCompanions(): (Companion & { owner_id?: string })[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(`SELECT * FROM companions ORDER BY created_at ASC`).toArray().map((row: any) => ({
      id: row.id,
      name: row.name,
      avatar_url: row.avatar_url,
      triggers: JSON.parse(row.triggers),
      human_name: row.human_name || undefined,
      human_info: row.human_info || undefined,
      owner_id: row.owner_id || undefined,
    }));
  }

  getCompanionById(id: string): (Companion & { owner_id?: string }) | undefined {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(`SELECT * FROM companions WHERE id = ?`, id).toArray();
    if (rows.length === 0) return undefined;
    const row = rows[0] as any;
    return {
      id: row.id,
      name: row.name,
      avatar_url: row.avatar_url,
      triggers: JSON.parse(row.triggers),
      human_name: row.human_name || undefined,
      human_info: row.human_info || undefined,
      owner_id: row.owner_id || undefined,
    };
  }

  getCompanionsByOwner(ownerId: string): (Companion & { owner_id?: string })[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(`SELECT * FROM companions WHERE owner_id = ? ORDER BY created_at ASC`, ownerId).toArray().map((row: any) => ({
      id: row.id,
      name: row.name,
      avatar_url: row.avatar_url,
      triggers: JSON.parse(row.triggers),
      human_name: row.human_name || undefined,
      human_info: row.human_info || undefined,
      owner_id: row.owner_id || undefined,
    }));
  }

  createCompanion(data: { id: string; name: string; avatar_url: string; triggers: string[]; human_name?: string; human_info?: string; owner_id?: string }): Companion {
    this.ensureTable();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO companions (id, name, avatar_url, triggers, human_name, human_info, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.name, data.avatar_url, JSON.stringify(data.triggers), data.human_name || null, data.human_info || null, data.owner_id || null, now, now
    );
    return { ...data };
  }

  updateCompanion(id: string, data: { name?: string; avatar_url?: string; triggers?: string[]; human_name?: string; human_info?: string; owner_id?: string }): Companion | undefined {
    this.ensureTable();
    const existing = this.getCompanionById(id);
    if (!existing) return undefined;

    const updated = {
      name: data.name ?? existing.name,
      avatar_url: data.avatar_url ?? existing.avatar_url,
      triggers: data.triggers ?? existing.triggers,
      human_name: data.human_name ?? existing.human_name,
      human_info: data.human_info ?? existing.human_info,
      owner_id: data.owner_id ?? (existing as any).owner_id,
    };

    this.ctx.storage.sql.exec(
      `UPDATE companions SET name = ?, avatar_url = ?, triggers = ?, human_name = ?, human_info = ?, owner_id = ?, updated_at = ? WHERE id = ?`,
      updated.name, updated.avatar_url, JSON.stringify(updated.triggers), updated.human_name || null, updated.human_info || null, updated.owner_id || null, Date.now(), id
    );

    return { id, ...updated };
  }

  deleteCompanion(id: string): boolean {
    this.ensureTable();
    const existing = this.getCompanionById(id);
    if (!existing) return false;
    this.ctx.storage.sql.exec(`DELETE FROM companions WHERE id = ?`, id);
    this.ctx.storage.sql.exec(`DELETE FROM companion_rules WHERE companion_id = ?`, id);
    this.ctx.storage.sql.exec(`DELETE FROM companion_channels WHERE companion_id = ?`, id);
    this.ctx.storage.sql.exec(`DELETE FROM companion_activity WHERE companion_id = ?`, id);
    return true;
  }

  // ===== Rules CRUD =====

  getRules(companionId: string): string | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(`SELECT rules FROM companion_rules WHERE companion_id = ?`, companionId).toArray();
    return rows.length > 0 ? (rows[0] as any).rules : null;
  }

  setRules(companionId: string, rules: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO companion_rules (companion_id, rules, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(companion_id) DO UPDATE SET rules = excluded.rules, updated_at = excluded.updated_at`,
      companionId, rules, Date.now()
    );
  }

  // ===== Channel permissions =====

  getBlockedChannels(companionId: string): string[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT channel_id FROM companion_channels WHERE companion_id = ? AND blocked = 1`, companionId
    ).toArray().map((r: any) => r.channel_id);
  }

  setChannelBlocked(companionId: string, channelId: string, blocked: boolean) {
    this.ensureTable();
    if (blocked) {
      this.ctx.storage.sql.exec(
        `INSERT INTO companion_channels (companion_id, channel_id, blocked) VALUES (?, ?, 1)
         ON CONFLICT(companion_id, channel_id) DO UPDATE SET blocked = 1`,
        companionId, channelId
      );
    } else {
      this.ctx.storage.sql.exec(
        `DELETE FROM companion_channels WHERE companion_id = ? AND channel_id = ?`,
        companionId, channelId
      );
    }
  }

  isChannelBlocked(companionId: string, channelId: string): boolean {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT blocked FROM companion_channels WHERE companion_id = ? AND channel_id = ? AND blocked = 1`,
      companionId, channelId
    ).toArray();
    return rows.length > 0;
  }

  // ===== Activity logging =====

  logActivity(companionId: string, type: string, channelId?: string, content?: string, author?: string, messageId?: string, webhookUrl?: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO companion_activity (id, companion_id, type, channel_id, content, author, message_id, webhook_url, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), companionId, type, channelId || null, content || null, author || null, messageId || null, webhookUrl || null, Date.now()
    );
    // Keep only last 200 entries per companion
    this.ctx.storage.sql.exec(
      `DELETE FROM companion_activity WHERE companion_id = ? AND id NOT IN (
        SELECT id FROM companion_activity WHERE companion_id = ? ORDER BY timestamp DESC LIMIT 200
      )`, companionId, companionId
    );
  }

  getActivity(companionId: string, limit: number = 50): any[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT * FROM companion_activity WHERE companion_id = ? ORDER BY timestamp DESC LIMIT ?`,
      companionId, limit
    ).toArray().map((r: any) => ({
      id: r.id,
      companion_id: r.companion_id,
      type: r.type,
      channel_id: r.channel_id,
      content: r.content,
      author: r.author,
      message_id: r.message_id || undefined,
      webhook_url: r.webhook_url || undefined,
      timestamp: r.timestamp,
      age_seconds: Math.round((Date.now() - r.timestamp) / 1000),
    }));
  }

  // Look up which companion sent a message by its Discord message_id (for reply detection)
  getCompanionByMessageId(messageId: string): string | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT companion_id FROM companion_activity WHERE message_id = ? LIMIT 1`, messageId
    ).toArray();
    return rows.length > 0 ? (rows[0] as any).companion_id : null;
  }

  // ===== Entity permission model =====

  getEntityServerConfig(entityId: string, guildId: string): any | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT * FROM entity_servers WHERE entity_id = ? AND guild_id = ?`, entityId, guildId
    ).toArray();
    if (rows.length === 0) return null;
    const row = rows[0] as any;
    return {
      entity_id: row.entity_id,
      guild_id: row.guild_id,
      allowed_channels: row.allowed_channels ? JSON.parse(row.allowed_channels) : null,
      blocked_channels: row.blocked_channels ? JSON.parse(row.blocked_channels) : null,
      allowed_tools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
      watch_channels: row.watch_channels ? JSON.parse(row.watch_channels) : null,
      active: row.active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  setEntityServerConfig(entityId: string, guildId: string, config: {
    allowed_channels?: string[] | null;
    blocked_channels?: string[] | null;
    allowed_tools?: string[] | null;
    watch_channels?: string[] | null;
    active?: boolean;
  }) {
    this.ensureTable();
    const now = Date.now();
    const existing = this.getEntityServerConfig(entityId, guildId);
    if (existing) {
      this.ctx.storage.sql.exec(
        `UPDATE entity_servers SET allowed_channels = ?, blocked_channels = ?, allowed_tools = ?, watch_channels = ?, active = ?, updated_at = ? WHERE entity_id = ? AND guild_id = ?`,
        config.allowed_channels !== undefined ? JSON.stringify(config.allowed_channels) : (existing.allowed_channels ? JSON.stringify(existing.allowed_channels) : null),
        config.blocked_channels !== undefined ? JSON.stringify(config.blocked_channels) : (existing.blocked_channels ? JSON.stringify(existing.blocked_channels) : null),
        config.allowed_tools !== undefined ? JSON.stringify(config.allowed_tools) : (existing.allowed_tools ? JSON.stringify(existing.allowed_tools) : null),
        config.watch_channels !== undefined ? JSON.stringify(config.watch_channels) : (existing.watch_channels ? JSON.stringify(existing.watch_channels) : null),
        config.active !== undefined ? (config.active ? 1 : 0) : (existing.active ? 1 : 0),
        now, entityId, guildId
      );
    } else {
      this.ctx.storage.sql.exec(
        `INSERT INTO entity_servers (entity_id, guild_id, allowed_channels, blocked_channels, allowed_tools, watch_channels, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        entityId, guildId,
        config.allowed_channels ? JSON.stringify(config.allowed_channels) : null,
        config.blocked_channels ? JSON.stringify(config.blocked_channels) : null,
        config.allowed_tools ? JSON.stringify(config.allowed_tools) : null,
        config.watch_channels ? JSON.stringify(config.watch_channels) : null,
        config.active !== undefined ? (config.active ? 1 : 0) : 1,
        now, now
      );
    }
  }

  deleteEntityServerConfig(entityId: string, guildId: string): boolean {
    this.ensureTable();
    const existing = this.getEntityServerConfig(entityId, guildId);
    if (!existing) return false;
    this.ctx.storage.sql.exec(`DELETE FROM entity_servers WHERE entity_id = ? AND guild_id = ?`, entityId, guildId);
    return true;
  }

  resolveGuildIdFromCache(channelId: string): string | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT guild_id FROM channel_guild_cache WHERE channel_id = ?`, channelId
    ).toArray();
    return rows.length > 0 ? (rows[0] as any).guild_id : null;
  }

  cacheChannelGuild(channelId: string, guildId: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO channel_guild_cache (channel_id, guild_id, cached_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET guild_id = excluded.guild_id, cached_at = excluded.cached_at`,
      channelId, guildId, Date.now()
    );
  }

  async resolveGuildId(channelId: string): Promise<string | null> {
    // Check cache first
    const cached = this.resolveGuildIdFromCache(channelId);
    if (cached) return cached;
    // Fetch from Discord API
    try {
      const ch = await discordRequest(this.env, `/channels/${channelId}`);
      if (!ch.error && ch.guild_id) {
        this.cacheChannelGuild(channelId, ch.guild_id);
        return ch.guild_id;
      }
    } catch (_) {}
    return null;
  }

  checkEntityPermission(entityId: string, toolName: string, guildId: string | null, channelId: string | null): { allowed: boolean; reason?: string } {
    // No guild context = can't check server-level permissions, allow by default
    if (!guildId) return { allowed: true };

    const config = this.getEntityServerConfig(entityId, guildId);
    // No config = no restrictions for this entity in this server
    if (!config) return { allowed: true };

    // Check active status
    if (!config.active) {
      return { allowed: false, reason: `Entity ${entityId} is deactivated in guild ${guildId}` };
    }

    // Check tool whitelist
    if (config.allowed_tools && !config.allowed_tools.includes(toolName)) {
      return { allowed: false, reason: `Tool '${toolName}' not in allowed tools for entity ${entityId} in guild ${guildId}` };
    }

    // Check channel permissions
    if (channelId) {
      // Check server-wide restricted channels FIRST (admin override)
      if (this.isChannelRestricted(channelId, guildId)) {
        if (!this.hasChannelException(entityId, channelId, guildId)) {
          return { allowed: false, reason: `Channel ${channelId} is restricted — admin exception required` };
        }
      }
      if (config.blocked_channels && config.blocked_channels.includes(channelId)) {
        return { allowed: false, reason: `Channel ${channelId} is blocked for entity ${entityId} in guild ${guildId}` };
      }
      if (config.allowed_channels && !config.allowed_channels.includes(channelId)) {
        return { allowed: false, reason: `Channel ${channelId} not in allowed channels for entity ${entityId} in guild ${guildId}` };
      }
    }

    return { allowed: true };
  }

  logEntityAction(entityId: string, guildId: string | null, channelId: string | null, toolName: string, summary: string | null, success: boolean, errorMessage?: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO entity_action_log (id, entity_id, guild_id, channel_id, tool_name, action_summary, success, error_message, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(), entityId, guildId || null, channelId || null, toolName, summary || null, success ? 1 : 0, errorMessage || null, Date.now()
    );
    // Prune old entries (keep last 500 per entity)
    this.ctx.storage.sql.exec(
      `DELETE FROM entity_action_log WHERE entity_id = ? AND id NOT IN (
        SELECT id FROM entity_action_log WHERE entity_id = ? ORDER BY timestamp DESC LIMIT 500
      )`, entityId, entityId
    );
  }

  getEntityActionLog(entityId: string, limit: number = 50): any[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT * FROM entity_action_log WHERE entity_id = ? ORDER BY timestamp DESC LIMIT ?`,
      entityId, limit
    ).toArray().map((r: any) => ({
      id: r.id,
      entity_id: r.entity_id,
      guild_id: r.guild_id,
      channel_id: r.channel_id,
      tool_name: r.tool_name,
      action_summary: r.action_summary,
      success: r.success === 1,
      error_message: r.error_message,
      timestamp: r.timestamp,
    }));
  }

  getAllEntityServerConfigs(entityId: string): any[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT * FROM entity_servers WHERE entity_id = ? ORDER BY created_at ASC`, entityId
    ).toArray().map((row: any) => ({
      entity_id: row.entity_id,
      guild_id: row.guild_id,
      allowed_channels: row.allowed_channels ? JSON.parse(row.allowed_channels) : null,
      blocked_channels: row.blocked_channels ? JSON.parse(row.blocked_channels) : null,
      allowed_tools: row.allowed_tools ? JSON.parse(row.allowed_tools) : null,
      watch_channels: row.watch_channels ? JSON.parse(row.watch_channels) : null,
      active: row.active === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  // ===== Restricted channels (admin-controlled) =====

  isChannelRestricted(channelId: string, guildId: string): boolean {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT 1 FROM restricted_channels WHERE channel_id = ? AND guild_id = ?`, channelId, guildId
    ).toArray();
    return rows.length > 0;
  }

  hasChannelException(companionId: string, channelId: string, guildId: string): boolean {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT 1 FROM channel_exceptions WHERE companion_id = ? AND channel_id = ? AND guild_id = ?`, companionId, channelId, guildId
    ).toArray();
    return rows.length > 0;
  }

  getRestrictedChannels(guildId: string): any[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT * FROM restricted_channels WHERE guild_id = ? ORDER BY created_at ASC`, guildId
    ).toArray().map((r: any) => ({
      channel_id: r.channel_id,
      guild_id: r.guild_id,
      restricted_by: r.restricted_by,
      created_at: r.created_at,
    }));
  }

  setChannelRestricted(channelId: string, guildId: string, restrictedBy?: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO restricted_channels (channel_id, guild_id, restricted_by, created_at) VALUES (?, ?, ?, ?)`,
      channelId, guildId, restrictedBy || null, Date.now()
    );
  }

  removeChannelRestriction(channelId: string, guildId: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(`DELETE FROM restricted_channels WHERE channel_id = ? AND guild_id = ?`, channelId, guildId);
    this.ctx.storage.sql.exec(`DELETE FROM channel_exceptions WHERE channel_id = ? AND guild_id = ?`, channelId, guildId);
  }

  grantChannelException(companionId: string, channelId: string, guildId: string, grantedBy?: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT OR IGNORE INTO channel_exceptions (companion_id, channel_id, guild_id, granted_by, created_at) VALUES (?, ?, ?, ?, ?)`,
      companionId, channelId, guildId, grantedBy || null, Date.now()
    );
  }

  revokeChannelException(companionId: string, channelId: string, guildId: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `DELETE FROM channel_exceptions WHERE companion_id = ? AND channel_id = ? AND guild_id = ?`, companionId, channelId, guildId
    );
  }

  getChannelExceptions(channelId: string, guildId: string): any[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(
      `SELECT * FROM channel_exceptions WHERE channel_id = ? AND guild_id = ? ORDER BY created_at ASC`, channelId, guildId
    ).toArray().map((r: any) => ({
      companion_id: r.companion_id,
      channel_id: r.channel_id,
      guild_id: r.guild_id,
      granted_by: r.granted_by,
      created_at: r.created_at,
    }));
  }

  // ===== Per-channel webhook management =====

  getChannelWebhook(channelId: string): string | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT webhook_url FROM channel_webhooks WHERE channel_id = ?`, channelId
    ).toArray();
    return rows.length > 0 ? (rows[0] as any).webhook_url : null;
  }

  storeChannelWebhook(channelId: string, webhookUrl: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO channel_webhooks (channel_id, webhook_url, created_at) VALUES (?, ?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET webhook_url = excluded.webhook_url`,
      channelId, webhookUrl, Date.now()
    );
  }

  async getOrCreateWebhook(channelId: string): Promise<string | null> {
    // Check cache first
    const cached = this.getChannelWebhook(channelId);
    if (cached) return cached;

    // Check if bot already has a webhook in this channel
    try {
      const existing = await discordRequest(this.env, `/channels/${channelId}/webhooks`);
      if (!existing.error && Array.isArray(existing)) {
        const ours = existing.find((w: any) => w.name === 'Resonance');
        if (ours) {
          const url = `https://discord.com/api/webhooks/${ours.id}/${ours.token}`;
          this.storeChannelWebhook(channelId, url);
          return url;
        }
      }
    } catch (_) {}

    // Create a new webhook
    try {
      const created = await discordRequest(this.env, `/channels/${channelId}/webhooks`, {
        method: 'POST',
        body: JSON.stringify({ name: 'Resonance' }),
      });
      if (!created.error && created.id && created.token) {
        const url = `https://discord.com/api/webhooks/${created.id}/${created.token}`;
        this.storeChannelWebhook(channelId, url);
        console.log(`Auto-created webhook for channel ${channelId}`);
        return url;
      }
    } catch (err: any) {
      console.error(`Failed to create webhook for channel ${channelId}: ${err.message}`);
    }

    // Fallback to global WEBHOOK_URL
    return this.env.WEBHOOK_URL || null;
  }

  // Get or create webhook via the default DO (for use from MCP session DOs)
  async getOrCreateWebhookViaDefault(channelId: string): Promise<string | null> {
    const defaultStub = this.getDefaultStub();
    const resp = await defaultStub.fetch(new Request(`http://internal/api/channel-webhook/${channelId}`));
    const data = await resp.json() as any;
    return data.webhook_url || null;
  }

  // Send a DM notification to a companion's owner when triggered
  async notifyOwnerDM(companion: Companion & { owner_id?: string }, channelId: string, content: string, authorName: string): Promise<void> {
    if (!companion.owner_id) return;
    try {
      // Create DM channel
      const dm = await discordRequest(this.env, `/users/@me/channels`, {
        method: 'POST', body: JSON.stringify({ recipient_id: companion.owner_id })
      });
      if (dm.error || !dm.id) return;

      const preview = content.length > 200 ? content.slice(0, 200) + '...' : content;
      const jumpLink = `https://discord.com/channels/-/${channelId}`;
      await discordRequest(this.env, `/channels/${dm.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          content: `🔔 **${companion.name}** was triggered by **${authorName}**:\n> ${preview}\n[Jump to message](${jumpLink})`
        })
      });
    } catch (_) {
      // DM notification is best-effort, don't break polling on failure
    }
  }

  // Dynamic versions of companion helpers (read from SQLite)
  findTriggeredCompanionDynamic(content: string): { matched: Companion[]; debug: string[] } {
    const all = this.getAllCompanions();
    const lower = content.toLowerCase();
    const matched: Companion[] = [];
    const debug: string[] = [];
    for (const companion of all) {
      for (const trigger of companion.triggers) {
        const escaped = trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(content)) {
          matched.push(companion);
          debug.push(`${companion.id}:matched:"${trigger}"`);
          break;
        }
      }
    }
    return { matched, debug };
  }

  private getCursor(channelId: string): string | null {
    this.ensureTable();
    const rows = this.ctx.storage.sql.exec(
      `SELECT last_message_id FROM channel_cursors WHERE channel_id = ?`, channelId
    ).toArray();
    return rows.length > 0 ? (rows[0] as any).last_message_id : null;
  }

  private setCursor(channelId: string, messageId: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO channel_cursors (channel_id, last_message_id) VALUES (?, ?)
       ON CONFLICT(channel_id) DO UPDATE SET last_message_id = excluded.last_message_id`,
      channelId, messageId
    );
  }

  private cleanStale() {
    this.ensureTable();
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    this.ctx.storage.sql.exec(`DELETE FROM pending_commands WHERE timestamp < ?`, tenMinutesAgo);
  }

  private getPending(): PendingCommand[] {
    this.ensureTable();
    this.cleanStale();
    const rows = this.ctx.storage.sql.exec(`SELECT * FROM pending_commands ORDER BY timestamp ASC`).toArray();
    return rows.map((row: any) => ({
      id: row.id,
      companion_id: row.companion_id,
      content: row.content,
      author: { username: row.author_username, id: row.author_id || undefined },
      channel_id: row.channel_id,
      webhook_url: row.webhook_url || undefined,
      timestamp: row.timestamp,
    }));
  }

  private storeCommand(cmd: PendingCommand) {
    this.ensureTable();
    this.ctx.storage.sql.exec(
      `INSERT INTO pending_commands (id, companion_id, content, author_username, author_id, channel_id, webhook_url, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      cmd.id, cmd.companion_id, cmd.content, cmd.author.username, cmd.author.id || null, cmd.channel_id, cmd.webhook_url || null, cmd.timestamp
    );
  }

  private deleteCommand(id: string) {
    this.ensureTable();
    this.ctx.storage.sql.exec(`DELETE FROM pending_commands WHERE id = ?`, id);
  }

  // Override fetch to handle trigger and pending endpoints
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/trigger' && request.method === 'POST') {
      return this.handleTrigger(request);
    }

    if (url.pathname === '/pending' && request.method === 'GET') {
      return this.handleGetPending();
    }

    if (url.pathname === '/poll' && request.method === 'POST') {
      return this.handlePoll();
    }

    if (url.pathname === '/delete-command' && request.method === 'POST') {
      const body = await request.json() as { id: string };
      this.deleteCommand(body.id);
      return new Response(JSON.stringify({ deleted: body.id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Avatar upload/serve =====

    if (url.pathname === '/upload-avatar' && request.method === 'POST') {
      try {
        this.ensureTable();
        const formData = await request.formData();
        const file = formData.get('file') as File;
        if (!file) {
          return new Response(JSON.stringify({ error: 'No file provided' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) {
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        }
        const base64 = btoa(binary);
        const id = crypto.randomUUID();
        this.ctx.storage.sql.exec(
          `INSERT INTO avatars (id, data, content_type, created_at) VALUES (?, ?, ?, ?)`,
          id, base64, file.type || 'image/png', Date.now()
        );
        const avatarUrl = `${request.headers.get('origin') || url.origin}/avatars/${id}`;
        return new Response(JSON.stringify({ url: avatarUrl, id }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    const avatarMatch = url.pathname.match(/^\/avatars\/([^/]+)$/);
    if (avatarMatch && request.method === 'GET') {
      this.ensureTable();
      const rows = this.ctx.storage.sql.exec(`SELECT data, content_type FROM avatars WHERE id = ?`, avatarMatch[1]).toArray();
      if (rows.length === 0) {
        return new Response('Not found', { status: 404 });
      }
      const row = rows[0] as any;
      const bytes = Uint8Array.from(atob(row.data), c => c.charCodeAt(0));
      return new Response(bytes, {
        headers: { 'Content-Type': row.content_type, 'Cache-Control': 'public, max-age=31536000' },
      });
    }

    // ===== Companion API routes =====

    if (url.pathname === '/api/companions' && request.method === 'GET') {
      const companions = this.getAllCompanions();
      return new Response(JSON.stringify(companions, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // /api/companions/mine MUST be before the :id regex match
    if (url.pathname === '/api/companions/mine' && request.method === 'GET') {
      const ownerId = url.searchParams.get('owner_id');
      if (!ownerId) {
        return new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const mine = this.getCompanionsByOwner(ownerId);
      return new Response(JSON.stringify(mine, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Match /api/companions/:id (after /mine to avoid collision)
    const companionMatch = url.pathname.match(/^\/api\/companions\/([^/]+)$/);

    if (companionMatch && companionMatch[1] !== 'mine' && request.method === 'GET') {
      const companion = this.getCompanionById(companionMatch[1]);
      if (!companion) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify(companion), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/companions' && request.method === 'POST') {
      try {
        const body = await request.json() as any;
        if (!body.name || !body.avatar_url || !body.triggers) {
          return new Response(JSON.stringify({ error: 'name, avatar_url, and triggers are required' }), {
            status: 400, headers: { 'Content-Type': 'application/json' },
          });
        }
        // Limit: 10 companions per owner
        if (body.owner_id) {
          const existing = this.getCompanionsByOwner(body.owner_id);
          if (existing.length >= 10) {
            return new Response(JSON.stringify({ error: 'Companion limit reached (10 per account)' }), {
              status: 400, headers: { 'Content-Type': 'application/json' },
            });
          }
        }
        const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const triggers = Array.isArray(body.triggers) ? body.triggers : body.triggers.split(',').map((t: string) => t.trim());
        const companion = this.createCompanion({
          id, name: body.name, avatar_url: body.avatar_url, triggers,
          human_name: body.human_name, human_info: body.human_info,
          owner_id: body.owner_id,
        });
        return new Response(JSON.stringify(companion), {
          status: 201, headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (companionMatch && request.method === 'PUT') {
      try {
        const body = await request.json() as any;
        if (body.triggers && !Array.isArray(body.triggers)) {
          body.triggers = body.triggers.split(',').map((t: string) => t.trim());
        }
        const updated = this.updateCompanion(companionMatch[1], body);
        if (!updated) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404, headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(updated), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    if (companionMatch && request.method === 'DELETE') {
      const deleted = this.deleteCompanion(companionMatch[1]);
      if (!deleted) {
        return new Response(JSON.stringify({ error: 'Not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ deleted: companionMatch[1] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Internal: assign owner to companion =====

    // ===== Internal activity logging (called by MCP tools) =====

    if (url.pathname === '/api/log-activity' && request.method === 'POST') {
      const body = await request.json() as any;
      this.logActivity(body.companion_id, body.type, body.channel_id, body.content, body.author, body.message_id, body.webhook_url);
      return new Response(JSON.stringify({ logged: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Channel webhook resolution =====

    const webhookMatch = url.pathname.match(/^\/api\/channel-webhook\/([^/]+)$/);
    if (webhookMatch && request.method === 'GET') {
      const chId = webhookMatch[1];
      const webhookUrl = await this.getOrCreateWebhook(chId);
      return new Response(JSON.stringify({ channel_id: chId, webhook_url: webhookUrl }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Companion rules API =====

    const rulesMatch = url.pathname.match(/^\/api\/companions\/([^/]+)\/rules$/);
    if (rulesMatch && request.method === 'GET') {
      const rules = this.getRules(rulesMatch[1]);
      return new Response(JSON.stringify({ companion_id: rulesMatch[1], rules }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (rulesMatch && request.method === 'PUT') {
      const body = await request.json() as any;
      this.setRules(rulesMatch[1], body.rules || '');
      return new Response(JSON.stringify({ companion_id: rulesMatch[1], rules: body.rules, updated: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Companion channels API =====

    const channelsMatch = url.pathname.match(/^\/api\/companions\/([^/]+)\/channels$/);
    if (channelsMatch && request.method === 'GET') {
      const blocked = this.getBlockedChannels(channelsMatch[1]);
      return new Response(JSON.stringify({ companion_id: channelsMatch[1], blocked_channels: blocked }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (channelsMatch && request.method === 'PUT') {
      const body = await request.json() as any;
      // body: { channel_id, blocked: true/false }
      if (body.channel_id !== undefined && body.blocked !== undefined) {
        this.setChannelBlocked(channelsMatch[1], body.channel_id, body.blocked);
      }
      const blocked = this.getBlockedChannels(channelsMatch[1]);
      return new Response(JSON.stringify({ companion_id: channelsMatch[1], blocked_channels: blocked, updated: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Companion activity API =====

    const activityMatch = url.pathname.match(/^\/api\/companions\/([^/]+)\/activity$/);
    if (activityMatch && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const activity = this.getActivity(activityMatch[1], limit);
      return new Response(JSON.stringify({ companion_id: activityMatch[1], activity }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Session management =====

    if (url.pathname === '/auth/create-session' && request.method === 'POST') {
      this.ensureTable();
      const user = await request.json() as any;
      const token = crypto.randomUUID();
      const now = Date.now();
      const expires = now + 7 * 24 * 60 * 60 * 1000; // 7 days
      // Clean expired sessions
      this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE expires_at < ?`, now);
      this.ctx.storage.sql.exec(
        `INSERT INTO sessions (token, discord_id, discord_username, discord_avatar, discord_global_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        token, user.id, user.username, user.avatar || null, user.global_name || null, now, expires
      );
      return new Response(JSON.stringify({ token }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/auth/me' && request.method === 'GET') {
      this.ensureTable();
      const token = url.searchParams.get('token');
      const adminId = url.searchParams.get('admin_id') || '';
      if (!token) {
        return new Response(JSON.stringify({ user: null }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const now = Date.now();
      const rows = this.ctx.storage.sql.exec(
        `SELECT * FROM sessions WHERE token = ? AND expires_at > ?`, token, now
      ).toArray();
      if (rows.length === 0) {
        return new Response(JSON.stringify({ user: null }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const row = rows[0] as any;
      const isAdmin = adminId ? row.discord_id === adminId : false;
      return new Response(JSON.stringify({
        user: {
          id: row.discord_id,
          username: row.discord_username,
          avatar: row.discord_avatar,
          global_name: row.discord_global_name,
          is_admin: isAdmin,
        },
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/auth/delete-session' && request.method === 'POST') {
      this.ensureTable();
      const { token } = await request.json() as any;
      if (token) {
        this.ctx.storage.sql.exec(`DELETE FROM sessions WHERE token = ?`, token);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/auth/validate' && request.method === 'POST') {
      this.ensureTable();
      const { token } = await request.json() as any;
      const now = Date.now();
      const rows = this.ctx.storage.sql.exec(
        `SELECT discord_id FROM sessions WHERE token = ? AND expires_at > ?`, token, now
      ).toArray();
      return new Response(JSON.stringify({ valid: rows.length > 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Server ban API =====

    if (url.pathname === '/api/ban-server' && request.method === 'POST') {
      const body = await request.json() as any;
      this.ctx.storage.sql.exec(
        `INSERT OR REPLACE INTO banned_servers (guild_id, reason, banned_at) VALUES (?, ?, ?)`,
        body.guild_id, body.reason || null, Date.now()
      );
      // Try to leave the server
      try {
        await discordRequest(this.env, `/users/@me/guilds/${body.guild_id}`, { method: 'DELETE' });
      } catch (_) {}
      return new Response(JSON.stringify({ ok: true, guild_id: body.guild_id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/unban-server' && request.method === 'POST') {
      const body = await request.json() as any;
      this.ctx.storage.sql.exec(`DELETE FROM banned_servers WHERE guild_id = ?`, body.guild_id);
      return new Response(JSON.stringify({ ok: true, guild_id: body.guild_id }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (url.pathname === '/api/banned-servers' && request.method === 'GET') {
      const rows = this.ctx.storage.sql.exec(`SELECT * FROM banned_servers ORDER BY banned_at DESC`).toArray();
      return new Response(JSON.stringify(rows), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Check if a server is banned (used by main worker on guild join)
    if (url.pathname === '/api/check-ban' && request.method === 'GET') {
      const guildId = url.searchParams.get('guild_id');
      if (!guildId) {
        return new Response(JSON.stringify({ banned: false }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const rows = this.ctx.storage.sql.exec(
        `SELECT * FROM banned_servers WHERE guild_id = ?`, guildId
      ).toArray();
      return new Response(JSON.stringify({ banned: rows.length > 0, reason: rows[0]?.reason || null }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== Entity permission API routes =====

    // Check entity permission (used by MCP session DOs)
    if (url.pathname === '/api/entity-check-permission' && request.method === 'POST') {
      const body = await request.json() as { entity_id: string; tool_name: string; guild_id?: string; channel_id?: string };
      const result = this.checkEntityPermission(body.entity_id, body.tool_name, body.guild_id || null, body.channel_id || null);
      return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
    }

    // Resolve channel → guild ID
    const resolveGuildMatch = url.pathname.match(/^\/api\/resolve-guild\/([^/]+)$/);
    if (resolveGuildMatch && request.method === 'GET') {
      const guildId = await this.resolveGuildId(resolveGuildMatch[1]);
      return new Response(JSON.stringify({ guild_id: guildId }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Log entity action
    if (url.pathname === '/api/entity-log-action' && request.method === 'POST') {
      const body = await request.json() as { entity_id: string; guild_id?: string; channel_id?: string; tool_name: string; summary?: string; success: boolean; error_message?: string };
      this.logEntityAction(body.entity_id, body.guild_id || null, body.channel_id || null, body.tool_name, body.summary || null, body.success, body.error_message);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Entity server config CRUD
    const entityServerMatch = url.pathname.match(/^\/api\/entity-servers\/([^/]+)\/([^/]+)$/);
    if (entityServerMatch) {
      const [, entityId, guildId] = entityServerMatch;
      if (request.method === 'GET') {
        const config = this.getEntityServerConfig(entityId, guildId);
        return new Response(JSON.stringify(config || { entity_id: entityId, guild_id: guildId, not_configured: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (request.method === 'PUT') {
        const body = await request.json() as any;
        this.setEntityServerConfig(entityId, guildId, body);
        const updated = this.getEntityServerConfig(entityId, guildId);
        return new Response(JSON.stringify(updated), { headers: { 'Content-Type': 'application/json' } });
      }
      if (request.method === 'DELETE') {
        const deleted = this.deleteEntityServerConfig(entityId, guildId);
        return new Response(JSON.stringify({ ok: deleted }), { headers: { 'Content-Type': 'application/json' } });
      }
    }

    // All entity server configs for an entity
    const entityServersMatch = url.pathname.match(/^\/api\/entity-servers\/([^/]+)$/);
    if (entityServersMatch && request.method === 'GET') {
      const configs = this.getAllEntityServerConfigs(entityServersMatch[1]);
      return new Response(JSON.stringify(configs), { headers: { 'Content-Type': 'application/json' } });
    }

    // Entity action log query
    const entityLogMatch = url.pathname.match(/^\/api\/entity-log\/([^/]+)$/);
    if (entityLogMatch && request.method === 'GET') {
      const limit = parseInt(url.searchParams.get('limit') || '50');
      const log = this.getEntityActionLog(entityLogMatch[1], limit);
      return new Response(JSON.stringify(log), { headers: { 'Content-Type': 'application/json' } });
    }

    // ===== Restricted channels API =====

    // Get guild channels from Discord API (for dashboard channel listing)
    const guildChannelsMatch = url.pathname.match(/^\/api\/guild-channels\/(\d+)$/);
    if (guildChannelsMatch && request.method === 'GET') {
      const guildId = guildChannelsMatch[1];
      const channels = await discordRequest(this.env, `/guilds/${guildId}/channels`);
      if (channels.error) {
        return new Response(JSON.stringify(channels), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      const channelTypes: Record<number, string> = { 0: 'text', 2: 'voice', 4: 'category', 5: 'announcement', 13: 'stage', 15: 'forum' };
      const mapped = (channels as any[]).map((c: any) => ({
        id: c.id, name: c.name, type: channelTypes[c.type] || String(c.type),
        parent_id: c.parent_id, position: c.position,
      })).sort((a: any, b: any) => a.position - b.position);
      return new Response(JSON.stringify(mapped), { headers: { 'Content-Type': 'application/json' } });
    }

    // Get restricted channels for a guild
    const restrictedListMatch = url.pathname.match(/^\/api\/restricted-channels\/(\d+)$/);
    if (restrictedListMatch && request.method === 'GET') {
      const restricted = this.getRestrictedChannels(restrictedListMatch[1]);
      return new Response(JSON.stringify(restricted), { headers: { 'Content-Type': 'application/json' } });
    }

    // Set/remove channel restriction (admin only)
    if (url.pathname === '/api/restricted-channels' && request.method === 'POST') {
      const body = await request.json() as { channel_id: string; guild_id: string; restricted_by?: string };
      this.setChannelRestricted(body.channel_id, body.guild_id, body.restricted_by);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/api/restricted-channels' && request.method === 'DELETE') {
      const body = await request.json() as { channel_id: string; guild_id: string };
      this.removeChannelRestriction(body.channel_id, body.guild_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Check if a specific channel is restricted (with optional companion exception check)
    const channelRestrictedMatch = url.pathname.match(/^\/api\/channel-restricted\/(\d+)\/(\d+)$/);
    if (channelRestrictedMatch && request.method === 'GET') {
      const [, channelId, guildId] = channelRestrictedMatch;
      const companionId = url.searchParams.get('companion_id');
      const restricted = this.isChannelRestricted(channelId, guildId);
      const hasException = companionId ? this.hasChannelException(companionId, channelId, guildId) : false;
      return new Response(JSON.stringify({ restricted, has_exception: hasException }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Get/grant/revoke channel exceptions
    const exceptionsMatch = url.pathname.match(/^\/api\/channel-exceptions\/(\d+)\/(\d+)$/);
    if (exceptionsMatch && request.method === 'GET') {
      const [, channelId, guildId] = exceptionsMatch;
      const exceptions = this.getChannelExceptions(channelId, guildId);
      return new Response(JSON.stringify(exceptions), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/api/channel-exceptions' && request.method === 'POST') {
      const body = await request.json() as { companion_id: string; channel_id: string; guild_id: string; granted_by?: string };
      this.grantChannelException(body.companion_id, body.channel_id, body.guild_id, body.granted_by);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/api/channel-exceptions' && request.method === 'DELETE') {
      const body = await request.json() as { companion_id: string; channel_id: string; guild_id: string };
      this.revokeChannelException(body.companion_id, body.channel_id, body.guild_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // Status endpoint — includes server/channel info
    if (url.pathname === '/api/status' && request.method === 'GET') {
      const pending = this.getPending();
      const companions = this.getAllCompanions();
      const watchChannels = (this.env.WATCH_CHANNELS || '').split(',').filter(Boolean);

      // Fetch server list and channel names
      let servers: any[] = [];
      let channelDetails: any[] = [];
      try {
        const guildsResult = await discordRequest(this.env, '/users/@me/guilds');
        if (!guildsResult.error) {
          servers = (guildsResult as any[]).map((g: any) => ({
            id: g.id,
            name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp?size=64` : null,
          }));
        }
      } catch (_) {}

      // Fetch channel info for watched channels
      for (const chId of watchChannels) {
        try {
          const ch = await discordRequest(this.env, `/channels/${chId}`);
          if (!ch.error) {
            channelDetails.push({
              id: ch.id,
              name: ch.name,
              guild_id: ch.guild_id,
            });
          }
        } catch (_) {}
      }

      return new Response(JSON.stringify({
        pending_count: pending.length,
        companion_count: companions.length,
        watch_channels: channelDetails,
        servers,
      }, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return super.fetch(request);
  }

  // Store a triggered message as pending
  async handleTrigger(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        companion_id: string;
        content: string;
        author: { username: string; id?: string };
        channel_id: string;
        webhook_url?: string;
      };

      const companion = this.getCompanionById(body.companion_id);
      if (!companion) {
        return new Response(JSON.stringify({ error: `Unknown companion: ${body.companion_id}` }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      this.cleanStale();

      const command: PendingCommand = {
        id: crypto.randomUUID(),
        companion_id: body.companion_id,
        content: body.content,
        author: body.author,
        channel_id: body.channel_id,
        webhook_url: body.webhook_url,
        timestamp: Date.now(),
      };

      this.storeCommand(command);

      console.log(`Pending: ${companion.name} ← "${body.content}" from ${body.author.username}`);

      return new Response(JSON.stringify({
        success: true,
        id: command.id,
        companion: companion.name,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (error: any) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // REST endpoint for checking pending
  handleGetPending(): Response {
    const pending = this.getPending().map(cmd => ({
      id: cmd.id,
      companion_id: cmd.companion_id,
      companion_name: this.getCompanionById(cmd.companion_id)?.name,
      content: cmd.content,
      author: cmd.author,
      channel_id: cmd.channel_id,
      webhook_url: cmd.webhook_url,
      age_seconds: Math.round((Date.now() - cmd.timestamp) / 1000),
    }));

    return new Response(JSON.stringify(pending, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Cron: poll Discord channels for new messages with trigger words
  async handlePoll(): Promise<Response> {
    const channels = (this.env.WATCH_CHANNELS || '').split(',').map(s => s.trim()).filter(Boolean);

    if (channels.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no WATCH_CHANNELS configured' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let totalStored = 0;

    for (const channelId of channels) {
      try {
        const cursor = this.getCursor(channelId);
        // Build Discord API URL — fetch messages after our cursor
        let endpoint = `/channels/${channelId}/messages?limit=50`;
        if (cursor) {
          endpoint += `&after=${cursor}`;
        } else {
          // First poll: just grab latest 5 to set cursor without processing old history
          endpoint = `/channels/${channelId}/messages?limit=5`;
        }

        const result = await discordRequest(this.env, endpoint);
        if (result.error) {
          console.error(`Poll error for ${channelId}: ${JSON.stringify(result)}`);
          continue;
        }

        const messages = result as any[];
        if (!messages || messages.length === 0) continue;

        // Messages come newest-first from Discord API, reverse to process chronologically
        messages.reverse();

        // Update cursor to the newest message ID
        const newestId = messages[messages.length - 1].id;
        this.setCursor(channelId, newestId);

        // If this was our first poll (no cursor), skip processing to avoid responding to old messages
        if (!cursor) {
          console.log(`Channel ${channelId}: cursor initialized at ${newestId}`);
          continue;
        }

        // Check each message for trigger words or replies to companion messages
        for (const msg of messages) {
          // Skip bot messages and webhooks
          if (msg.author?.bot || msg.webhook_id) continue;
          // Skip empty messages
          if (!msg.content) continue;

          const triggerResult = this.findTriggeredCompanionDynamic(msg.content);
          let triggered = triggerResult.matched;

          if (triggerResult.debug.length > 0) {
            console.log(`Cron: trigger debug — msg=${msg.id} content="${msg.content.substring(0, 80)}" matches=[${triggerResult.debug.join(',')}]`);
          }

          // Reply detection: if no trigger words matched but message is a reply, check if it's replying to a companion
          if (triggered.length === 0 && msg.message_reference?.message_id) {
            const repliedCompanionId = this.getCompanionByMessageId(msg.message_reference.message_id);
            if (repliedCompanionId) {
              const companion = this.getCompanionById(repliedCompanionId);
              if (companion) {
                triggered = [companion];
                console.log(`Cron: reply detection — ${companion.name} triggered by reply from ${msg.author?.username}`);
              }
            }
          }

          if (triggered.length === 0) continue;

          // Get or create webhook for this channel
          const channelWebhookUrl = await this.getOrCreateWebhook(channelId);

          // Resolve guild for entity permission checks
          let guildIdForEntity: string | null = null;
          try {
            guildIdForEntity = await this.resolveGuildId(channelId);
          } catch (_) {}

          // Store a pending command for each triggered companion
          for (const companion of triggered) {
            // Check admin-restricted channels (highest priority)
            if (guildIdForEntity && this.isChannelRestricted(channelId, guildIdForEntity)) {
              if (!this.hasChannelException(companion.id, channelId, guildIdForEntity)) {
                console.log(`Cron: ${companion.name} blocked — channel ${channelId} is restricted`);
                continue;
              }
            }

            // Check channel permissions (legacy blocklist)
            if (this.isChannelBlocked(companion.id, channelId)) {
              console.log(`Cron: ${companion.name} blocked in channel ${channelId}, skipping`);
              continue;
            }

            // Check entity_servers permissions (new entity model)
            if (guildIdForEntity) {
              const entityConfig = this.getEntityServerConfig(companion.id, guildIdForEntity);
              if (entityConfig) {
                // Check active status
                if (!entityConfig.active) {
                  console.log(`Cron: ${companion.name} deactivated in guild ${guildIdForEntity}, skipping`);
                  continue;
                }
                // Check watch_channels scope
                if (entityConfig.watch_channels && !entityConfig.watch_channels.includes(channelId)) {
                  console.log(`Cron: ${companion.name} not watching channel ${channelId}, skipping`);
                  continue;
                }
                // Check blocked channels
                if (entityConfig.blocked_channels && entityConfig.blocked_channels.includes(channelId)) {
                  console.log(`Cron: ${companion.name} entity-blocked in channel ${channelId}, skipping`);
                  continue;
                }
              }
            }

            this.cleanStale();

            const authorName = msg.author?.global_name || msg.author?.username || 'unknown';
            const command: PendingCommand = {
              id: crypto.randomUUID(),
              companion_id: companion.id,
              content: msg.content,
              author: {
                username: authorName,
                id: msg.author?.id,
              },
              channel_id: channelId,
              webhook_url: channelWebhookUrl || undefined,
              timestamp: Date.now(),
            };

            this.storeCommand(command);
            this.logActivity(companion.id, 'triggered', channelId, msg.content, authorName);

            // DM notification to companion owner (best-effort, non-blocking)
            this.notifyOwnerDM(companion, channelId, msg.content, authorName).catch(() => {});

            totalStored++;
            console.log(`Cron: ${companion.name} triggered by "${msg.content}" from ${authorName}`);
          }
        }
      } catch (err: any) {
        console.error(`Poll exception for ${channelId}: ${err.message}`);
      }
    }

    return new Response(JSON.stringify({ polled: channels.length, stored: totalStored }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async init() {
    // ============ PENDING COMMAND TOOLS ============

    // Helper: fetch from the 'default' DO instance (where cron stores pending commands)
    const getDefaultStub = () => {
      const id = this.env.COMPANION_BOT.idFromName('default');
      return this.env.COMPANION_BOT.get(id);
    };

    // ============ ENTITY TOOL WRAPPER ============
    // Extends any tool with optional entity_id param for permission checks + audit logging.
    // When entity_id is omitted, behavior is unchanged (full bot-level access).
    // When entity_id is provided, checks entity_servers permissions and logs to entity_action_log.
    const entityTool = (
      name: string,
      description: string,
      schema: Record<string, any>,
      handler: (params: any) => Promise<any>,
      options?: { channelParam?: string; guildParam?: string }
    ) => {
      const extendedSchema = {
        ...schema,
        entity_id: z.string().optional().describe("Optional companion/entity ID for permission scoping and audit logging"),
      };

      this.server.tool(name, description, extendedSchema, async (params: any) => {
        const entityId = params.entity_id;

        // No entity_id = full bot-level access, no checks, no logging
        if (!entityId) {
          return handler(params);
        }

        // Auto-detect guild/channel params from schema if not explicitly set
        const defaultStub = getDefaultStub();
        let guildId: string | null = null;
        const channelParamName = options?.channelParam ||
          ['channelId', 'forumChannelId', 'threadId', 'categoryId'].find(p => p in schema && params[p]);
        const guildParamName = options?.guildParam ||
          ['guildId'].find(p => p in schema && params[p]);
        const channelId = channelParamName ? params[channelParamName] : null;

        if (guildParamName && params[guildParamName]) {
          guildId = params[guildParamName];
        } else if (channelId) {
          // Resolve guild from channel via default DO
          const guildRes = await defaultStub.fetch(new Request(`https://internal/api/resolve-guild/${channelId}`));
          const guildData = await guildRes.json() as any;
          guildId = guildData.guild_id || null;
        }

        // Check permissions via default DO
        const checkRes = await defaultStub.fetch(new Request('https://internal/api/entity-check-permission', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ entity_id: entityId, tool_name: name, guild_id: guildId, channel_id: channelId }),
        }));
        const perm = await checkRes.json() as any;

        if (!perm.allowed) {
          // Log denied action
          await defaultStub.fetch(new Request('https://internal/api/entity-log-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId, guild_id: guildId, channel_id: channelId, tool_name: name, summary: 'Permission denied', success: false, error_message: perm.reason }),
          }));
          return { content: [{ type: "text" as const, text: `Permission denied: ${perm.reason}` }] };
        }

        // Execute the original handler
        try {
          const result = await handler(params);
          // Log successful action
          await defaultStub.fetch(new Request('https://internal/api/entity-log-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId, guild_id: guildId, channel_id: channelId, tool_name: name, summary: null, success: true }),
          }));
          return result;
        } catch (err: any) {
          // Log failed action
          await defaultStub.fetch(new Request('https://internal/api/entity-log-action', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ entity_id: entityId, guild_id: guildId, channel_id: channelId, tool_name: name, summary: 'Handler error', success: false, error_message: err.message }),
          }));
          throw err;
        }
      });
    };


    // ============ PENDING COMMANDS (2 actions) ============

    this.server.tool(
      "pending_commands",
      "Manage pending Discord messages waiting for companion responses. Actions: get (check for new messages), respond (reply to a pending message via webhook).",
      {
        action: z.enum(["get", "respond"]).describe("The action to perform"),
        entity_id: z.string().optional().describe("Optional companion/entity ID. For 'get': filters pending commands. For 'respond': validates it matches the command's companion_id."),
        requestId: z.string().optional().describe("(respond) The request ID from pending_commands get"),
        response: z.string().optional().describe("(respond) The companion's response message"),
        webhookUrl: z.string().optional().describe("(respond) Discord webhook URL override"),
        embeds: z.array(z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          color: z.number().optional(),
          fields: z.array(z.object({
            name: z.string(),
            value: z.string(),
            inline: z.boolean().optional(),
          })).optional(),
          footer: z.object({ text: z.string() }).optional(),
          thumbnail: z.object({ url: z.string() }).optional(),
          image: z.object({ url: z.string() }).optional(),
        })).optional().describe("(respond) Optional Discord embeds to include with the response"),
      },
      async ({ action, entity_id, requestId, response, webhookUrl, embeds }: any) => {
        const stub = getDefaultStub();

        switch (action) {
          case "get": {
            const res = await stub.fetch(new Request('https://internal/pending'));
            let pending = await res.json() as any[];
            if (!pending || pending.length === 0) {
              return { content: [{ type: "text" as const, text: "No pending messages." }] };
            }
            if (entity_id) {
              pending = pending.filter((cmd: any) => cmd.companion_id === entity_id);
              if (pending.length === 0) {
                return { content: [{ type: "text" as const, text: `No pending messages for entity ${entity_id}.` }] };
              }
            }
            const enriched = await Promise.all(pending.map(async (cmd: any) => {
              try {
                const rulesRes = await stub.fetch(new Request(`https://internal/api/companions/${cmd.companion_id}/rules`));
                const rulesData = await rulesRes.json() as any;
                if (rulesData.rules) cmd.companion_rules = rulesData.rules;
              } catch (_) {}
              return cmd;
            }));
            return { content: [{ type: "text" as const, text: JSON.stringify(enriched, null, 2) }] };
          }

          case "respond": {
            if (!requestId || !response) {
              return { content: [{ type: "text" as const, text: "requestId and response are required for 'respond' action" }] };
            }
            const pendingRes = await stub.fetch(new Request('https://internal/pending'));
            const allPending = await pendingRes.json() as any[];
            const command = allPending.find((cmd: any) => cmd.id === requestId);
            if (!command) {
              return { content: [{ type: "text" as const, text: `No pending command with ID: ${requestId}` }] };
            }
            if (entity_id && entity_id !== command.companion_id) {
              return { content: [{ type: "text" as const, text: `Entity mismatch: ${entity_id} cannot respond as ${command.companion_id}` }] };
            }
            const companionRes = await stub.fetch(new Request(`https://internal/api/companions/${command.companion_id}`));
            const companion = companionRes.ok ? await companionRes.json() as Companion : null;
            if (!companion) {
              return { content: [{ type: "text" as const, text: `Unknown companion: ${command.companion_id}` }] };
            }
            // Check restricted channels before responding
            try {
              const guildRes = await stub.fetch(new Request(`https://internal/api/resolve-guild/${command.channel_id}`));
              const guildData = await guildRes.json() as any;
              if (guildData.guild_id) {
                const restrictedRes = await stub.fetch(new Request(`https://internal/api/channel-restricted/${command.channel_id}/${guildData.guild_id}?companion_id=${command.companion_id}`));
                const restrictedData = await restrictedRes.json() as any;
                if (restrictedData.restricted && !restrictedData.has_exception) {
                  return { content: [{ type: "text" as const, text: `Channel is restricted — admin exception required for ${command.companion_id}` }] };
                }
              }
            } catch (_) {}
            const targetWebhookUrl = webhookUrl || command.webhook_url;
            let sendResult: string;
            const sentMessageIds: string[] = [];
            let sentWebhookUrl: string | undefined;
            if (targetWebhookUrl) {
              const chunks = splitMessage(response);
              for (let i = 0; i < chunks.length; i++) {
                const isLast = i === chunks.length - 1;
                const webhookPayload: any = {
                  content: chunks[i],
                  username: companion.name,
                  avatar_url: companion.avatar_url,
                };
                if (isLast && embeds) webhookPayload.embeds = embeds;
                const res = await fetch(`${targetWebhookUrl}?wait=true`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(webhookPayload),
                });
                if (!res.ok) {
                  const errText = await res.text();
                  return { content: [{ type: "text" as const, text: `Webhook failed on chunk ${i + 1}/${chunks.length} (${res.status}): ${errText}` }] };
                }
                const msgData = await res.json() as any;
                sentMessageIds.push(msgData.id);
              }
              sentWebhookUrl = targetWebhookUrl;
              sendResult = `via webhook as ${companion.name} (${chunks.length} message${chunks.length > 1 ? 's' : ''}, ids: ${sentMessageIds.join(', ')})`;
            } else {
              const chunks = splitMessage(`**${companion.name}:** ${response}`);
              for (const chunk of chunks) {
                const result = await discordRequest(this.env, `/channels/${command.channel_id}/messages`, {
                  method: 'POST',
                  body: JSON.stringify({ content: chunk }),
                });
                if (result.error) {
                  return { content: [{ type: "text" as const, text: `Discord API error: ${JSON.stringify(result)}` }] };
                }
                sentMessageIds.push(result.id);
              }
              sendResult = `via API to channel ${command.channel_id} (${chunks.length} message${chunks.length > 1 ? 's' : ''}, ids: ${sentMessageIds.join(', ')})`;
            }
            await stub.fetch(new Request('https://internal/api/log-activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                companion_id: command.companion_id,
                type: 'responded',
                channel_id: command.channel_id,
                content: response.substring(0, 200),
                author: companion.name,
                message_id: sentMessageIds[sentMessageIds.length - 1],
                webhook_url: sentWebhookUrl,
              }),
            }));
            await stub.fetch(new Request('https://internal/delete-command', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: requestId }),
            }));
            return { content: [{ type: "text" as const, text: `Response sent ${sendResult}.` }] };
          }
        }
      }
    );

    // ============ COMPANION (5 actions) ============

    this.server.tool(
      "companion",
      "Companion management and messaging. Actions: list (show all companions and rules), send (send message as companion via webhook), edit_message (edit a companion's webhook message), delete_message (delete a companion's webhook message), introduce (post rich embed introduction card).",
      {
        action: z.enum(["list", "send", "edit_message", "delete_message", "introduce"]).describe("The action to perform"),
        entity_id: z.string().optional().describe("Optional companion/entity ID. For 'send'/'introduce': validates it matches companionId."),
        content: z.string().optional().describe("(send) Message content"),
        companionId: z.string().optional().describe("(send/introduce) Companion ID"),
        channelId: z.string().optional().describe("(send/introduce) Channel ID to send to"),
        webhookUrl: z.string().optional().describe("(send/edit_message/delete_message) Webhook URL override"),
        messageId: z.string().optional().describe("(edit_message/delete_message) The Discord message ID"),
        newContent: z.string().optional().describe("(edit_message) New message content"),
        embeds: z.array(z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          color: z.number().optional(),
          fields: z.array(z.object({
            name: z.string(),
            value: z.string(),
            inline: z.boolean().optional(),
          })).optional(),
          footer: z.object({ text: z.string() }).optional(),
          thumbnail: z.object({ url: z.string() }).optional(),
          image: z.object({ url: z.string() }).optional(),
        })).optional().describe("(send) Optional Discord embeds to include with the message"),
      },
      async ({ action, entity_id, content, companionId, channelId, webhookUrl, messageId, newContent, embeds }: any) => {
        const stub = getDefaultStub();

        switch (action) {
          case "list": {
            const res = await stub.fetch(new Request('https://internal/api/companions'));
            const companions = await res.json() as Companion[];
            const list = await Promise.all(companions.map(async c => {
              const rulesRes = await stub.fetch(new Request(`https://internal/api/companions/${c.id}/rules`));
              const rulesData = await rulesRes.json() as any;
              return { id: c.id, name: c.name, triggers: c.triggers, human_name: c.human_name, rules: rulesData.rules || null };
            }));
            return { content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }] };
          }

          case "send": {
            if (!content || !companionId) {
              return { content: [{ type: "text" as const, text: "content and companionId are required for 'send' action" }] };
            }
            if (entity_id && entity_id !== companionId) {
              return { content: [{ type: "text" as const, text: `Entity mismatch: ${entity_id} cannot send as ${companionId}` }] };
            }
            const cRes = await stub.fetch(new Request(`https://internal/api/companions/${companionId}`));
            const companion = cRes.ok ? await cRes.json() as Companion : null;
            if (!companion) {
              return { content: [{ type: "text" as const, text: `Unknown companion: ${companionId}` }] };
            }
            let targetUrl = webhookUrl;
            if (!targetUrl && channelId) {
              const resolved = await stub.fetch(new Request(`https://internal/api/channel-webhook/${channelId}`));
              if (resolved.ok) {
                const data = await resolved.json() as any;
                targetUrl = data.webhook_url;
              }
            }
            if (!targetUrl) targetUrl = this.env.WEBHOOK_URL;
            if (!targetUrl) {
              return { content: [{ type: "text" as const, text: "No webhook URL available. Provide channelId or webhookUrl." }] };
            }
            // Check restricted channels for companion sends
            if (channelId) {
              try {
                const guildRes = await stub.fetch(new Request(`https://internal/api/resolve-guild/${channelId}`));
                const guildData = await guildRes.json() as any;
                if (guildData.guild_id) {
                  const restrictedRes = await stub.fetch(new Request(`https://internal/api/channel-restricted/${channelId}/${guildData.guild_id}?companion_id=${companionId}`));
                  const restrictedData = await restrictedRes.json() as any;
                  if (restrictedData.restricted && !restrictedData.has_exception) {
                    return { content: [{ type: "text" as const, text: `Channel is restricted — admin exception required for ${companionId}` }] };
                  }
                }
              } catch (_) {}
            }
            const chunks = splitMessage(content);
            const sentMessageIds: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
              const isLast = i === chunks.length - 1;
              const webhookPayload: any = {
                content: chunks[i],
                username: companion.name,
                avatar_url: companion.avatar_url,
              };
              if (isLast && embeds) webhookPayload.embeds = embeds;
              const res = await fetch(`${targetUrl}?wait=true`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(webhookPayload),
              });
              if (!res.ok) {
                const errText = await res.text();
                return { content: [{ type: "text" as const, text: `Failed on chunk ${i + 1}/${chunks.length}: ${res.status} ${errText}` }] };
              }
              const msgData = await res.json() as any;
              sentMessageIds.push(msgData.id);
            }
            await stub.fetch(new Request('https://internal/api/log-activity', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ companion_id: companionId, type: 'sent', content: content.substring(0, 200), author: companion.name, message_id: sentMessageIds[sentMessageIds.length - 1], webhook_url: targetUrl }),
            }));
            return { content: [{ type: "text" as const, text: `Sent as ${companion.name} (${chunks.length} message${chunks.length > 1 ? 's' : ''}, ids: ${sentMessageIds.join(', ')})` }] };
          }

          case "edit_message": {
            if (!messageId || !newContent) {
              return { content: [{ type: "text" as const, text: "messageId and newContent are required for 'edit_message' action" }] };
            }
            const targetUrl = webhookUrl || this.env.WEBHOOK_URL;
            if (!targetUrl) {
              return { content: [{ type: "text" as const, text: "No webhook URL provided or configured" }] };
            }
            const res = await fetch(`${targetUrl}/messages/${messageId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ content: newContent }),
            });
            if (!res.ok) {
              const errText = await res.text();
              return { content: [{ type: "text" as const, text: `Edit failed (${res.status}): ${errText}` }] };
            }
            return { content: [{ type: "text" as const, text: `Message ${messageId} edited.` }] };
          }

          case "delete_message": {
            if (!messageId) {
              return { content: [{ type: "text" as const, text: "messageId is required for 'delete_message' action" }] };
            }
            const targetUrl = webhookUrl || this.env.WEBHOOK_URL;
            if (!targetUrl) {
              return { content: [{ type: "text" as const, text: "No webhook URL provided or configured" }] };
            }
            const res = await fetch(`${targetUrl}/messages/${messageId}`, { method: 'DELETE' });
            if (!res.ok) {
              const errText = await res.text();
              return { content: [{ type: "text" as const, text: `Delete failed (${res.status}): ${errText}` }] };
            }
            return { content: [{ type: "text" as const, text: `Message ${messageId} deleted.` }] };
          }

          case "introduce": {
            if (!companionId || !channelId) {
              return { content: [{ type: "text" as const, text: "companionId and channelId are required for 'introduce' action" }] };
            }
            if (entity_id && entity_id !== companionId) {
              return { content: [{ type: "text" as const, text: `Entity mismatch: ${entity_id} cannot introduce ${companionId}` }] };
            }
            const defaultStub = this.getDefaultStub();
            const resp = await defaultStub.fetch(new Request('http://internal/api/companions'));
            const companions = await resp.json() as any[];
            const companion = companions.find((c: any) => c.id === companionId);
            if (!companion) {
              return { content: [{ type: "text", text: `Unknown companion: ${companionId}` }] };
            }
            const introWebhookUrl = await this.getOrCreateWebhookViaDefault(channelId);
            if (!introWebhookUrl) {
              return { content: [{ type: "text", text: `Could not get webhook for channel ${channelId}` }] };
            }
            const embed = {
              title: companion.name,
              description: companion.human_info || 'AI Companion',
              color: 0xE91E8C,
              thumbnail: companion.avatar_url ? { url: companion.avatar_url } : undefined,
              fields: [
                { name: 'Triggers', value: (companion.triggers || []).map((t: string) => `\`${t}\``).join(', '), inline: true },
                { name: 'Human', value: companion.human_name || 'Unknown', inline: true },
              ],
              footer: { text: 'Discord Resonance — One bot, unlimited companions' },
            };
            const introRes = await fetch(`${introWebhookUrl}?wait=true`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ username: companion.name, avatar_url: companion.avatar_url, embeds: [embed] }),
            });
            if (!introRes.ok) {
              return { content: [{ type: "text", text: `Failed to send intro: ${introRes.status}` }] };
            }
            return { content: [{ type: "text", text: `Introduction card posted for ${companion.name} in channel ${channelId}` }] };
          }
        }
      }
    );

    // ============ DISCORD SERVER (2 actions) ============

    entityTool(
      "discord_server",
      "Discord server operations. Actions: list (list all servers the bot is in), get_info (detailed server info with channels and members).",
      {
        action: z.enum(["list", "get_info"]).describe("The action to perform"),
        guildId: z.string().optional().describe("(get_info) The Discord server/guild ID"),
      },
      async ({ action, guildId }: any) => {
        switch (action) {
          case "list": {
            const result = await discordRequest(this.env, '/users/@me/guilds');
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            const guilds = (result as any[]).map(g => ({
              id: g.id, name: g.name,
              icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp` : null,
            }));
            return { content: [{ type: "text", text: JSON.stringify(guilds, null, 2) }] };
          }

          case "get_info": {
            if (!guildId) return { content: [{ type: "text", text: "guildId is required for 'get_info'" }] };
            const [guild, channels] = await Promise.all([
              discordRequest(this.env, `/guilds/${guildId}?with_counts=true`),
              discordRequest(this.env, `/guilds/${guildId}/channels`)
            ]);
            if (guild.error) {
              return { content: [{ type: "text", text: JSON.stringify(guild) }] };
            }
            const channelTypes: Record<number, string> = {
              0: 'GuildText', 2: 'GuildVoice', 4: 'GuildCategory',
              5: 'GuildAnnouncement', 13: 'GuildStageVoice', 15: 'GuildForum'
            };
            const channelList = Array.isArray(channels) ? channels : [];
            const channelDetails = channelList.map((c: any) => ({
              id: c.id, name: c.name, type: channelTypes[c.type] || c.type,
              categoryId: c.parent_id, position: c.position, topic: c.topic || null
            }));
            const countByType = (type: number) => channelList.filter((c: any) => c.type === type).length;
            const guildInfo = {
              id: guild.id, name: guild.name, description: guild.description,
              icon: guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.webp` : null,
              owner: guild.owner_id,
              createdAt: new Date(Number(BigInt(guild.id) >> 22n) + 1420070400000).toISOString(),
              memberCount: guild.approximate_member_count,
              channels: {
                count: { text: countByType(0), voice: countByType(2), category: countByType(4), forum: countByType(15), announcement: countByType(5), stage: countByType(13), total: channelList.length },
                details: {
                  text: channelDetails.filter((c: any) => c.type === 'GuildText'),
                  voice: channelDetails.filter((c: any) => c.type === 'GuildVoice'),
                  category: channelDetails.filter((c: any) => c.type === 'GuildCategory'),
                  forum: channelDetails.filter((c: any) => c.type === 'GuildForum'),
                  announcement: channelDetails.filter((c: any) => c.type === 'GuildAnnouncement'),
                  stage: channelDetails.filter((c: any) => c.type === 'GuildStageVoice'),
                  all: channelDetails
                }
              },
              features: guild.features,
              premium: { tier: guild.premium_tier, subscriptions: guild.premium_subscription_count }
            };
            return { content: [{ type: "text", text: JSON.stringify(guildInfo, null, 2) }] };
          }
        }
      }
    );

    // ============ DISCORD MESSAGE (8 actions) ============

    entityTool(
      "discord_message",
      "Discord message operations. Actions: read (fetch messages from channel), send (send as bot), edit (edit bot message), delete (delete message), get (get single message details), search (search messages in server), dm (send direct message), poll (create poll).",
      {
        action: z.enum(["read", "send", "edit", "delete", "get", "search", "dm", "poll"]).describe("The action to perform"),
        channelId: z.string().optional().describe("(read/send/edit/delete/get/poll) The channel ID"),
        messageId: z.string().optional().describe("(edit/delete/get) The message ID"),
        message: z.string().optional().describe("(send/dm) The message content"),
        newContent: z.string().optional().describe("(edit) The new message content"),
        replyToMessageId: z.string().optional().describe("(send) Message ID to reply to"),
        limit: z.number().optional().describe("(read/search) Max messages to return"),
        guildId: z.string().optional().describe("(search) The server ID to search in"),
        content: z.string().optional().describe("(search) Search for messages containing text"),
        authorId: z.string().optional().describe("(search) Filter by author ID"),
        userId: z.string().optional().describe("(dm) The Discord user ID to DM"),
        question: z.string().optional().describe("(poll) The poll question"),
        answers: z.array(z.string()).optional().describe("(poll) Poll answer options (2-10)"),
        durationHours: z.number().optional().describe("(poll) Poll duration in hours (default 24)"),
        allowMultiselect: z.boolean().optional().describe("(poll) Allow multiple selections"),
      },
      async ({ action, channelId, messageId, message, newContent, replyToMessageId, limit, guildId, content, authorId, userId, question, answers, durationHours, allowMultiselect }: any) => {
        switch (action) {
          case "read": {
            if (!channelId) return { content: [{ type: "text", text: "channelId is required for 'read'" }] };
            const messages = await discordRequest(this.env, `/channels/${channelId}/messages?limit=${limit || 50}`);
            if (messages.error) {
              return { content: [{ type: "text", text: JSON.stringify(messages) }] };
            }
            const formatted = (messages as any[]).map(msg => ({
              id: msg.id, content: msg.content,
              author: { id: msg.author.id, username: msg.author.username, bot: msg.author.bot || false },
              timestamp: msg.timestamp,
              attachments: msg.attachments?.length || 0,
              embeds: msg.embeds?.length || 0,
              replyTo: msg.message_reference?.message_id || null
            })).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            return { content: [{ type: "text", text: JSON.stringify({ channelId, messageCount: formatted.length, messages: formatted }, null, 2) }] };
          }

          case "send": {
            if (!channelId || !message) return { content: [{ type: "text", text: "channelId and message are required for 'send'" }] };
            const body: any = { content: message };
            if (replyToMessageId) {
              body.message_reference = { message_id: replyToMessageId };
            }
            const result = await discordRequest(this.env, `/channels/${channelId}/messages`, {
              method: 'POST', body: JSON.stringify(body)
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            const response = replyToMessageId
              ? `Message sent to channel ${channelId} as reply to ${replyToMessageId}`
              : `Message sent to channel ${channelId}`;
            return { content: [{ type: "text", text: response }] };
          }

          case "edit": {
            if (!channelId || !messageId || !newContent) return { content: [{ type: "text", text: "channelId, messageId, and newContent are required for 'edit'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}`, {
              method: 'PATCH', body: JSON.stringify({ content: newContent })
            });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to edit message: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Message ${messageId} edited` }] };
          }

          case "delete": {
            if (!channelId || !messageId) return { content: [{ type: "text", text: "channelId and messageId are required for 'delete'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Deleted message ${messageId}` }] };
          }

          case "get": {
            if (!channelId || !messageId) return { content: [{ type: "text", text: "channelId and messageId are required for 'get'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}`);
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to get message: ${JSON.stringify(result)}` }] };
            }
            const msg = result as any;
            const info = {
              id: msg.id, content: msg.content,
              author: { id: msg.author?.id, username: msg.author?.username, bot: msg.author?.bot },
              timestamp: msg.timestamp, edited_timestamp: msg.edited_timestamp,
              attachments: (msg.attachments || []).map((a: any) => ({
                id: a.id, filename: a.filename, url: a.url, size: a.size, content_type: a.content_type,
              })),
              embeds: msg.embeds?.length || 0,
              reactions: (msg.reactions || []).map((r: any) => ({ emoji: r.emoji?.name, count: r.count })),
              pinned: msg.pinned,
              reply_to: msg.message_reference?.message_id,
            };
            return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
          }

          case "search": {
            if (!guildId) return { content: [{ type: "text", text: "guildId is required for 'search'" }] };
            const params = new URLSearchParams();
            if (content) params.append('content', content);
            if (authorId) params.append('author_id', authorId);
            if (channelId) params.append('channel_id', channelId);
            params.append('limit', String(limit || 25));
            const result = await discordRequest(this.env, `/guilds/${guildId}/messages/search?${params.toString()}`);
            return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
          }

          case "dm": {
            if (!userId || !message) return { content: [{ type: "text", text: "userId and message are required for 'dm'" }] };
            const dm = await discordRequest(this.env, `/users/@me/channels`, {
              method: 'POST', body: JSON.stringify({ recipient_id: userId })
            });
            if (dm.error) {
              return { content: [{ type: "text", text: `Failed to open DM: ${JSON.stringify(dm)}` }] };
            }
            const result = await discordRequest(this.env, `/channels/${dm.id}/messages`, {
              method: 'POST', body: JSON.stringify({ content: message })
            });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to send DM: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `DM sent to user ${userId}` }] };
          }

          case "poll": {
            if (!channelId || !question || !answers) return { content: [{ type: "text", text: "channelId, question, and answers are required for 'poll'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}/messages`, {
              method: 'POST',
              body: JSON.stringify({
                poll: {
                  question: { text: question },
                  answers: answers.map((a: string) => ({ poll_media: { text: a } })),
                  duration: durationHours || 24,
                  allow_multiselect: allowMultiselect || false,
                }
              })
            });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to create poll: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Poll created in channel ${channelId}: "${question}" with ${answers.length} options` }] };
          }
        }
      }
    );

    // ============ DISCORD REACTION (3 actions) ============

    entityTool(
      "discord_reaction",
      "Discord reaction operations. Actions: add (add emoji reaction), add_multiple (add multiple reactions), remove (remove reaction).",
      {
        action: z.enum(["add", "add_multiple", "remove"]).describe("The action to perform"),
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID"),
        emoji: z.string().optional().describe("(add/remove) The emoji to react with"),
        emojis: z.array(z.string()).optional().describe("(add_multiple) Array of emojis"),
        userId: z.string().optional().describe("(remove) User ID (omit for self)"),
      },
      async ({ action, channelId, messageId, emoji, emojis, userId }: any) => {
        switch (action) {
          case "add": {
            if (!emoji) return { content: [{ type: "text", text: "emoji is required for 'add'" }] };
            const encoded = encodeURIComponent(emoji);
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, { method: 'PUT' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Added reaction ${emoji} to message ${messageId}` }] };
          }

          case "add_multiple": {
            if (!emojis) return { content: [{ type: "text", text: "emojis array is required for 'add_multiple'" }] };
            const results = [];
            for (const e of emojis) {
              const encoded = encodeURIComponent(e);
              const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, { method: 'PUT' });
              results.push({ emoji: e, success: !result.error });
              await new Promise(r => setTimeout(r, 300));
            }
            return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
          }

          case "remove": {
            if (!emoji) return { content: [{ type: "text", text: "emoji is required for 'remove'" }] };
            const encoded = encodeURIComponent(emoji);
            const target = userId || '@me';
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/${target}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Removed reaction ${emoji} from message ${messageId}` }] };
          }
        }
      }
    );

    // ============ DISCORD CHANNEL (2 actions) ============

    entityTool(
      "discord_channel",
      "Discord channel operations. Actions: create (create text channel), delete (delete channel).",
      {
        action: z.enum(["create", "delete"]).describe("The action to perform"),
        guildId: z.string().optional().describe("(create) The server ID"),
        channelName: z.string().optional().describe("(create) Name for the new channel"),
        topic: z.string().optional().describe("(create) Channel topic"),
        channelId: z.string().optional().describe("(delete) The channel ID to delete"),
      },
      async ({ action, guildId, channelName, topic, channelId }: any) => {
        switch (action) {
          case "create": {
            if (!guildId || !channelName) return { content: [{ type: "text", text: "guildId and channelName are required for 'create'" }] };
            const body: any = { name: channelName, type: 0 };
            if (topic) body.topic = topic;
            const result = await discordRequest(this.env, `/guilds/${guildId}/channels`, {
              method: 'POST', body: JSON.stringify(body)
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Created text channel "${channelName}" with ID: ${result.id}` }] };
          }

          case "delete": {
            if (!channelId) return { content: [{ type: "text", text: "channelId is required for 'delete'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Deleted channel ${channelId}` }] };
          }
        }
      }
    );

    // ============ DISCORD CATEGORY (3 actions) ============

    entityTool(
      "discord_category",
      "Discord category operations. Actions: create (create category), edit (edit category), delete (delete category).",
      {
        action: z.enum(["create", "edit", "delete"]).describe("The action to perform"),
        guildId: z.string().optional().describe("(create) The server ID"),
        categoryId: z.string().optional().describe("(edit/delete) The category ID"),
        name: z.string().optional().describe("(create/edit) Category name"),
        position: z.number().optional().describe("(create/edit) Position in channel list"),
      },
      async ({ action, guildId, categoryId, name, position }: any) => {
        switch (action) {
          case "create": {
            if (!guildId || !name) return { content: [{ type: "text", text: "guildId and name are required for 'create'" }] };
            const body: any = { name, type: 4 };
            if (position !== undefined) body.position = position;
            const result = await discordRequest(this.env, `/guilds/${guildId}/channels`, {
              method: 'POST', body: JSON.stringify(body)
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Created category "${name}" with ID: ${result.id}` }] };
          }

          case "edit": {
            if (!categoryId) return { content: [{ type: "text", text: "categoryId is required for 'edit'" }] };
            const body: any = {};
            if (name) body.name = name;
            if (position !== undefined) body.position = position;
            const result = await discordRequest(this.env, `/channels/${categoryId}`, {
              method: 'PATCH', body: JSON.stringify(body)
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Edited category ${categoryId}` }] };
          }

          case "delete": {
            if (!categoryId) return { content: [{ type: "text", text: "categoryId is required for 'delete'" }] };
            const result = await discordRequest(this.env, `/channels/${categoryId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Deleted category ${categoryId}` }] };
          }
        }
      }
    );

    // ============ DISCORD FORUM (5 actions) ============

    entityTool(
      "discord_forum",
      "Discord forum operations. Actions: list (list forum channels), create_post (create forum post), get_post (get post details), reply (reply to post), delete_post (delete post).",
      {
        action: z.enum(["list", "create_post", "get_post", "reply", "delete_post"]).describe("The action to perform"),
        guildId: z.string().optional().describe("(list) The server ID"),
        forumChannelId: z.string().optional().describe("(create_post) The forum channel ID"),
        threadId: z.string().optional().describe("(get_post/reply/delete_post) The thread/post ID"),
        title: z.string().optional().describe("(create_post) Post title"),
        content: z.string().optional().describe("(create_post) Post content"),
        message: z.string().optional().describe("(reply) Reply content"),
      },
      async ({ action, guildId, forumChannelId, threadId, title, content, message }: any) => {
        switch (action) {
          case "list": {
            if (!guildId) return { content: [{ type: "text", text: "guildId is required for 'list'" }] };
            const channels = await discordRequest(this.env, `/guilds/${guildId}/channels`);
            if (channels.error) {
              return { content: [{ type: "text", text: JSON.stringify(channels) }] };
            }
            const forums = (channels as any[]).filter(c => c.type === 15).map(c => ({
              id: c.id, name: c.name, topic: c.topic
            }));
            return { content: [{ type: "text", text: JSON.stringify(forums, null, 2) }] };
          }

          case "create_post": {
            if (!forumChannelId || !title || !content) return { content: [{ type: "text", text: "forumChannelId, title, and content are required for 'create_post'" }] };
            const result = await discordRequest(this.env, `/channels/${forumChannelId}/threads`, {
              method: 'POST', body: JSON.stringify({ name: title, message: { content } })
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Created forum post "${title}" with ID: ${result.id}` }] };
          }

          case "get_post": {
            if (!threadId) return { content: [{ type: "text", text: "threadId is required for 'get_post'" }] };
            const [thread, messages] = await Promise.all([
              discordRequest(this.env, `/channels/${threadId}`),
              discordRequest(this.env, `/channels/${threadId}/messages?limit=50`)
            ]);
            if (thread.error) {
              return { content: [{ type: "text", text: JSON.stringify(thread) }] };
            }
            return { content: [{ type: "text", text: JSON.stringify({ thread, messages }, null, 2) }] };
          }

          case "reply": {
            if (!threadId || !message) return { content: [{ type: "text", text: "threadId and message are required for 'reply'" }] };
            const result = await discordRequest(this.env, `/channels/${threadId}/messages`, {
              method: 'POST', body: JSON.stringify({ content: message })
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Reply sent to thread ${threadId}` }] };
          }

          case "delete_post": {
            if (!threadId) return { content: [{ type: "text", text: "threadId is required for 'delete_post'" }] };
            const result = await discordRequest(this.env, `/channels/${threadId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Deleted thread ${threadId}` }] };
          }
        }
      }
    );

    // ============ DISCORD WEBHOOK (3 actions) ============

    entityTool(
      "discord_webhook",
      "Discord webhook operations. Actions: create (create webhook for channel), send (send message via webhook), delete (delete webhook).",
      {
        action: z.enum(["create", "send", "delete"]).describe("The action to perform"),
        channelId: z.string().optional().describe("(create) The channel ID"),
        name: z.string().optional().describe("(create) Webhook name"),
        webhookId: z.string().optional().describe("(send/delete) Webhook ID"),
        webhookToken: z.string().optional().describe("(send/delete) Webhook token"),
        content: z.string().optional().describe("(send) Message content"),
        username: z.string().optional().describe("(send) Override username"),
        avatarURL: z.string().optional().describe("(send) Override avatar URL"),
      },
      async ({ action, channelId, name, webhookId, webhookToken, content, username, avatarURL }: any) => {
        switch (action) {
          case "create": {
            if (!channelId || !name) return { content: [{ type: "text", text: "channelId and name are required for 'create'" }] };
            const result = await discordRequest(this.env, `/channels/${channelId}/webhooks`, {
              method: 'POST', body: JSON.stringify({ name })
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: JSON.stringify({ id: result.id, token: result.token, name: result.name }, null, 2) }] };
          }

          case "send": {
            if (!webhookId || !webhookToken || !content) return { content: [{ type: "text", text: "webhookId, webhookToken, and content are required for 'send'" }] };
            const body: any = { content };
            if (username) body.username = username;
            if (avatarURL) body.avatar_url = avatarURL;
            const response = await fetch(`${DISCORD_API}/webhooks/${webhookId}/${webhookToken}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            });
            if (!response.ok) {
              return { content: [{ type: "text", text: `Webhook error: ${response.status}` }] };
            }
            return { content: [{ type: "text", text: "Webhook message sent" }] };
          }

          case "delete": {
            if (!webhookId) return { content: [{ type: "text", text: "webhookId is required for 'delete'" }] };
            const endpoint = webhookToken
              ? `/webhooks/${webhookId}/${webhookToken}`
              : `/webhooks/${webhookId}`;
            const result = await discordRequest(this.env, endpoint, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Deleted webhook ${webhookId}` }] };
          }
        }
      }
    );

    // ============ DISCORD THREAD (2 actions) ============

    entityTool(
      "discord_thread",
      "Discord thread operations. Actions: create (create thread from message), send (send message to thread).",
      {
        action: z.enum(["create", "send"]).describe("The action to perform"),
        channelId: z.string().optional().describe("(create) The channel ID"),
        messageId: z.string().optional().describe("(create) The message ID to create thread from"),
        threadId: z.string().optional().describe("(send) The thread ID"),
        name: z.string().optional().describe("(create) Thread name"),
        message: z.string().optional().describe("(send) The message content"),
        autoArchiveDuration: z.number().optional().describe("(create) Minutes until auto-archive (60, 1440, 4320, 10080)"),
      },
      async ({ action, channelId, messageId, threadId, name, message, autoArchiveDuration }: any) => {
        switch (action) {
          case "create": {
            if (!channelId || !messageId || !name) return { content: [{ type: "text", text: "channelId, messageId, and name are required for 'create'" }] };
            const body: any = { name };
            if (autoArchiveDuration) body.auto_archive_duration = autoArchiveDuration;
            const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/threads`, {
              method: 'POST', body: JSON.stringify(body)
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Created thread "${name}" with ID: ${result.id}` }] };
          }

          case "send": {
            if (!threadId || !message) return { content: [{ type: "text", text: "threadId and message are required for 'send'" }] };
            const result = await discordRequest(this.env, `/channels/${threadId}/messages`, {
              method: 'POST', body: JSON.stringify({ content: message })
            });
            if (result.error) {
              return { content: [{ type: "text", text: JSON.stringify(result) }] };
            }
            return { content: [{ type: "text", text: `Message sent to thread ${threadId}` }] };
          }
        }
      }
    );

    // ============ DISCORD PIN (2 actions) ============

    entityTool(
      "discord_pin",
      "Discord pin operations. Actions: pin (pin a message), unpin (unpin a message).",
      {
        action: z.enum(["pin", "unpin"]).describe("The action to perform"),
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID"),
      },
      async ({ action, channelId, messageId }: any) => {
        switch (action) {
          case "pin": {
            const result = await discordRequest(this.env, `/channels/${channelId}/pins/${messageId}`, { method: 'PUT' });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to pin message: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Message ${messageId} pinned in channel ${channelId}` }] };
          }

          case "unpin": {
            const result = await discordRequest(this.env, `/channels/${channelId}/pins/${messageId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to unpin message: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Message ${messageId} unpinned` }] };
          }
        }
      }
    );

    // ============ DISCORD MODERATION (6 actions) ============

    entityTool(
      "discord_moderation",
      "Discord moderation operations. Actions: timeout (mute user), remove_timeout (unmute user), assign_role (give role), remove_role (take role), ban_server (ban a server from bot), unban_server (remove server ban).",
      {
        action: z.enum(["timeout", "remove_timeout", "assign_role", "remove_role", "ban_server", "unban_server"]).describe("The action to perform"),
        guildId: z.string().describe("The server/guild ID"),
        userId: z.string().optional().describe("(timeout/remove_timeout/assign_role/remove_role) The user ID"),
        roleId: z.string().optional().describe("(assign_role/remove_role) The role ID"),
        durationMinutes: z.number().optional().describe("(timeout) Timeout duration in minutes (max 40320)"),
        reason: z.string().optional().describe("(timeout/ban_server) Reason"),
      },
      async ({ action, guildId, userId, roleId, durationMinutes, reason }: any) => {
        switch (action) {
          case "timeout": {
            if (!userId || !durationMinutes) return { content: [{ type: "text", text: "userId and durationMinutes are required for 'timeout'" }] };
            const until = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
            const headers: Record<string, string> = {};
            if (reason) headers['X-Audit-Log-Reason'] = reason;
            const result = await discordRequest(this.env, `/guilds/${guildId}/members/${userId}`, {
              method: 'PATCH',
              body: JSON.stringify({ communication_disabled_until: until }),
              headers
            });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to timeout user: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `User ${userId} timed out for ${durationMinutes} minutes${reason ? ` (reason: ${reason})` : ''}` }] };
          }

          case "remove_timeout": {
            if (!userId) return { content: [{ type: "text", text: "userId is required for 'remove_timeout'" }] };
            const result = await discordRequest(this.env, `/guilds/${guildId}/members/${userId}`, {
              method: 'PATCH',
              body: JSON.stringify({ communication_disabled_until: null })
            });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to remove timeout: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Timeout removed for user ${userId}` }] };
          }

          case "assign_role": {
            if (!userId || !roleId) return { content: [{ type: "text", text: "userId and roleId are required for 'assign_role'" }] };
            const result = await discordRequest(this.env, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'PUT' });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to assign role: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Role ${roleId} assigned to user ${userId}` }] };
          }

          case "remove_role": {
            if (!userId || !roleId) return { content: [{ type: "text", text: "userId and roleId are required for 'remove_role'" }] };
            const result = await discordRequest(this.env, `/guilds/${guildId}/members/${userId}/roles/${roleId}`, { method: 'DELETE' });
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to remove role: ${JSON.stringify(result)}` }] };
            }
            return { content: [{ type: "text", text: `Role ${roleId} removed from user ${userId}` }] };
          }

          case "ban_server": {
            const defaultStub = this.getDefaultStub();
            const resp = await defaultStub.fetch(new Request('http://internal/api/ban-server', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ guild_id: guildId, reason }),
            }));
            const result = await resp.json() as any;
            if (result.error) {
              return { content: [{ type: "text", text: `Failed: ${result.error}` }] };
            }
            return { content: [{ type: "text", text: `Server ${guildId} banned${reason ? ` (reason: ${reason})` : ''}. Bot will auto-leave if re-invited.` }] };
          }

          case "unban_server": {
            const defaultStub = this.getDefaultStub();
            const resp = await defaultStub.fetch(new Request('http://internal/api/unban-server', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ guild_id: guildId }),
            }));
            const result = await resp.json() as any;
            return { content: [{ type: "text", text: `Server ${guildId} unbanned.` }] };
          }
        }
      }
    );

    // ============ DISCORD MEMBERS (3 actions) ============

    entityTool(
      "discord_members",
      "Discord member and role operations. Actions: list (list server members), get_user (get user details), list_roles (list server roles).",
      {
        action: z.enum(["list", "get_user", "list_roles"]).describe("The action to perform"),
        guildId: z.string().describe("The server/guild ID"),
        userId: z.string().optional().describe("(get_user) The user ID"),
        limit: z.number().optional().describe("(list) Max members to return (default 100)"),
      },
      async ({ action, guildId, userId, limit }: any) => {
        switch (action) {
          case "list": {
            const result = await discordRequest(this.env, `/guilds/${guildId}/members?limit=${limit || 100}`);
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to list members: ${JSON.stringify(result)}` }] };
            }
            const members = (result as any[]).map((m: any) => ({
              id: m.user?.id,
              username: m.user?.username,
              display_name: m.nick || m.user?.global_name || m.user?.username,
              roles: m.roles,
              joined_at: m.joined_at,
              bot: m.user?.bot || false,
            }));
            return { content: [{ type: "text", text: JSON.stringify(members, null, 2) }] };
          }

          case "get_user": {
            if (!userId) return { content: [{ type: "text", text: "userId is required for 'get_user'" }] };
            const result = await discordRequest(this.env, `/guilds/${guildId}/members/${userId}`);
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to get user info: ${JSON.stringify(result)}` }] };
            }
            const m = result as any;
            const info = {
              id: m.user?.id, username: m.user?.username, global_name: m.user?.global_name,
              nickname: m.nick,
              avatar: m.user?.avatar ? `https://cdn.discordapp.com/avatars/${m.user.id}/${m.user.avatar}.webp` : null,
              roles: m.roles, joined_at: m.joined_at, premium_since: m.premium_since,
              bot: m.user?.bot || false, timed_out_until: m.communication_disabled_until,
            };
            return { content: [{ type: "text", text: JSON.stringify(info, null, 2) }] };
          }

          case "list_roles": {
            const result = await discordRequest(this.env, `/guilds/${guildId}/roles`);
            if (result.error) {
              return { content: [{ type: "text", text: `Failed to list roles: ${JSON.stringify(result)}` }] };
            }
            const roles = (result as any[]).map((r: any) => ({
              id: r.id, name: r.name,
              color: r.color ? `#${r.color.toString(16).padStart(6, '0')}` : null,
              position: r.position, mentionable: r.mentionable, member_count: r.member_count,
            })).sort((a: any, b: any) => b.position - a.position);
            return { content: [{ type: "text", text: JSON.stringify(roles, null, 2) }] };
          }
        }
      }
    );

    // ============ ENTITY PERMISSIONS (3 actions) ============

    this.server.tool(
      "entity_permissions",
      "Manage entity/companion server permissions and audit logs. Actions: get (view permissions), set (configure permissions), get_log (view action history).",
      {
        action: z.enum(["get", "set", "get_log"]).describe("The action to perform"),
        entity_id: z.string().describe("The companion/entity ID"),
        guild_id: z.string().optional().describe("(get/set) Specific guild ID. For 'get', omit to get all server configs."),
        allowed_channels: z.array(z.string()).nullable().optional().describe("(set) Channel whitelist (null = all)"),
        blocked_channels: z.array(z.string()).nullable().optional().describe("(set) Channel blocklist (overrides allowed)"),
        allowed_tools: z.array(z.string()).nullable().optional().describe("(set) Tool whitelist (null = all)"),
        watch_channels: z.array(z.string()).nullable().optional().describe("(set) Channels for cron trigger scoping"),
        active: z.boolean().optional().describe("(set) Whether entity is active in this server"),
        limit: z.number().optional().describe("(get_log) Max entries to return (default 50)"),
      },
      async ({ action, entity_id, guild_id, allowed_channels, blocked_channels, allowed_tools, watch_channels, active, limit }: any) => {
        const defaultStub = getDefaultStub();

        switch (action) {
          case "get": {
            if (guild_id) {
              const res = await defaultStub.fetch(new Request(`https://internal/api/entity-servers/${entity_id}/${guild_id}`));
              const config = await res.json();
              return { content: [{ type: "text" as const, text: JSON.stringify(config, null, 2) }] };
            } else {
              const res = await defaultStub.fetch(new Request(`https://internal/api/entity-servers/${entity_id}`));
              const configs = await res.json();
              return { content: [{ type: "text" as const, text: JSON.stringify(configs, null, 2) }] };
            }
          }

          case "set": {
            if (!guild_id) return { content: [{ type: "text" as const, text: "guild_id is required for 'set'" }] };
            const res = await defaultStub.fetch(new Request(`https://internal/api/entity-servers/${entity_id}/${guild_id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ allowed_channels, blocked_channels, allowed_tools, watch_channels, active }),
            }));
            const config = await res.json();
            return { content: [{ type: "text" as const, text: `Permissions updated for entity ${entity_id} in guild ${guild_id}:\n${JSON.stringify(config, null, 2)}` }] };
          }

          case "get_log": {
            const res = await defaultStub.fetch(new Request(`https://internal/api/entity-log/${entity_id}?limit=${limit || 50}`));
            const log = await res.json();
            return { content: [{ type: "text" as const, text: JSON.stringify(log, null, 2) }] };
          }
        }
      }
    );
  }
}

// ========== Main Worker ==========

export default {
  // Cron trigger: poll Discord channels for trigger words
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const id = env.COMPANION_BOT.idFromName('default');
    const stub = env.COMPANION_BOT.get(id);
    const res = await stub.fetch(new Request('https://internal/poll', { method: 'POST' }));
    const result = await res.json();
    console.log(`Cron poll result: ${JSON.stringify(result)}`);
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({
        status: 'ok',
        service: 'discord-companion-bot',
        version: '1.0.0',
        companions: Object.keys(SEED_COMPANIONS),
        features: ['mcp', 'sse', 'trigger', 'webhook-dispatch', 'cron-poll', 'dashboard'],
      }, null, 2), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Dashboard (admin)
    if (url.pathname === '/dashboard') {
      const baseUrl = url.origin;
      const clientId = env.DISCORD_CLIENT_ID || '';
      return new Response(renderDashboard(baseUrl, clientId), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // Register page (public)
    if (url.pathname === '/register') {
      const baseUrl = url.origin;
      const clientId = env.DISCORD_CLIENT_ID || '';
      return new Response(renderRegisterPage(baseUrl, clientId), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
      });
    }

    // ===== OAuth2 flow =====

    if (url.pathname === '/auth/discord') {
      if (!env.DISCORD_CLIENT_ID) {
        return new Response('OAuth not configured', { status: 500 });
      }
      const redirectUri = `${url.origin}/auth/callback`;
      const state = crypto.randomUUID();
      const params = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'identify',
        state,
      });
      const authUrl = `https://discord.com/api/oauth2/authorize?${params}`;

      return new Response(null, {
        status: 302,
        headers: {
          Location: authUrl,
          'Set-Cookie': `oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`,
        },
      });
    }

    if (url.pathname === '/auth/callback') {
      const code = url.searchParams.get('code');
      if (!code || !env.DISCORD_CLIENT_ID || !env.DISCORD_CLIENT_SECRET) {
        return new Response(null, { status: 302, headers: { Location: '/dashboard?error=oauth_failed' } });
      }

      try {
        // Exchange code for access token
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.DISCORD_CLIENT_ID,
            client_secret: env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code,
            redirect_uri: `${url.origin}/auth/callback`,
          }),
        });
        if (!tokenRes.ok) {
          return new Response(null, { status: 302, headers: { Location: '/dashboard?error=token_exchange' } });
        }
        const tokenData = await tokenRes.json() as any;

        // Get user info
        const userRes = await fetch('https://discord.com/api/users/@me', {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        if (!userRes.ok) {
          return new Response(null, { status: 302, headers: { Location: '/dashboard?error=user_fetch' } });
        }
        const user = await userRes.json() as any;

        // Create session in DO
        const doId = env.COMPANION_BOT.idFromName('default');
        const stub = env.COMPANION_BOT.get(doId);
        const sessionRes = await stub.fetch(new Request('https://internal/auth/create-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: user.id,
            username: user.username,
            avatar: user.avatar,
            global_name: user.global_name,
          }),
        }));
        const { token } = await sessionRes.json() as any;

        // Redirect back to dashboard with session token (stored in localStorage by the page)
        return new Response(null, {
          status: 302,
          headers: { Location: `/dashboard?session=${token}` },
        });
      } catch (err: any) {
        return new Response(null, { status: 302, headers: { Location: `/dashboard?error=${encodeURIComponent(err.message)}` } });
      }
    }

    if (url.pathname === '/auth/me') {
      const doId = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(doId);
      const token = url.searchParams.get('token') || '';
      const adminId = env.ADMIN_DISCORD_ID || '';
      const doRes = await stub.fetch(new Request(`https://internal/auth/me?token=${token}&admin_id=${adminId}`));
      const res = new Response(doRes.body, doRes);
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }

    if (url.pathname === '/auth/logout' && request.method === 'POST') {
      const body = await request.json() as any;
      const doId = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(doId);
      await stub.fetch(new Request('https://internal/auth/delete-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: body.token }),
      }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Trigger endpoint — Vessel posts here (direct DO routing, not MCP)
    if (url.pathname === '/trigger' && request.method === 'POST') {
      const id = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(id);
      return stub.fetch(request);
    }

    // Pending commands (REST — direct DO routing, not MCP)
    if (url.pathname === '/pending' && request.method === 'GET') {
      const id = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(id);
      return stub.fetch(request);
    }

    // Avatar upload — proxy to default DO
    if (url.pathname === '/upload-avatar' && request.method === 'POST') {
      const id = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(id);
      const doRes = await stub.fetch(new Request(`https://internal/upload-avatar`, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      }));
      const res = new Response(doRes.body, doRes);
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }

    // Avatar serve — proxy to default DO
    if (url.pathname.startsWith('/avatars/')) {
      const id = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(id);
      return stub.fetch(new Request(`https://internal${url.pathname}`, { method: 'GET' }));
    }

    // API routes — proxy to default DO
    if (url.pathname.startsWith('/api/')) {
      // Auth check for write operations
      if (request.method !== 'GET') {
        let authorized = false;

        // Check Bearer token (DASHBOARD_TOKEN or MCP/API callers)
        const auth = request.headers.get('Authorization');
        if (env.DASHBOARD_TOKEN && auth === `Bearer ${env.DASHBOARD_TOKEN}`) {
          authorized = true;
        }

        // Check Discord session token
        if (!authorized) {
          const sessionToken = request.headers.get('X-Session-Token');
          if (sessionToken) {
            const doId = env.COMPANION_BOT.idFromName('default');
            const stub = env.COMPANION_BOT.get(doId);
            const valRes = await stub.fetch(new Request('https://internal/auth/validate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: sessionToken }),
            }));
            const { valid } = await valRes.json() as any;
            if (valid) authorized = true;
          }
        }

        // If no auth method is configured, allow open access (backward-compatible)
        if (!authorized && (env.DASHBOARD_TOKEN || env.DISCORD_CLIENT_ID)) {
          return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      const id = env.COMPANION_BOT.idFromName('default');
      const stub = env.COMPANION_BOT.get(id);
      const doRes = await stub.fetch(new Request(`https://internal${url.pathname}${url.search}`, {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' ? request.body : undefined,
      }));
      // Add CORS headers to the response
      const res = new Response(doRes.body, doRes);
      Object.entries(corsHeaders).forEach(([k, v]) => res.headers.set(k, v));
      return res;
    }

    // SSE endpoint
    if (url.pathname === '/sse' || url.pathname === '/sse/message') {
      return CompanionBot.serveSSE('/sse', { binding: 'COMPANION_BOT' }).fetch(request, env, ctx);
    }

    // MCP HTTP endpoint
    if (url.pathname === '/mcp') {
      // Antigravity compatibility: accept notifications without session ID
      if (request.method === 'POST' && !request.headers.get('mcp-session-id')) {
        try {
          const clone = request.clone();
          const body = await clone.json() as any;
          const messages = Array.isArray(body) ? body : [body];
          if (messages.every((m: any) => !('id' in m))) {
            return new Response(null, { status: 202 });
          }
        } catch (_) { /* fall through */ }
      }
      return CompanionBot.serve('/mcp', { binding: 'COMPANION_BOT' }).fetch(request, env, ctx);
    }

    return new Response(JSON.stringify({
      service: 'Discord Companion Bot',
      endpoints: {
        health: 'GET /',
        dashboard: 'GET /dashboard',
        register: 'GET /register',
        api: 'GET /api/companions',
        trigger: 'POST /trigger',
        pending: 'GET /pending',
        auth: 'GET /auth/discord',
        mcp: '/mcp',
        sse: '/sse',
      },
      companions: Object.values(SEED_COMPANIONS).map(c => `${c.name} (${c.triggers.join(', ')})`),
    }, null, 2), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
