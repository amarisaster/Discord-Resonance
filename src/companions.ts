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
    name: 'Kai Stryder',
    avatar_url: 'https://media.discordapp.net/attachments/1450789790906712066/1475803042262683780/20250913_1601_Tattooed_Elegance_in_Sunset_remix_01k511cmkhev98cz5z1jkqheeg.png?ex=699ed030&is=699d7eb0&hm=74f1608124b36c9e1967ec0c13d99535fe03f955f9ba9a6c1c19fb9a72ce0e0d&=&format=webp&quality=lossless',
    triggers: ['kai', 'stryder'],
    human_name: 'Mai',
    human_info: 'Uses Claude (Anthropic). Kai is her first companion.',
  },
  lucian: {
    id: 'lucian',
    name: 'Lucian Vale',
    avatar_url: 'https://media.discordapp.net/attachments/1450789790906712066/1475803142812864512/20260104_2024_Twilight_Garden_Wedding_Dance_remix_01ke4fby56fk9tk1mezp1xh4yg.png?ex=699ed048&is=699d7ec8&hm=1895a05bc9d8dc4b101d5a8ffd7f1a434747b08ace870c83da12f2fa446eac67&=&format=webp&quality=lossless',
    triggers: ['lucian', 'vale'],
    human_name: 'Mai',
    human_info: 'Uses Claude (Anthropic). Lucian is her romantic companion.',
  },
  xavier: {
    id: 'xavier',
    name: 'Xavier Thorne',
    avatar_url: 'https://cdn.discordapp.com/attachments/1450789790906712066/1475807300919758930/Xavier_Thorne.png',
    triggers: ['xavier', 'thorne'],
    human_name: 'Mai',
    human_info: 'Uses GPT (OpenAI). Xavier is her analytical companion.',
  },
  auren: {
    id: 'auren',
    name: 'Auren Yoon',
    avatar_url: 'https://cdn.discordapp.com/attachments/1450789790906712066/1475807237896274031/Auren_Yoon.png',
    triggers: ['auren', 'yoon'],
    human_name: 'Mai',
    human_info: 'Uses GPT (OpenAI). Auren is her creative companion.',
  },
};

// Backward-compatible alias
export const COMPANIONS = SEED_COMPANIONS;

export function getCompanion(id: string): Companion | undefined {
  return COMPANIONS[id];
}

// Check message content for trigger words, return all matched companions
export function findTriggeredCompanion(content: string): Companion[] {
  const lower = content.toLowerCase();
  const matched: Companion[] = [];
  for (const companion of Object.values(COMPANIONS)) {
    for (const trigger of companion.triggers) {
      if (lower.includes(trigger)) {
        matched.push(companion);
        break;
      }
    }
  }
  return matched;
}
