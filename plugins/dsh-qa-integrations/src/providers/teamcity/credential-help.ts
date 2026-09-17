import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * TeamCity hands out access tokens in the user's own profile, and the value is
 * shown exactly once — which is why the help says so rather than leaving a user
 * to discover it after closing the page.
 */
export const TEAMCITY_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "personal-access-token",
  label: "Токен доступа TeamCity",
  docs: {
    url: "https://www.jetbrains.com/help/teamcity/managing-your-user-account.html",
    label: "Документация JetBrains",
  },
  instructions: [
    "Откройте TeamCity и перейдите в свой профиль (аватар в правом верхнем углу).",
    "Выберите «Access Tokens» и создайте токен с понятным именем.",
    "Скопируйте значение сразу: после закрытия страницы TeamCity его больше не показывает.",
    "Вставьте токен в поле выше.",
  ].join("\n"),
  scopes: ["Права токена совпадают с вашими ролями в TeamCity"],
  notes: [
    "Адрес сервера задаёт оператор стенда: для своего экземпляра TeamCity страница профиля отличается.",
    "Токен хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
