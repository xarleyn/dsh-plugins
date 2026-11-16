import type { ReactNode } from "react";
import { QaSettingsSection } from "./fields.js";

export interface QaGeneralSettingsPageProps {
  readonly email: string;
  readonly role: string;
  readonly chatCount: number;
  readonly appearance?: ReactNode;
}

export function QaGeneralSettingsPage(props: QaGeneralSettingsPageProps) {
  return (
    <div className="dsh-qa-settings__page" data-testid="qa-settings-general">
      <h3
        className="dsh-qa-settings__page-title"
        data-testid="qa-settings-general-title"
      >
        Общие
      </h3>
      {props.appearance && (
        <QaSettingsSection
          testId="qa-settings-appearance"
          title="Тема оформления"
        >
          {props.appearance}
        </QaSettingsSection>
      )}
      <QaSettingsSection testId="qa-settings-general-account" title="Аккаунт">
        <dl
          className="dsh-qa-settings__facts"
          data-testid="qa-settings-general-facts"
        >
          <div
            className="dsh-qa-settings__fact"
            data-testid="qa-settings-general-fact-email"
          >
            <dt>Email</dt>
            <dd>{props.email}</dd>
          </div>
          <div
            className="dsh-qa-settings__fact"
            data-testid="qa-settings-general-fact-role"
          >
            <dt>Роль</dt>
            <dd>{props.role}</dd>
          </div>
          <div
            className="dsh-qa-settings__fact"
            data-testid="qa-settings-general-fact-chats"
          >
            <dt>Ваши чаты</dt>
            <dd>{props.chatCount}</dd>
          </div>
        </dl>
      </QaSettingsSection>
    </div>
  );
}
