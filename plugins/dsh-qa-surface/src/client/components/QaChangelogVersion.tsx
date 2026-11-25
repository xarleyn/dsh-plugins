import type { QaChangelogEntry, QaChangelogSection } from "./QaChangelog.js";

function QaChangelogSections({
  sections,
  heading: Heading,
}: {
  readonly sections: readonly QaChangelogSection[];
  readonly heading: "h4" | "h5";
}) {
  return (
    sections
      // Keep the published text intact when a section has no items.
      .filter((section) => section.items.some((item) => item.trim() !== ""))
      .map((section, index) => (
        <div
          key={`${section.title}:${index}`}
          className="dsh-qa-changelog__section"
        >
          <Heading className="dsh-qa-changelog__section-title">
            {section.title}
          </Heading>
          <ul className="dsh-qa-changelog__list">
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ))
  );
}

export function QaChangelogVersion({
  entry,
  current,
}: {
  readonly entry: QaChangelogEntry;
  readonly current: boolean;
}) {
  return (
    <section className="dsh-qa-changelog__entry">
      <h3 className="dsh-qa-changelog__version">
        Версия {entry.version}
        {"date" in entry && (
          <span className="dsh-qa-changelog__date">{entry.date}</span>
        )}
        {current ? (
          <span className="dsh-qa-changelog__current">текущая</span>
        ) : null}
      </h3>
      {"days" in entry ? (
        entry.days.map((day) => (
          <section key={day.date} className="dsh-qa-changelog__day">
            <h4 className="dsh-qa-changelog__day-title">
              <time dateTime={day.date}>{day.date}</time>
            </h4>
            <QaChangelogSections sections={day.sections} heading="h5" />
          </section>
        ))
      ) : (
        <QaChangelogSections sections={entry.sections} heading="h4" />
      )}
    </section>
  );
}
