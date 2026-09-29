/**
 * How far the deployment's managed service credential reaches each capability
 * switch of the operator card.
 *
 * A switch answers "does the agent see this area of the integration", and the
 * managed credential honours it only for the areas whose answer is not text a
 * build or another person produced. Those readings stay personal while the
 * switch stays on, which is exactly the gap issue #285 is about: the operator
 * ticks «Логи сборок: чтение», the stand really does grant the capability, and
 * the user on a service token is still refused. Nothing here decides a call —
 * the provider catalogs do — this table only says out loud what they already
 * enforce, so the operator sees it next to the switch instead of in a refusal.
 *
 * The client bundle cannot reach into a provider catalog, so the table is
 * written by hand; `tests/client/operator-service-reach.test.ts` recomputes it from
 * every catalog and fails the moment the two disagree.
 */

/** Whether a switch escapes the service credential whole or in part. */
export type ServiceReach = "whole" | "part";

/**
 * What the operator card says per reach, in the words the user's own card uses
 * for the same state («Требуется личный аккаунт»). `part` covers a switch whose
 * area mixes service-safe reads with personal ones — TeamCity's artifacts are
 * the plain example, where the listing answers and the file body does not.
 */
export const SERVICE_REACH_NOTE: Readonly<Record<ServiceReach, string>> =
  Object.freeze({
    whole: "с сервисным токеном недоступно: требуется личный аккаунт",
    part: "с сервисным токеном читается не всё: для содержимого нужен личный аккаунт",
  });

/** One provider's switches, keyed by the config flag the card addresses by. */
type SwitchNotes = Readonly<Record<string, ServiceReach>>;

const bitrix24 = Object.freeze({
  crmRead: "part",
  chatRead: "whole",
  openlinesRead: "whole",
  userRead: "part",
  calendarRead: "whole",
  diskRead: "whole",
} satisfies SwitchNotes);

const gitlab = Object.freeze({
  // The card addresses the two halves of GitLab's CI by their own flags, so the
  // note sits on the one switch the credential truly cannot carry: the job trace.
  ciLogsRead: "whole",
} satisfies SwitchNotes);

const jira = Object.freeze({
  attachmentsRead: "whole",
} satisfies SwitchNotes);

const teamcity = Object.freeze({
  logsRead: "whole",
  artifactsRead: "part",
} satisfies SwitchNotes);

const testit = Object.freeze({
  attachmentsRead: "part",
} satisfies SwitchNotes);

/**
 * The switches the managed credential does not reach, per provider settings
 * slice. A provider that reaches everything its switches offer is absent.
 */
export const SERVICE_REACH = Object.freeze({
  bitrix24,
  gitlab,
  jira,
  teamcity,
  testit,
});

/** Providers with at least one switch to annotate. */
export type ServiceReachProvider = keyof typeof SERVICE_REACH;

/** Switch names one provider's row addresses. */
export type ServiceReachFlag<P extends ServiceReachProvider> =
  keyof (typeof SERVICE_REACH)[P] & string;

/** One row read by a switch name. */
function reachNote(
  row: Readonly<Record<string, ServiceReach>>,
  flag: string,
): string | undefined {
  const reach = row[flag];
  return reach === undefined ? undefined : SERVICE_REACH_NOTE[reach];
}

/**
 * The note one capability switch carries, and only while the deployment hands
 * out managed credentials at all: with the slice off nobody can be refused this
 * way, and the note would be noise on a switch that never meets a service token.
 *
 * The switch is a key of that provider's row, not a free string: a name the
 * table does not hold is a compile error here rather than a note that quietly
 * stopped showing.
 */
export function serviceReachNote<P extends ServiceReachProvider>(
  provider: P,
  flag: ServiceReachFlag<P>,
  serviceSliceEnabled: boolean,
): string | undefined {
  if (!serviceSliceEnabled) return undefined;
  return reachNote(SERVICE_REACH[provider], flag);
}

/**
 * The same note addressed by a toggle's configuration path — `["teamcity",
 * "logsRead"]` — which is how the card reaches it. The card holds no copy of a
 * flag name to mistype: one annotation point reads the table for every switch it
 * renders, so a row this module gains or loses shows on the card by itself, and
 * `tests/client/operator-card.test.tsx` counts the rendered notes against this table.
 */
export function serviceReachNoteForPath(
  path: readonly string[],
  serviceSliceEnabled: boolean,
): string | undefined {
  const [provider, flag] = path;
  if (
    !serviceSliceEnabled ||
    provider === undefined ||
    flag === undefined ||
    !Object.hasOwn(SERVICE_REACH, provider)
  ) {
    return undefined;
  }
  return reachNote(SERVICE_REACH[provider as ServiceReachProvider], flag);
}
