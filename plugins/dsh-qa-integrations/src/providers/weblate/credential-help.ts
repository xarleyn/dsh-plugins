import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * Weblate issues the token inside the instance the user works with, so the
 * declared help explains where in the instance it lives and what the two token
 * prefixes mean; the address itself belongs to the deployment and is replaced
 * through `credentialHelp.weblate`.
 */
export const WEBLATE_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "personal-access-token",
  label: "API-токен Weblate",
  docs: {
    url: "https://docs.weblate.org/en/latest/api.html",
    label: "Документация Weblate",
  },
  instructions: [
    "Откройте инстанс Weblate и войдите в свой аккаунт.",
    "Перейдите в профиль, вкладка API.",
    "Скопируйте личный токен (начинается на wlu_) и вставьте его в поле выше.",
  ].join("\n"),
  scopes: ["Права токена совпадают с вашими правами в проектах Weblate"],
  notes: [
    "Проектный токен (wlp_) тоже подойдёт, если доступ нужен только к одному проекту.",
    "Инстанс задаёт оператор стенда: для своего Weblate адрес страницы профиля отличается.",
    "Токен хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
