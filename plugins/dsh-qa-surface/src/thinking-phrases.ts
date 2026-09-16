/**
 * Phrases the running indicator cycles through. The list deliberately mixes
 * Russian idiom with workshop imagery: a turn that keeps reshuffling the same
 * thought in new words reads as alive, while a frozen one reads as stuck.
 *
 * Operators replace the list through `thinkingPhrases`; this module holds the
 * canonical default so the config schema, the resolver and the browser all
 * read one list.
 */
export const DEFAULT_THINKING_PHRASES: readonly string[] = Object.freeze([
  "Скребу по сусекам…",
  "Кумекаю…",
  "Навожу резкость…",
  "Собираю мысли в кучку…",
  "Раскладываю по полочкам…",
  "Сверяю приметы…",
  "Шлифую мысли…",
  "Раскидываю умом…",
  "Обтачиваю формулировки…",
  "Ломаю голову…",
  "Затачиваю аргументы…",
  "Шевелю извилинами…",
  "Правлю напильником…",
  "Разматываю клубок…",
  "Снимаю стружку…",
  "Вяжу концы с концами…",
  "Фрезерую крайние случаи…",
  "Меряю семь раз…",
  "Прокаливаю гипотезы…",
  "Смотрю в корень…",
  "Отливаю форму решения…",
  "Ставлю точки над i…",
  "Кую версию…",
  "Разбираю по косточкам…",
  "Калибрую допуски…",
  "Прикидываю так и эдак…",
  "Считаю допуски и посадки…",
  "Взвешиваю за и против…",
  "Меряю штангенциркулем…",
  "Читаю между строк…",
  "Сверяю по чертежу…",
  "Тяну за ниточку…",
  "Проверяю биение…",
  "Перебираю варианты…",
  "Зачищаю заусенцы…",
  "Жонглирую версиями…",
  "Центрую заготовку…",
  "Подшиваю факты к делу…",
  "Обкатываю механизм…",
  "Плету сеть доводов…",
  "Собираю узел…",
  "Думаю думу…",
  "Гну по шаблону…",
  "Сверяю с ГОСТом…",
]);

/** How long one phrase stays on screen before the next one takes over. */
const PHRASE_INTERVAL_MS = 4_000;

/**
 * Phrase shown `elapsedMs` into a running turn. The list is operator supplied,
 * so an empty one falls back to the default: the indicator always needs a
 * label.
 */
export function thinkingPhrase(
  elapsedMs: number,
  phrases: readonly string[] = DEFAULT_THINKING_PHRASES,
): string {
  const pool = phrases.length === 0 ? DEFAULT_THINKING_PHRASES : phrases;
  const index =
    Math.floor(Math.max(0, elapsedMs) / PHRASE_INTERVAL_MS) % pool.length;
  return pool[index] as string;
}
