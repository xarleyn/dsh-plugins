/**
 * Deterministic display codenames for subagent sessions.
 *
 * The host addresses a background child by its session UUID — opaque noise in
 * an operator-facing notice. A pure string hash folds the full UUID into a
 * stable adjective-plus-noun codename ("Дотошный Барсук"): the same child
 * keeps its codename across reloads and reconnects, nothing is stored, and
 * within one chat's handful of subagents collisions are rare. A codename is
 * decoration only — the short session id stays in the notice body for log
 * correlation.
 */

const ADJECTIVES: readonly string[] = Object.freeze([
  "Аккуратный",
  "Бдительный",
  "Бесстрашный",
  "Бойкий",
  "Вежливый",
  "Весёлый",
  "Внимательный",
  "Выносливый",
  "Дерзкий",
  "Дотошный",
  "Загадочный",
  "Ироничный",
  "Ловкий",
  "Любознательный",
  "Меткий",
  "Мудрый",
  "Находчивый",
  "Неутомимый",
  "Ночной",
  "Обстоятельный",
  "Педантичный",
  "Пунктуальный",
  "Смекалистый",
  "Тайный",
  "Терпеливый",
  "Тихий",
  "Усердный",
  "Хитроумный",
  "Цепкий",
  "Чуткий",
  "Шустрый",
  "Ярый",
]);

/** Masculine on purpose: every adjective above is masculine too. */
const NOUNS: readonly string[] = Object.freeze([
  "Архивариус",
  "Барсук",
  "Бобёр",
  "Бурундук",
  "Волк",
  "Ворон",
  "Голубь",
  "Детектив",
  "Дятел",
  "Ёж",
  "Енот",
  "Жаворонок",
  "Журавль",
  "Заяц",
  "Кит",
  "Крот",
  "Кулибин",
  "Картограф",
  "Лис",
  "Медведь",
  "Муравей",
  "Мыслитель",
  "Оптимист",
  "Орёл",
  "Осьминог",
  "Пеликан",
  "Пингвин",
  "Пират",
  "Полководец",
  "Сокол",
  "Сыч",
  "Тюлень",
  "Филин",
  "Хамелеон",
  "Хомяк",
  "Чиж",
  "Шершень",
  "Штурман",
  "Экспедитор",
  "Ягуар",
]);

/** Fold one string through FNV-1a seeded with `seed`. */
function fnv1a(text: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * The codename one subagent session displays: two FNV-1a passes with
 * different seeds pick the adjective and the noun independently, so the
 * pairs spread across the whole vocabulary instead of walking it in lockstep.
 */
export function codenameFor(id: string): string {
  const normalized = id.trim().toLowerCase();
  const adjective = fnv1a(normalized, 2_166_136_261);
  const noun = fnv1a(normalized, 2_166_136_261 ^ 0x9e37_79b9);
  return `${ADJECTIVES[adjective % ADJECTIVES.length]} ${
    NOUNS[noun % NOUNS.length]
  }`;
}
