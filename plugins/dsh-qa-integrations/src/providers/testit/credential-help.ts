import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * Test IT calls the credential a private token and mints it in the user's own
 * profile, where it is shown once and stays valid until it is deleted — the two
 * facts a user needs before pasting it, plus where the API itself is documented.
 */
export const TESTIT_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "api-key",
  label: "API-токен Test IT",
  obtain: {
    url: "https://docs.testit.software/user-guide/user-settings.html",
    label: "Как создать токен",
  },
  docs: {
    url: "https://docs.testit.software/user-guide/work-with-api.html",
    label: "Документация Test IT",
  },
  instructions: [
    "Откройте Test IT и войдите в свой аккаунт.",
    "В настройках профиля перейдите на вкладку «Безопасность».",
    "Введите имя токена, нажмите «Сгенерировать» и скопируйте значение сразу: позже Test IT его не покажет.",
    "Вставьте токен в поле выше.",
  ].join("\n"),
  scopes: ["Токен действует от вашего имени и наследует ваши права в Test IT"],
  notes: [
    "Инсталляцию задаёт оператор стенда: у облачного Test IT и у развёрнутого на своей площадке адрес отличается.",
    "Токен хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
