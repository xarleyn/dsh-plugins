import { useEffect, useRef } from "react";

/**
 * The deployed plugin version and a curated end-user changelog. The module is
 * bundled into the self-contained client, so both are frozen at build time;
 * the build and test configs inject QA_VERSION from package.json. Curated
 * entries may include the next planned version before Nx materializes it in
 * CHANGELOG.md; after the release bump that entry becomes current without a
 * source edit.
 */
declare const __DSH_QA_VERSION__: string;
export const QA_VERSION = __DSH_QA_VERSION__;

export interface QaChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly sections: readonly {
    readonly title: string;
    readonly items: readonly string[];
  }[];
}

export const QA_CHANGELOG: readonly QaChangelogEntry[] = [
  {
    version: "0.3.0",
    date: "2026-09-12",
    sections: [
      {
        title: "Новое",
        items: [
          "Аккаунты QA: вход и регистрация, персональная история чатов, выход из аккаунта и управление пользователями через CLI.",
          "Администратор видит только свои чаты по умолчанию. Общую историю пользователей можно явно включить настройкой accounts.showOtherUsersChats.",
          "Предупреждение при входе в тестовый QA-интерфейс с пояснением о работе с данными.",
          "Навигация по ответу стала нагляднее: шкала хода работы, сноски на источники и подробности выполненных инструментов.",
          "История версий теперь доступна прямо из нижней части сайдбара.",
        ],
      },
      {
        title: "Исправления",
        items: [
          "Поиск по чатам учитывает владельца, получил кнопку очистки и больше не ломает ширину строк; роли администратора отображаются отдельно.",
          "Убраны декоративные точки-разделители из списка чатов, сообщений и карточек источников.",
          "Переключение между чатами больше не переносит вложения и другое состояние предыдущей сессии; устранены гонки асинхронной загрузки.",
          "Изменения аккаунтов, сделанные через CLI, подхватываются без перезапуска, а запись хранилища стала безопаснее для параллельных процессов.",
          "Ошибки создания сессии, остановленные и завершившиеся ошибкой инструменты теперь показываются пользователю корректно.",
          "Клиент и упакованный плагин обновлены для интерфейсов DSH 0.1.5-rc.2.",
        ],
      },
    ],
  },
  {
    version: "0.2.0",
    date: "2026-09-10",
    sections: [
      {
        title: "Новое",
        items: [
          "Вложения-картинки: перетащите файл в чат, вставьте из буфера или выберите через кнопку — превью можно убрать до отправки.",
          "Субагенты-эксперты: панель со списком, живой просмотр их работы только для чтения и свёрнутые уведомления о завершении.",
          "Карточки источников с полным просмотром вывода, кликабельными ссылками и кнопкой открытия.",
          "Перегенерация ответа с переключением вариантов, как в ChatGPT.",
          "Оценки ответов с метаданными на-hover: длительность, время до первого токена, токенов в секунду.",
          "История чатов: поиск, сворачивание сайдбара, сортировка по обновлению, черновики-чаты без создания сессии до первого вопроса.",
          "Закрепление чата за каталогом/workspace с понятным отказом, когда workspace недоступен.",
          "Плашка с дисклеймером об использовании данных под полем ввода.",
        ],
      },
      {
        title: "Исправления",
        items: [
          "В опубликованный пакет снова вошли модули host- и remote-энтрипоинтов, которые терялись при упаковке.",
        ],
      },
    ],
  },
  {
    version: "0.1.1",
    date: "2026-09-06",
    sections: [
      {
        title: "Исправления",
        items: [
          "Отдельный браузерный интерфейс QA поверх нативных сессий DeepSeek Harness.",
        ],
      },
    ],
  },
  {
    version: "0.1.0",
    date: "2026-09-05",
    sections: [
      {
        title: "Новое",
        items: [
          "Полноэкранный чат /qa на нативных сессиях DSH: потоковый ответ, Stop, Новый чат, безопасный Markdown, адаптивный интерфейс.",
          "Группировка рассуждений и вызовов инструментов в сворачиваемый блок «Работал над ответом».",
          "История чатов в сайдбаре с поиском по этому браузеру, переключением и удалением чата из индекса.",
          "Русскоязычный интерфейс, вращающиеся фразы-«мысли» и чипсы быстрых вопросов на пустом чате.",
          "Безопасность: аттестация политики хоста, закреплённый read-only профиль, белый список инструментов и защита от повторного выполнения.",
          "Рендер GFM-таблиц, нумерованных списков и разделителей в ответах.",
          "Работа по сети: деплой-оверлей для LAN и запасной путь получения конфигурации.",
        ],
      },
    ],
  },
];

/** Props of the {@link QaChangelogModal} dialog. */
export interface QaChangelogModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/**
 * The version/changelog dialog opened from the sidebar footer. Rendering is
 * a no-op while closed; Escape and a backdrop click close it.
 */
export function QaChangelogModal(props: QaChangelogModalProps) {
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!props.open) return;
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return (
    <div
      className="dsh-qa-changelog"
      role="dialog"
      aria-modal="true"
      aria-label="История версий"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <div className="dsh-qa-changelog__panel">
        <header className="dsh-qa-changelog__head">
          <h2 className="dsh-qa-changelog__title">История версий</h2>
          <button
            ref={closeButton}
            type="button"
            className="dsh-qa-changelog__close"
            aria-label="Закрыть историю версий"
            onClick={props.onClose}
          >
            <svg viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" />
            </svg>
          </button>
        </header>
        <div className="dsh-qa-changelog__body">
          {QA_CHANGELOG.map((entry) => (
            <section key={entry.version} className="dsh-qa-changelog__entry">
              <h3 className="dsh-qa-changelog__version">
                Версия {entry.version}
                <span className="dsh-qa-changelog__date">{entry.date}</span>
                {entry.version === QA_VERSION ? (
                  <span className="dsh-qa-changelog__current">текущая</span>
                ) : null}
              </h3>
              {entry.sections.map((section) => (
                <div key={section.title} className="dsh-qa-changelog__section">
                  <h4 className="dsh-qa-changelog__section-title">
                    {section.title}
                  </h4>
                  <ul className="dsh-qa-changelog__list">
                    {section.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
