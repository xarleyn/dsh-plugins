import { useMemo, useState, useSyncExternalStore } from "react";
import { QaModal } from "../components/QaModal.js";
import type {
  QaAccountIdentityField,
  QaAccountProfile,
  QaAccountProfileInput,
  QaAccountStarters,
  QaAccountStartersInput,
} from "../../types.js";
import type { QaBoundSkillApi, QaIntegrationTokenApi } from "../types.js";
import { QaGeneralSettingsPage } from "./GeneralSettingsPage.js";
import { QaIntegrationTokensPage } from "./IntegrationTokensPage.js";
import { QaPasswordSettingsPage } from "./PasswordSettingsPage.js";
import { QaProfileSettingsPage } from "./ProfileSettingsPage.js";
import { QaSkillsSettingsPage } from "./SkillsSettingsPage.js";
import { QaStartersSettingsPage } from "./StartersSettingsPage.js";
import type { QaUserSettingsSections } from "../settings-extensions/index.js";

/** Sections of the user-facing settings dialog. */
export type QaSettingsSectionId =
  | "profile"
  | "password"
  | "starters"
  | "tokens"
  | "general"
  | "skills"
  | (string & {});

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
  /**
   * Self-service password change. Absent only where the surface runs without
   * accounts at all, in which case this dialog is not shown either.
   */
  readonly password?: {
    readonly onChange: (
      currentPassword: string,
      nextPassword: string,
    ) => Promise<string | null>;
  };
  /** Self-service starter buttons; absent when the deployment turns them off. */
  readonly starters?: {
    readonly starters: QaAccountStarters;
    readonly onSave: (input: QaAccountStartersInput) => Promise<string | null>;
  };
  /** Integration tokens; absent when accounts are off altogether. */
  readonly integrationTokens?: QaIntegrationTokenApi;
  /** Personal skills; absent when the deployment cannot host them. */
  readonly skills?: QaBoundSkillApi;
  /** Additive pages contributed by separately shipped QA plugins. */
  readonly extensions?: QaUserSettingsSections;
  /** Current account token, passed only to the selected extension page. */
  readonly token?: string;
}

interface QaSettingsSectionModel {
  readonly id: QaSettingsSectionId;
  readonly title: string;
}

const EMPTY_EXTENSION_SNAPSHOT = Object.freeze({
  sections: Object.freeze([]),
  revision: 0,
});
const subscribeToNothing = () => () => undefined;
const emptyExtensionSnapshot = () => EMPTY_EXTENSION_SNAPSHOT;

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
  const extensionSnapshot = useSyncExternalStore(
    props.extensions?.subscribe ?? subscribeToNothing,
    props.extensions?.getSnapshot ?? emptyExtensionSnapshot,
    props.extensions?.getSnapshot ?? emptyExtensionSnapshot,
  );
  const sections = useMemo((): readonly QaSettingsSectionModel[] => {
    const models: QaSettingsSectionModel[] = [];
    if (props.profile !== undefined) {
      models.push({ id: "profile", title: "Профиль" });
    }
    if (props.password !== undefined) {
      models.push({ id: "password", title: "Пароль" });
    }
    if (props.starters !== undefined) {
      models.push({ id: "starters", title: "Быстрые сообщения" });
    }
    if (props.integrationTokens !== undefined) {
      models.push({ id: "tokens", title: "Интеграционные токены" });
    }
    models.push({ id: "general", title: "Общие" });
    if (props.skills !== undefined) {
      models.push({ id: "skills", title: "Навыки" });
    }
    models.push(
      ...extensionSnapshot.sections.map(({ id, title }) => ({ id, title })),
    );
    return models;
  }, [
    props.profile,
    props.password,
    props.starters,
    props.integrationTokens,
    props.skills,
    extensionSnapshot.sections,
  ]);
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
          {active === "password" && props.password !== undefined ? (
            <QaPasswordSettingsPage onChange={props.password.onChange} />
          ) : null}
          {active === "starters" && props.starters !== undefined ? (
            <QaStartersSettingsPage
              starters={props.starters.starters}
              onSave={props.starters.onSave}
            />
          ) : null}
          {active === "tokens" && props.integrationTokens !== undefined ? (
            <QaIntegrationTokensPage api={props.integrationTokens} />
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
          {extensionSnapshot.sections.map((entry) =>
            entry.id === active && props.token !== undefined ? (
              <entry.component key={entry.id} token={props.token} />
            ) : null,
          )}
        </div>
      </div>
    </QaModal>
  );
}
