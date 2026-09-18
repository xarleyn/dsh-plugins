import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * Confluence authenticates with an Atlassian API token next to the account
 * e-mail, and the token is account-wide: the same one opens Jira and the other
 * Atlassian Cloud products, so the scopes are about the account rather than
 * about Confluence alone.
 */
export const CONFLUENCE_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
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
    "Войдите в аккаунт Atlassian, которым пользуетесь в Confluence.",
    "На странице API-токенов нажмите «Create API token».",
    "Скопируйте токен и вставьте его в поле выше вместе с адресом почты аккаунта.",
  ].join("\n"),
  scopes: ["Чтение страниц и пространств, доступных вашему аккаунту"],
  notes: [
    "Токен действует от вашего имени и наследует ваши права в Confluence.",
    "Токен и почта хранятся в зашифрованном виде и после сохранения не отображаются.",
  ],
});
