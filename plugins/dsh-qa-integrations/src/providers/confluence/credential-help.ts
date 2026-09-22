import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * Confluence authenticates in one of two ways, depending on where it runs.
 * Atlassian Cloud takes an API token next to the account e-mail, and that token
 * is account-wide: the same one opens Jira and the other Atlassian Cloud
 * products, so the scopes are about the account rather than about Confluence
 * alone. A self-hosted Server / Data Center instance takes a personal access
 * token and no account, because the token belongs to the account that minted
 * it. Which one the connect form asks for follows the instance the operator
 * configured, and the instructions name both so the page is not wrong for
 * either product.
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
    "Войдите в аккаунт, которым пользуетесь в Confluence.",
    "Atlassian Cloud: на странице API-токенов нажмите «Create API token» и вставьте токен вместе с адресом почты аккаунта.",
    "Server / Data Center: откройте «Профиль → Личные токены доступа» (Personal Access Tokens), создайте токен и вставьте его — почта не нужна.",
  ].join("\n"),
  scopes: ["Чтение страниц и пространств, доступных вашему аккаунту"],
  notes: [
    "Токен действует от вашего имени и наследует ваши права в Confluence.",
    "Для Cloud нужен адрес почты аккаунта; для Server / Data Center достаточно самого токена.",
    "Токен хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
