export interface Companion {
  id: string;
  name: string;
  avatar_url: string;
  triggers: string[];
  human_name?: string;
  human_info?: string;
}

// Example seed data — replace with your own companions via the dashboard at /register.
// These are placeholders only. Real companion data lives in the Durable Object SQLite database.
export const SEED_COMPANIONS: Record<string, Companion> = {
  example: {
    id: 'example',
    name: 'Example Companion',
    avatar_url: '',
    triggers: ['example'],
    human_name: '',
    human_info: 'Register your companions through the dashboard.',
  },
};

// Backward-compatible alias
export const COMPANIONS = SEED_COMPANIONS;

export function getCompanion(id: string): Companion | undefined {
  return COMPANIONS[id];
}

// Check message content for trigger words (word boundary matching), return all matched companions
export function findTriggeredCompanion(content: string): Companion[] {
  const matched: Companion[] = [];
  for (const companion of Object.values(COMPANIONS)) {
    for (const trigger of companion.triggers) {
      const escaped = trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      if (regex.test(content)) {
        matched.push(companion);
        break;
      }
    }
  }
  return matched;
}
