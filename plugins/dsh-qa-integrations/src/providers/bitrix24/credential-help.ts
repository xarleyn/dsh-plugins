import type { CredentialHelp } from "@yadsh/dsh-plugin-kit";

/**
 * How a Bitrix24 connection is obtained. There is no token page to link: the
 * credential *is* the incoming webhook address of the user's own portal, so the
 * help explains the mechanism and points at the vendor documentation.
 */
export const BITRIX24_CREDENTIAL_HELP: CredentialHelp = Object.freeze({
  kind: "custom",
  label: "Входящий вебхук Bitrix24",
  docs: {
    url: "https://apidocs.bitrix24.com/local-integrations/local-webhooks.html",
    label: "Документация по вебхукам",
  },
  instructions: [
    "Откройте Битрикс24 и перейдите в Приложения → Разработчикам.",
    "Выберите «Другое» → «Входящий вебхук».",
    "Отметьте права, которые нужны агенту, и сохраните вебхук.",
    "Скопируйте полный адрес вебхука и вставьте его в поле выше.",
  ].join("\n"),
  notes: [
    "Адрес вебхука и есть доступ: он действует с вашими правами, поэтому не делитесь им.",
    "Вебхук хранится в зашифрованном виде и после сохранения не отображается.",
  ],
});
