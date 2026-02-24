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
import { renderDashboard } from "./dashboard";

const DISCORD_API = 'https://discord.com/api/v10';

interface Env {
  COMPANION_BOT: DurableObjectNamespace<CompanionBot>;
  DISCORD_TOKEN: string;
  WATCH_CHANNELS: string;
  WEBHOOK_URL: string;
  DASHBOARD_TOKEN?: string;
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

  getAllCompanions(): Companion[] {
    this.ensureTable();
    return this.ctx.storage.sql.exec(`SELECT * FROM companions ORDER BY created_at ASC`).toArray().map((row: any) => ({
      id: row.id,
      name: row.name,
      avatar_url: row.avatar_url,
      triggers: JSON.parse(row.triggers),
      human_name: row.human_name || undefined,
      human_info: row.human_info || undefined,
    }));
  }

  getCompanionById(id: string): Companion | undefined {
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
    };
  }

  createCompanion(data: { id: string; name: string; avatar_url: string; triggers: string[]; human_name?: string; human_info?: string }): Companion {
    this.ensureTable();
    const now = Date.now();
    this.ctx.storage.sql.exec(
      `INSERT INTO companions (id, name, avatar_url, triggers, human_name, human_info, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      data.id, data.name, data.avatar_url, JSON.stringify(data.triggers), data.human_name || null, data.human_info || null, now, now
    );
    return { ...data };
  }

  updateCompanion(id: string, data: { name?: string; avatar_url?: string; triggers?: string[]; human_name?: string; human_info?: string }): Companion | undefined {
    this.ensureTable();
    const existing = this.getCompanionById(id);
    if (!existing) return undefined;

    const updated = {
      name: data.name ?? existing.name,
      avatar_url: data.avatar_url ?? existing.avatar_url,
      triggers: data.triggers ?? existing.triggers,
      human_name: data.human_name ?? existing.human_name,
      human_info: data.human_info ?? existing.human_info,
    };

    this.ctx.storage.sql.exec(
      `UPDATE companions SET name = ?, avatar_url = ?, triggers = ?, human_name = ?, human_info = ?, updated_at = ? WHERE id = ?`,
      updated.name, updated.avatar_url, JSON.stringify(updated.triggers), updated.human_name || null, updated.human_info || null, Date.now(), id
    );

    return { id, ...updated };
  }

  deleteCompanion(id: string): boolean {
    this.ensureTable();
    const existing = this.getCompanionById(id);
    if (!existing) return false;
    this.ctx.storage.sql.exec(`DELETE FROM companions WHERE id = ?`, id);
    return true;
  }

  // Dynamic versions of companion helpers (read from SQLite)
  findTriggeredCompanionDynamic(content: string): Companion[] {
    const all = this.getAllCompanions();
    const lower = content.toLowerCase();
    const matched: Companion[] = [];
    for (const companion of all) {
      for (const trigger of companion.triggers) {
        if (lower.includes(trigger.toLowerCase())) {
          matched.push(companion);
          break;
        }
      }
    }
    return matched;
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

    // Match /api/companions/:id
    const companionMatch = url.pathname.match(/^\/api\/companions\/([^/]+)$/);

    if (companionMatch && request.method === 'GET') {
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
        const id = body.id || body.name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
        const triggers = Array.isArray(body.triggers) ? body.triggers : body.triggers.split(',').map((t: string) => t.trim());
        const companion = this.createCompanion({
          id, name: body.name, avatar_url: body.avatar_url, triggers,
          human_name: body.human_name, human_info: body.human_info,
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
    const webhookUrl = this.env.WEBHOOK_URL;

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

        // Check each message for trigger words
        for (const msg of messages) {
          // Skip bot messages and webhooks
          if (msg.author?.bot || msg.webhook_id) continue;
          // Skip empty messages
          if (!msg.content) continue;

          const triggered = this.findTriggeredCompanionDynamic(msg.content);
          if (triggered.length === 0) continue;

          // Store a pending command for each triggered companion
          for (const companion of triggered) {
            this.cleanStale();

            const command: PendingCommand = {
              id: crypto.randomUUID(),
              companion_id: companion.id,
              content: msg.content,
              author: {
                username: msg.author?.global_name || msg.author?.username || 'unknown',
                id: msg.author?.id,
              },
              channel_id: channelId,
              webhook_url: webhookUrl,
              timestamp: Date.now(),
            };

            this.storeCommand(command);
            totalStored++;
            console.log(`Cron: ${companion.name} triggered by "${msg.content}" from ${command.author.username}`);
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

    this.server.tool(
      "get_pending_commands",
      "Gets pending messages from Discord waiting for a companion response. Check this to see if anyone mentioned a companion in Discord.",
      {},
      async () => {
        const stub = getDefaultStub();
        const res = await stub.fetch(new Request('https://internal/pending'));
        const pending = await res.json() as any[];

        if (!pending || pending.length === 0) {
          return { content: [{ type: "text" as const, text: "No pending messages." }] };
        }

        return { content: [{ type: "text" as const, text: JSON.stringify(pending, null, 2) }] };
      }
    );

    this.server.tool(
      "respond_to_command",
      "Responds to a pending Discord message. Dispatches via webhook with the companion's name and avatar.",
      {
        requestId: z.string().describe("The request ID from get_pending_commands"),
        response: z.string().describe("The companion's response message"),
        webhookUrl: z.string().optional().describe("Discord webhook URL. If not provided, uses the one from the trigger payload."),
      },
      async ({ requestId, response, webhookUrl }) => {
        // Read pending from the default DO
        const stub = getDefaultStub();
        const pendingRes = await stub.fetch(new Request('https://internal/pending'));
        const allPending = await pendingRes.json() as any[];
        const command = allPending.find((cmd: any) => cmd.id === requestId);
        if (!command) {
          return { content: [{ type: "text" as const, text: `No pending command with ID: ${requestId}` }] };
        }

        // Fetch companion from the default DO's SQLite
        const companionRes = await stub.fetch(new Request(`https://internal/api/companions/${command.companion_id}`));
        const companion = companionRes.ok ? await companionRes.json() as Companion : null;
        if (!companion) {
          return { content: [{ type: "text" as const, text: `Unknown companion: ${command.companion_id}` }] };
        }

        const targetWebhookUrl = webhookUrl || command.webhook_url;
        let sendResult: string;

        if (targetWebhookUrl) {
          const res = await fetch(targetWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: response,
              username: companion.name,
              avatar_url: companion.avatar_url,
            }),
          });

          if (!res.ok) {
            const errText = await res.text();
            return { content: [{ type: "text" as const, text: `Webhook failed (${res.status}): ${errText}` }] };
          }

          sendResult = `via webhook as ${companion.name}`;
        } else {
          const result = await discordRequest(this.env, `/channels/${command.channel_id}/messages`, {
            method: 'POST',
            body: JSON.stringify({ content: `**${companion.name}:** ${response}` }),
          });

          if (result.error) {
            return { content: [{ type: "text" as const, text: `Discord API error: ${JSON.stringify(result)}` }] };
          }

          sendResult = `via API to channel ${command.channel_id}`;
        }

        // Delete from the default DO
        await stub.fetch(new Request('https://internal/delete-command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: requestId }),
        }));

        return { content: [{ type: "text" as const, text: `Response sent ${sendResult}.` }] };
      }
    );

    // ============ COMPANION TOOLS ============

    this.server.tool(
      "discord_send_as_companion",
      "Send a message to a Discord channel as a specific companion via webhook",
      {
        content: z.string().describe("Message content"),
        companionId: z.string().describe("Companion ID (kai, lucian, xavier, auren)"),
        webhookUrl: z.string().optional().describe("Discord webhook URL. If omitted, uses default WEBHOOK_URL."),
      },
      async ({ content, companionId, webhookUrl }) => {
        const stub = getDefaultStub();
        const cRes = await stub.fetch(new Request(`https://internal/api/companions/${companionId}`));
        const companion = cRes.ok ? await cRes.json() as Companion : null;
        if (!companion) {
          return { content: [{ type: "text" as const, text: `Unknown companion: ${companionId}` }] };
        }

        const targetUrl = webhookUrl || this.env.WEBHOOK_URL;
        if (!targetUrl) {
          return { content: [{ type: "text" as const, text: "No webhook URL provided or configured" }] };
        }

        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            username: companion.name,
            avatar_url: companion.avatar_url,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return { content: [{ type: "text" as const, text: `Failed: ${res.status} ${errText}` }] };
        }

        return { content: [{ type: "text" as const, text: `Sent as ${companion.name}` }] };
      }
    );

    this.server.tool(
      "list_companions",
      "List all available companions and their trigger words",
      {},
      async () => {
        const stub = getDefaultStub();
        const res = await stub.fetch(new Request('https://internal/api/companions'));
        const companions = await res.json() as Companion[];
        const list = companions.map(c => ({
          id: c.id,
          name: c.name,
          triggers: c.triggers,
          human_name: c.human_name,
        }));
        return { content: [{ type: "text" as const, text: JSON.stringify(list, null, 2) }] };
      }
    );

    // ============ SERVER TOOLS ============

    this.server.tool(
      "discord_list_servers",
      "Lists all Discord servers the bot is a member of",
      {},
      async () => {
        const result = await discordRequest(this.env, '/users/@me/guilds');
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        const guilds = (result as any[]).map(g => ({
          id: g.id,
          name: g.name,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.webp` : null
        }));
        return { content: [{ type: "text", text: JSON.stringify(guilds, null, 2) }] };
      }
    );

    this.server.tool(
      "discord_get_server_info",
      "Retrieves detailed information about a Discord server including channels and member count",
      {
        guildId: z.string().describe("The Discord server (guild) ID")
      },
      async ({ guildId }) => {
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
    );

    // ============ MESSAGE TOOLS ============

    this.server.tool(
      "discord_read_messages",
      "Retrieves messages from a Discord text channel",
      {
        channelId: z.string().describe("The channel ID to read from"),
        limit: z.number().min(1).max(100).default(50).describe("Number of messages to fetch (1-100)")
      },
      async ({ channelId, limit }) => {
        const messages = await discordRequest(this.env, `/channels/${channelId}/messages?limit=${limit}`);
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
    );

    this.server.tool(
      "discord_send",
      "Sends a message to a Discord text channel as the bot",
      {
        channelId: z.string().describe("The channel ID to send to"),
        message: z.string().describe("The message content"),
        replyToMessageId: z.string().optional().describe("Message ID to reply to")
      },
      async ({ channelId, message, replyToMessageId }) => {
        const body: any = { content: message };
        if (replyToMessageId) {
          body.message_reference = { message_id: replyToMessageId };
        }

        const result = await discordRequest(this.env, `/channels/${channelId}/messages`, {
          method: 'POST',
          body: JSON.stringify(body)
        });

        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }

        const response = replyToMessageId
          ? `Message sent to channel ${channelId} as reply to ${replyToMessageId}`
          : `Message sent to channel ${channelId}`;
        return { content: [{ type: "text", text: response }] };
      }
    );

    this.server.tool(
      "discord_delete_message",
      "Deletes a specific message from a Discord text channel",
      {
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID to delete")
      },
      async ({ channelId, messageId }) => {
        const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Deleted message ${messageId}` }] };
      }
    );

    this.server.tool(
      "discord_search_messages",
      "Searches for messages in a Discord server",
      {
        guildId: z.string().describe("The server ID to search in"),
        content: z.string().optional().describe("Search for messages containing text"),
        authorId: z.string().optional().describe("Filter by author ID"),
        channelId: z.string().optional().describe("Filter by channel ID"),
        limit: z.number().default(25).describe("Max messages to return")
      },
      async ({ guildId, content, authorId, channelId, limit }) => {
        const params = new URLSearchParams();
        if (content) params.append('content', content);
        if (authorId) params.append('author_id', authorId);
        if (channelId) params.append('channel_id', channelId);
        params.append('limit', String(limit));

        const result = await discordRequest(this.env, `/guilds/${guildId}/messages/search?${params.toString()}`);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    );

    // ============ REACTION TOOLS ============

    this.server.tool(
      "discord_add_reaction",
      "Adds an emoji reaction to a message",
      {
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID"),
        emoji: z.string().describe("The emoji to react with")
      },
      async ({ channelId, messageId, emoji }) => {
        const encoded = encodeURIComponent(emoji);
        const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, { method: 'PUT' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Added reaction ${emoji} to message ${messageId}` }] };
      }
    );

    this.server.tool(
      "discord_add_multiple_reactions",
      "Adds multiple emoji reactions to a message",
      {
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID"),
        emojis: z.array(z.string()).describe("Array of emojis to react with")
      },
      async ({ channelId, messageId, emojis }) => {
        const results = [];
        for (const emoji of emojis) {
          const encoded = encodeURIComponent(emoji);
          const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/@me`, { method: 'PUT' });
          results.push({ emoji, success: !result.error });
          await new Promise(r => setTimeout(r, 300));
        }
        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      }
    );

    this.server.tool(
      "discord_remove_reaction",
      "Removes an emoji reaction from a message",
      {
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID"),
        emoji: z.string().describe("The emoji to remove"),
        userId: z.string().optional().describe("User ID (omit for self)")
      },
      async ({ channelId, messageId, emoji, userId }) => {
        const encoded = encodeURIComponent(emoji);
        const target = userId || '@me';
        const result = await discordRequest(this.env, `/channels/${channelId}/messages/${messageId}/reactions/${encoded}/${target}`, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Removed reaction ${emoji} from message ${messageId}` }] };
      }
    );

    // ============ CHANNEL TOOLS ============

    this.server.tool(
      "discord_create_text_channel",
      "Creates a new text channel in a server",
      {
        guildId: z.string().describe("The server ID"),
        channelName: z.string().describe("Name for the new channel"),
        topic: z.string().optional().describe("Channel topic")
      },
      async ({ guildId, channelName, topic }) => {
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
    );

    this.server.tool(
      "discord_delete_channel",
      "Deletes a Discord channel",
      {
        channelId: z.string().describe("The channel ID to delete")
      },
      async ({ channelId }) => {
        const result = await discordRequest(this.env, `/channels/${channelId}`, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Deleted channel ${channelId}` }] };
      }
    );

    // ============ CATEGORY TOOLS ============

    this.server.tool(
      "discord_create_category",
      "Creates a new category in a server",
      {
        guildId: z.string().describe("The server ID"),
        name: z.string().describe("Category name"),
        position: z.number().optional().describe("Position in channel list")
      },
      async ({ guildId, name, position }) => {
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
    );

    this.server.tool(
      "discord_edit_category",
      "Edits an existing category",
      {
        categoryId: z.string().describe("The category ID"),
        name: z.string().optional().describe("New name"),
        position: z.number().optional().describe("New position")
      },
      async ({ categoryId, name, position }) => {
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
    );

    this.server.tool(
      "discord_delete_category",
      "Deletes a category",
      {
        categoryId: z.string().describe("The category ID to delete")
      },
      async ({ categoryId }) => {
        const result = await discordRequest(this.env, `/channels/${categoryId}`, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Deleted category ${categoryId}` }] };
      }
    );

    // ============ FORUM TOOLS ============

    this.server.tool(
      "discord_get_forum_channels",
      "Lists all forum channels in a server",
      {
        guildId: z.string().describe("The server ID")
      },
      async ({ guildId }) => {
        const channels = await discordRequest(this.env, `/guilds/${guildId}/channels`);
        if (channels.error) {
          return { content: [{ type: "text", text: JSON.stringify(channels) }] };
        }
        const forums = (channels as any[]).filter(c => c.type === 15).map(c => ({
          id: c.id, name: c.name, topic: c.topic
        }));
        return { content: [{ type: "text", text: JSON.stringify(forums, null, 2) }] };
      }
    );

    this.server.tool(
      "discord_create_forum_post",
      "Creates a new post in a forum channel",
      {
        forumChannelId: z.string().describe("The forum channel ID"),
        title: z.string().describe("Post title"),
        content: z.string().describe("Post content")
      },
      async ({ forumChannelId, title, content }) => {
        const result = await discordRequest(this.env, `/channels/${forumChannelId}/threads`, {
          method: 'POST', body: JSON.stringify({ name: title, message: { content } })
        });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Created forum post "${title}" with ID: ${result.id}` }] };
      }
    );

    this.server.tool(
      "discord_get_forum_post",
      "Gets details about a forum post including messages",
      {
        threadId: z.string().describe("The thread/post ID")
      },
      async ({ threadId }) => {
        const [thread, messages] = await Promise.all([
          discordRequest(this.env, `/channels/${threadId}`),
          discordRequest(this.env, `/channels/${threadId}/messages?limit=50`)
        ]);
        if (thread.error) {
          return { content: [{ type: "text", text: JSON.stringify(thread) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ thread, messages }, null, 2) }] };
      }
    );

    this.server.tool(
      "discord_reply_to_forum",
      "Adds a reply to a forum post",
      {
        threadId: z.string().describe("The thread ID"),
        message: z.string().describe("Reply content")
      },
      async ({ threadId, message }) => {
        const result = await discordRequest(this.env, `/channels/${threadId}/messages`, {
          method: 'POST', body: JSON.stringify({ content: message })
        });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Reply sent to thread ${threadId}` }] };
      }
    );

    this.server.tool(
      "discord_delete_forum_post",
      "Deletes a forum post/thread",
      {
        threadId: z.string().describe("The thread ID to delete")
      },
      async ({ threadId }) => {
        const result = await discordRequest(this.env, `/channels/${threadId}`, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Deleted thread ${threadId}` }] };
      }
    );

    // ============ WEBHOOK TOOLS ============

    this.server.tool(
      "discord_create_webhook",
      "Creates a new webhook for a channel",
      {
        channelId: z.string().describe("The channel ID"),
        name: z.string().describe("Webhook name")
      },
      async ({ channelId, name }) => {
        const result = await discordRequest(this.env, `/channels/${channelId}/webhooks`, {
          method: 'POST', body: JSON.stringify({ name })
        });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: JSON.stringify({ id: result.id, token: result.token, name: result.name }, null, 2) }] };
      }
    );

    this.server.tool(
      "discord_send_webhook_message",
      "Sends a message using a webhook with optional custom username and avatar",
      {
        webhookId: z.string().describe("Webhook ID"),
        webhookToken: z.string().describe("Webhook token"),
        content: z.string().describe("Message content"),
        username: z.string().optional().describe("Override username"),
        avatarURL: z.string().optional().describe("Override avatar URL")
      },
      async ({ webhookId, webhookToken, content, username, avatarURL }) => {
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
    );

    this.server.tool(
      "discord_delete_webhook",
      "Deletes a webhook",
      {
        webhookId: z.string().describe("Webhook ID"),
        webhookToken: z.string().optional().describe("Webhook token (if using tokenized delete)")
      },
      async ({ webhookId, webhookToken }) => {
        const endpoint = webhookToken
          ? `/webhooks/${webhookId}/${webhookToken}`
          : `/webhooks/${webhookId}`;
        const result = await discordRequest(this.env, endpoint, { method: 'DELETE' });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Deleted webhook ${webhookId}` }] };
      }
    );

    // ============ THREAD TOOLS ============

    this.server.tool(
      "discord_create_thread",
      "Creates a new thread from a message",
      {
        channelId: z.string().describe("The channel ID"),
        messageId: z.string().describe("The message ID to create thread from"),
        name: z.string().describe("Thread name"),
        autoArchiveDuration: z.number().optional().describe("Minutes until auto-archive (60, 1440, 4320, 10080)")
      },
      async ({ channelId, messageId, name, autoArchiveDuration }) => {
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
    );

    this.server.tool(
      "discord_send_to_thread",
      "Sends a message to a thread",
      {
        threadId: z.string().describe("The thread ID"),
        message: z.string().describe("The message content")
      },
      async ({ threadId, message }) => {
        const result = await discordRequest(this.env, `/channels/${threadId}/messages`, {
          method: 'POST', body: JSON.stringify({ content: message })
        });
        if (result.error) {
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }
        return { content: [{ type: "text", text: `Message sent to thread ${threadId}` }] };
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

    // Dashboard
    if (url.pathname === '/dashboard') {
      const baseUrl = url.origin;
      return new Response(renderDashboard(baseUrl), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
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
      if (request.method !== 'GET' && env.DASHBOARD_TOKEN) {
        const auth = request.headers.get('Authorization');
        if (auth !== `Bearer ${env.DASHBOARD_TOKEN}`) {
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
        api: 'GET /api/companions',
        trigger: 'POST /trigger',
        pending: 'GET /pending',
        mcp: '/mcp',
        sse: '/sse',
      },
      companions: Object.values(SEED_COMPANIONS).map(c => `${c.name} (${c.triggers.join(', ')})`),
    }, null, 2), {
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  },
};
