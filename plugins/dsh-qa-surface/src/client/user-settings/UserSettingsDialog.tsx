import { useMemo, useState } from "react";
import { QaModal } from "../components/QaModal.js";
import type {
  QaAccountIdentityField,
  QaAccountProfile,
  QaAccountProfileInput,
  QaAccountStarters,
  QaAccountStartersInput,
} from "../../types.js";
import type { QaBoundSkillApi } from "../types.js";
import { QaGeneralSettingsPage } from "./GeneralSettingsPage.js";
import { QaProfileSettingsPage } from "./ProfileSettingsPage.js";
import { QaSkillsSettingsPage } from "./SkillsSettingsPage.js";
import { QaStartersSettingsPage } from "./StartersSettingsPage.js";

/** Sections of the user-facing settings dialog. */
export type QaSettingsSectionId = "profile" | "starters" | "general" | "skills";

export interface QaUserSettingsDialogProps {
  readonly open: boolean;
  /** Section to show when the dialog opens. */
  readonly initialSection: QaSettingsSectionId;
  readonly onClose: () => void;
  readonly email: string;
  readonly role: string;
  readonly chatCount: number;
  /** Self-service profile editing; absent when the deployment turns it off. */
  readonly profile?: {
    readonly profile: QaAccountProfile;
    readonly fields: readonly QaAccountIdentityField[];
    readonly instructionsMaxLength: number;
    readonly onSave: (input: QaAccountProfileInput) => Promise<string | null>;
  };
  /** Self-service starter buttons; absent when the deployment turns them off. */
  readonly starters?: {
    readonly starters: QaAccountStarters;
    readonly onSave: (input: QaAccountStartersInput) => Promise<string | null>;
  };
  /** Personal skills; absent when the deployment cannot host them. */
  readonly skills?: QaBoundSkillApi;
}

interface QaSettingsSectionModel {
  readonly id: QaSettingsSectionId;
  readonly title: string;
}

/**
 * One settings dialog for everything the signed-in user owns: the profile, a
 * place for personal preferences, and their skills.
 *
 * It replaces the separate profile modal rather than sitting beside it — the
 * section list is the single entry point — and it is deliberately a plain
 * tablist inside the shared dialog shell: on a narrow screen the same element
 * becomes a horizontal strip instead of a second navigation screen.
 */
export function QaUserSettingsDialog(props: QaUserSettingsDialogProps) {
  const [section, setSection] = useState<QaSettingsSectionId>(
    props.initialSection,
  );
  const sections = useMemo((): readonly QaSettingsSectionModel[] => {
    const models: QaSettingsSectionModel[] = [];
    if (props.profile !== undefined) {
      models.push({ id: "profile", title: "Профиль" });
    }
    if (props.starters !== undefined) {
      models.push({ id: "starters", title: "Быстрые сообщения" });
    }
    models.push({ id: "general", title: "Общие" });
    if (props.skills !== undefined) {
      models.push({ id: "skills", title: "Навыки" });
    }
    return models;
  }, [props.profile, props.starters, props.skills]);
  // A section the deployment withdrew while the dialog was open must not leave
  // an empty panel behind.
  const active = sections.some((entry) => entry.id === section)
    ? section
    : (sections[0]?.id ?? "general");
  return (
    <QaModal
      open={props.open}
      title="Настройки"
      closeLabel="Закрыть настройки"
      size="settings"
      onClose={props.onClose}
    >
      <div className="dsh-qa-settings">
        <nav
          className="dsh-qa-settings__nav"
          role="tablist"
          aria-label="Разделы настроек"
        >
          {sections.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === active}
              className={
                entry.id === active
                  ? "dsh-qa-settings__tab dsh-qa-settings__tab--active"
                  : "dsh-qa-settings__tab"
              }
              onClick={() => setSection(entry.id)}
            >
              {entry.title}
            </button>
          ))}
        </nav>
        <div
          className="dsh-qa-settings__content"
          role="tabpanel"
          aria-label={
            sections.find((entry) => entry.id === active)?.title ?? "Настройки"
          }
        >
          {active === "profile" && props.profile !== undefined ? (
            <QaProfileSettingsPage
              email={props.email}
              profile={props.profile.profile}
              identities={props.profile.fields}
              instructionsMaxLength={props.profile.instructionsMaxLength}
              onSave={props.profile.onSave}
            />
          ) : null}
          {active === "starters" && props.starters !== undefined ? (
            <QaStartersSettingsPage
              starters={props.starters.starters}
              onSave={props.starters.onSave}
            />
          ) : null}
          {active === "general" ? (
            <QaGeneralSettingsPage
              email={props.email}
              role={props.role}
              chatCount={props.chatCount}
            />
          ) : null}
          {active === "skills" && props.skills !== undefined ? (
            // Remounting per open keeps the catalog fresh: a skill edited in
            // another tab is re-read the next time the section is entered.
            <QaSkillsSettingsPage api={props.skills} />
          ) : null}
        </div>
      </div>
    </QaModal>
  );
}
