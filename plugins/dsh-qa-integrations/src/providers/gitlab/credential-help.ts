import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * A GitLab personal access token is minted on the instance the connection
 * belongs to. The declared help points at gitlab.com, which is right for a
 * hosted user and wrong for every self-hosted deployment — those replace the
 * address (and their own token page) through `credentialHelp.gitlab`.
 */
export const GITLAB_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "personal-access-token",
  label: "Personal access token GitLab",
  obtain: {
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
    label: "Создать токен",
  },
  docs: {
    url: "https://docs.gitlab.com/user/profile/personal_access_tokens/",
    label: "Документация GitLab",
  },
  instructions: [
    "Откройте страницу токенов на своём инстансе GitLab.",
    "Создайте токен с областью read_api, отметьте срок действия.",
    "Скопируйте токен и вставьте его в поле выше.",
  ].join("\n"),
  scopes: [
    "read_api — всё читаемое",
    "read_user — профиль",
    "read_repository — код",
  ],
  notes: [
    "Инстанс задаёт оператор стенда: для self-hosted GitLab адрес выдачи токена и набор прав может отличаться.",
    "Токен хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
