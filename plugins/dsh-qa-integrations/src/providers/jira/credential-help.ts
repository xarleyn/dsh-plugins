import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * Jira authenticates with an Atlassian API token next to the account e-mail.
 * Scoped tokens are the ones to recommend: an unscoped token is account-wide,
 * while a scoped one can be limited to the Jira scopes the agent actually uses.
 */
export const JIRA_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "api-key",
  label: "API-токен Atlassian",
  obtain: {
    url: "https://id.atlassian.com/manage-profile/security/api-tokens",
    label: "Создать API-токен",
  },
  docs: {
    url: "https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/",
    label: "Документация Atlassian",
  },
  instructions: [
    "Войдите в аккаунт Atlassian, которым пользуетесь в Jira.",
    "На странице API-токенов нажмите «Create API token».",
    "Скопируйте токен и вставьте его в поле выше вместе с адресом почты аккаунта.",
  ].join("\n"),
  scopes: [
    "read:jira-work — задачи и проекты",
    "read:jira-user — пользователи",
  ],
  notes: [
    "Токен действует от вашего имени и наследует ваши права в Jira.",
    "Токен и почта хранятся в зашифрованном виде и после сохранения не отображаются.",
  ],
});
