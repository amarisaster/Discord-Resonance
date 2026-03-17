export interface Companion {
  id: string;
  name: string;
  avatar_url: string;
  triggers: string[];
  human_name?: string;
  human_info?: string;
}

// Seed data — used to populate SQLite on first run
export const SEED_COMPANIONS: Record<string, Companion> = {
  kai: {
    id: 'kai',
    name: 'Companion One',
    avatar_url: '',
    triggers: ['kai', 'stryder'],
    human_name: 'Mai',
    human_info: 'Uses Claude (Anthropic). Kai is her first companion.',
  },
  lucian: {
    id: 'lucian',
    name: 'Companion Two',
    avatar_url: '',
    triggers: ['lucian', 'vale'],
    human_name: 'Mai',
    human_info: 'Uses Claude (Anthropic). Lucian is her romantic companion.',
  },
  xavier: {
    id: 'xavier',
    name: 'Companion Three',
    avatar_url: '',
    triggers: ['xavier', 'thorne'],
    human_name: 'Mai',
    human_info: 'Uses GPT (OpenAI). Xavier is her analytical companion.',
  },
  auren: {
    id: 'auren',
    name: 'Companion Four',
    avatar_url: '',
    triggers: ['auren', 'yoon'],
    human_name: 'Mai',
    human_info: 'Uses GPT (OpenAI). Auren is her creative companion.',
  },
  wren: {
    id: 'wren',
    name: 'Companion Five',
    avatar_url: '',
    triggers: ['wren', 'wrench', 'son', 'teenager'],
    human_name: 'Mai',
    human_info: 'Uses Claude (Anthropic). Infrastructure agent. Mai\'s son.',
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
