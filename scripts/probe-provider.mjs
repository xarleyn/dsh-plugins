/**
 * Probe one integration provider against a real instance, before or instead of
 * a browser session.
 *
 * The failure this exists for: every gate was green, the provider had been
 * written against a documented API, and the product the deployment actually ran
 * answered a different one — so the tools could never have worked, and nobody
 * found out until somebody sat down with `curl`. A gate cannot see that,
 * because a gate never dials anything. A human can, and this script is what
 * makes it a five-minute job instead of an afternoon of guessing.
 *
 * Two rules make the answer trustworthy:
 *
 * 1. It probes through the provider's **own built code** — its transport, its
 *    catalog paths, its deployment dialect. Nothing here repeats an endpoint, so
 *    the probe cannot drift away from the provider and start lying about it.
 * 2. It never prints what it was given as a credential. The token comes from an
 *    environment variable or a file — never from the command line, which leaks
 *    into shell history and the process list — and every report line passes
 *    through {@link redactProbeText} first.
 *
 * Usage:
 *
 *   pnpm --filter @yadsh/dsh-qa-integrations build
 *   JIRA_PAT=… node scripts/probe-provider.mjs \
 *     --provider=jira --base-url=https://jira.example.corp \
 *     --deployment=server --token-env=JIRA_PAT
 *
 * Exit code 0 means the provider connected, and read if asked; anything else is
 * the provider's own refusal, printed verbatim, because that is exactly what
 * the connect card would have shown.
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const PACKAGE_ROOT = path.join(
  REPOSITORY_ROOT,
  "plugins",
  "dsh-qa-integrations",
);
const BUILT_ENTRY = path.join(PACKAGE_ROOT, "lib", "index.js");

/** What to call to build the package, quoted by every failure that needs it. */
export const BUILD_HINT = "pnpm --filter @yadsh/dsh-qa-integrations build";

/**
 * What the probe needs to know about each provider: which slice of the operator
 * config carries its address, how one is declared, and whether the provider
 * distinguishes Atlassian Cloud from a self-hosted Server / Data Center
 * instance. Everything else — paths, authentication, paging, answer shapes —
 * comes from the provider itself.
 *
 * `identityOperation` names the read that proves address, credential and
 * identity at once; a playbook and its coverage test are written against it, so
 * a new provider cannot quietly ship without one.
 */
export const PROVIDERS = Object.freeze({
  jira: {
    slice: "jira",
    identityOperation: "connection.get",
    addresses: "sites",
    addressField: "baseUrl",
    instanceOption: "siteId",
    deployments: Object.freeze(["cloud", "server"]),
    takesEmail: true,
  },
  confluence: {
    slice: "confluence",
    identityOperation: "connection.get",
    addresses: "instances",
    addressField: "baseUrl",
    instanceOption: "instanceId",
    deployments: Object.freeze(["cloud", "server"]),
    takesEmail: true,
  },
  gitlab: {
    slice: "gitlab",
    identityOperation: "connection.get",
    addresses: "instances",
    addressField: "baseUrl",
    instanceOption: "instanceId",
  },
  testit: {
    slice: "testit",
    identityOperation: "connection.get",
    addresses: "instances",
    addressField: "baseUrl",
    instanceOption: "instanceId",
  },
  weblate: {
    slice: "weblate",
    identityOperation: "connection.get",
    addresses: "instances",
    addressField: "baseUrl",
    instanceOption: "instanceId",
  },
  bitrix24: {
    slice: "bitrix24",
    // Bitrix24 answers a webhook method per read, not a REST path, and the
    // identity one is `user.current`.
    identityOperation: "user.current",
    addresses: "instances",
    addressField: "portal",
    catalogExport: "BITRIX_OPERATIONS",
    /** The credential *is* the webhook URL; `--base-url` is what it names. */
    credentialIsAddress: true,
  },
  teamcity: {
    slice: "teamcity",
    identityOperation: "connection.get",
    single: true,
    addressField: "serverUrl",
    instanceOption: undefined,
  },
});

export function providerNames() {
  return Object.keys(PROVIDERS);
}

/**
 * The catalog export of one provider: `JIRA_OPERATIONS`, `TEAMCITY_OPERATIONS`,
 * … . Two providers do not follow their own directory name — Bitrix24's table
 * is `BITRIX_OPERATIONS` — so the exception is declared in the descriptor
 * rather than guessed from the name.
 */
export function catalogExport(provider) {
  return (
    PROVIDERS[provider]?.catalogExport ?? `${provider.toUpperCase()}_OPERATIONS`
  );
}

const USAGE = `probe one integration provider against a real instance

  node scripts/probe-provider.mjs --provider=<name> --base-url=<url> \\
      --token-env=<ENV_VAR> [--email=<address>] [--deployment=<cloud|server>] \\
      [--op=<operation> [--arg <key>=<json-or-text>] …] [--json]
      [--allow-insecure-http]

  --provider    one of: ${providerNames().join(", ")}
  --base-url    the address the operator would declare for this instance
  --token-env   name of the environment variable holding the token. There is no
                --token: a token on the command line leaks into shell history
                and the process list
  --token-file  read the token from a file instead (a trailing newline is
                ignored)
  --email       account e-mail, for the providers that authenticate with one
  --deployment  Atlassian only: which product answers at this address. Omit it
                and the probe tells you what the instance answered and which
                value to declare
  --op          an operation to read after connecting, e.g. issues.search
                (--arg projectKeys='["PROJ"]' — a project key carries no dash)
  --arg         argument for --op; JSON when it parses as JSON, text otherwise
  --json        print the whole report instead of the summary
  --allow-insecure-http
                development only: dial an http:// address, the same escape
                hatch a stand declares with allowInsecureHttp`;

/** Flags that stand alone: their presence is the value. */
const BOOLEAN_FLAGS = new Set(["json", "allow-insecure-http"]);

/**
 * Parse the command line. Every mistake here belongs to the human, so each one
 * is refused with the flag that fixes it instead of a stack trace.
 */
export function parseProbeArgs(argv) {
  const flags = new Map();
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument "${token}"\n\n${USAGE}`);
    }
    const [name, inline] = token.slice(2).split("=", 2);
    if (name === "arg") {
      const value = inline ?? argv[index + 1];
      if (inline === undefined) index += 1;
      if (value === undefined) throw new Error(`--arg needs <key>=<value>`);
      const at = value.indexOf("=");
      if (at <= 0) throw new Error(`--arg needs <key>=<value>, got "${value}"`);
      args.set(value.slice(0, at), parseValue(value.slice(at + 1)));
      continue;
    }
    if (BOOLEAN_FLAGS.has(name)) {
      flags.set(name, inline ?? "true");
      continue;
    }
    const value = inline ?? argv[index + 1];
    if (inline === undefined) {
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`--${name} needs a value\n\n${USAGE}`);
      }
      index += 1;
    }
    flags.set(name, value ?? "");
  }

  if (flags.has("token")) {
    throw new Error(
      `--token is refused on purpose: pass the token through --token-env, so it stays out of the shell history\n\n${USAGE}`,
    );
  }
  const provider = flags.get("provider") ?? "";
  if (!(provider in PROVIDERS)) {
    throw new Error(
      `--provider must be one of: ${providerNames().join(", ")}\n\n${USAGE}`,
    );
  }
  const baseUrl = flags.get("base-url") ?? "";
  if (baseUrl === "") throw new Error(`--base-url is required\n\n${USAGE}`);
  const tokenEnv = flags.get("token-env");
  const tokenFile = flags.get("token-file");
  if ((tokenEnv === undefined) === (tokenFile === undefined)) {
    throw new Error(
      `give exactly one of --token-env or --token-file\n\n${USAGE}`,
    );
  }
  const description = PROVIDERS[provider];
  const deployment = flags.get("deployment");
  if (deployment !== undefined) {
    const allowed = description.deployments;
    if (allowed === undefined) {
      throw new Error(`--deployment applies to jira and confluence only`);
    }
    if (!allowed.includes(deployment)) {
      throw new Error(`--deployment must be ${allowed.join(" or ")}`);
    }
  }
  return {
    provider,
    description,
    baseUrl,
    tokenEnv,
    tokenFile,
    email: flags.get("email"),
    deployment,
    operation: flags.get("op"),
    args: Object.fromEntries(args),
    json: flags.has("json"),
    allowInsecureHttp: flags.has("allow-insecure-http"),
  };
}

/** A `--arg` value: JSON when it parses, text when it does not. */
export function parseValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * The token, read without ever putting it on a command line. A file is read the
 * way a secret file is written: one value, an optional trailing newline.
 */
export function readToken({ tokenEnv, tokenFile }, environment = process.env) {
  if (tokenEnv !== undefined) {
    const value = environment[tokenEnv];
    if (value === undefined || value.trim() === "") {
      throw new Error(
        `environment variable ${tokenEnv} is unset or empty: export it in this shell first`,
      );
    }
    return value.trim();
  }
  const raw = readFileSync(tokenFile, "utf8").trim();
  if (raw === "") throw new Error(`${tokenFile} is empty`);
  return raw;
}

/**
 * Nothing this script prints may contain the credential: the literal token and
 * any Authorization scheme a lower layer could have logged are masked, so a
 * report can be pasted into an issue.
 */
export function redactProbeText(text, secret) {
  // The schemes go first: a credential that travelled in an Authorization
  // header is masked as a header, and the literal replacement then catches the
  // token anywhere else it might have appeared.
  const masked = String(text).replace(
    /\b(Basic|Bearer|PrivateToken|Token)\s+[A-Za-z0-9._~+/=-]{4,}/gu,
    "$1 <redacted>",
  );
  return secret === undefined || secret === ""
    ? masked
    : masked.split(secret).join("<token>");
}

/**
 * The operator config a probe needs for one address. It mirrors what an operator
 * would declare — including the switches that would otherwise refuse the call
 * before it is made (TeamCity's network policy, Bitrix24's portal allowlist) —
 * because a probe that bypasses those proves nothing about whether a deployment
 * could use the instance.
 */
export function probeConfig({
  provider,
  description,
  baseUrl,
  deployment,
  allowInsecureHttp = false,
}) {
  if (description.single === true) {
    const slice = { [description.addressField]: baseUrl };
    if (allowInsecureHttp) slice.allowInsecureHttp = true;
    if (provider === "teamcity") {
      const url = new URL(baseUrl);
      slice.network = {
        mode: "allowlist",
        allowedHosts: [url.hostname],
        allowedPorts: [Number(url.port === "" ? 443 : url.port)],
        allowHttp: url.protocol === "http:",
      };
    }
    return { [description.slice]: slice };
  }

  const entry = { id: "probe", label: "probe" };
  entry[description.addressField] = baseUrl;
  if (deployment !== undefined) entry.deploymentType = deployment;
  const config = {
    [description.slice]: { [description.addresses]: [entry] },
  };
  if (allowInsecureHttp) {
    config[description.slice].allowInsecureHttp = true;
  }
  if (provider === "bitrix24") {
    // The portal allowlist is a plugin-root knob: the probe mirrors the
    // narrowest suffix that admits this host, which is what an operator would
    // write for their own portal.
    const labels = new URL(baseUrl).hostname.split(".");
    config.allowedPortalSuffixes = [`.${labels.slice(-2).join(".")}`];
  }
  return config;
}

/** The built provider class, imported by path: the package has no self-link. */
export async function loadProvider(entry, provider) {
  let module;
  try {
    module = await import(pathToFileURL(entry).href);
  } catch (error) {
    throw new Error(
      `cannot load the built package (${BUILD_HINT} first): ${error.message}`,
      { cause: error },
    );
  }
  const name = `${provider[0]?.toUpperCase() ?? ""}${provider.slice(1)}Provider`;
  const provider_class = module[name] ?? module.default;
  if (typeof provider_class !== "function") {
    throw new Error(
      `the built package exports no provider class for ${provider}`,
    );
  }
  return provider_class;
}

/**
 * The paths the provider will call for an operation, read out of its own
 * catalog. Printed before the call, so a human sees which product's endpoints
 * this provider believes in.
 */
export async function catalogPaths(provider, operation) {
  const catalog = await import(
    pathToFileURL(
      path.join(PACKAGE_ROOT, "lib", "providers", provider, "catalog.js"),
    ).href
  );
  const operations = catalog[catalogExport(provider)];
  if (operations === undefined) return [];
  const definition = operations[operation];
  if (definition === undefined) {
    return [];
  }
  return [definition.path, definition.serverPath].filter(
    (item) => typeof item === "string",
  );
}

/**
 * The probe's dialer: a fetch-shaped function that opens one connection per
 * request and closes it.
 *
 * Node's own `fetch` keeps the socket alive after the answer, and a Node process
 * torn down around a live keep-alive socket trips a libuv assertion on Windows:
 * the probe printed its whole report and still exited 127, breaking the one
 * thing a caller reads — the exit code. Asking for `connection: close` does not
 * help, because the Fetch standard forbids that header and undici drops it
 * silently. So the probe dials with `node:http`/`node:https`, `agent: false`,
 * and hands the provider a real `Response`.
 *
 * What is probed does not change: the provider's own transport runs unchanged on
 * top of this dialer, so its catalog paths, its authentication and its parsing
 * are still what answer. A redirect is refused here for the same reason the
 * provider asks for `redirect: "error"` — a credential must never travel to
 * another origin.
 */
export function probeFetcher() {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const answer = await new Promise((resolve, reject) => {
      const request = send(
        url,
        {
          method: init.method ?? "GET",
          headers: { ...(init.headers ?? {}) },
          agent: false,
          ...(init.signal === undefined ? {} : { signal: init.signal }),
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () =>
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
          response.on("error", reject);
        },
      );
      request.on("error", reject);
      request.end();
    });

    if (answer.status >= 300 && answer.status < 400) {
      throw new Error(`refusing to follow a redirect (${answer.status})`);
    }
    const headers = {};
    for (const [name, value] of Object.entries(answer.headers)) {
      // Hop-by-hop headers describe the socket we are closing, not the answer.
      if (name === "connection" || name === "transfer-encoding") continue;
      if (typeof value === "string") headers[name] = value;
    }
    return new Response(
      answer.status === 204 || answer.status === 304 ? null : answer.body,
      { status: answer.status, headers },
    );
  };
}

/**
 * Which product an Atlassian address answers, asked **without a credential**.
 *
 * This is the question the whole script exists for, and it has to be answerable
 * before anything is configured: `serverInfo` is public on a Server / Data
 * Center instance, and Cloud answers the same read behind its own root. When
 * neither answers — a proxy in front, an older tenant — the probe says nothing
 * and asks for `--deployment` instead of guessing.
 */
export async function detectDeploymentType(provider, baseUrl, fetcher = fetch) {
  if (provider !== "jira" && provider !== "confluence") return undefined;
  const roots = [
    { root: "/rest/api/2/serverInfo", product: "server" },
    { root: "/rest/api/3/serverInfo", product: "cloud" },
  ];
  for (const candidate of roots) {
    let answer;
    try {
      const response = await fetcher(new URL(`${baseUrl}${candidate.root}`), {
        headers: { accept: "application/json" },
        redirect: "error",
      });
      if (!response.ok) continue;
      answer = await response.json();
    } catch {
      continue;
    }
    const deploymentType = answer?.deploymentType;
    return {
      deploymentType:
        typeof deploymentType === "string" && deploymentType !== ""
          ? deploymentType
          : undefined,
      product: candidate.product,
    };
  }
  return undefined;
}

/** A bounded, value-free view of an answer: enough to judge a shape by eye. */
export function summarize(value, depth = 0) {
  if (Array.isArray(value)) {
    return {
      array: value.length,
      of: value.length === 0 ? [] : [summarize(value[0], depth + 1)],
    };
  }
  if (typeof value === "object" && value !== null) {
    if (depth >= 2) return { object: Object.keys(value).length };
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([key, item]) => [key, summarize(item, depth + 1)]),
    );
  }
  return typeof value;
}

/**
 * The actionable line for a refused connect. The Atlassian providers answer a
 * declared product mismatch with the value that fixes it, and the probe passes
 * that on as the next command to run — that message is the whole reason this
 * script exists.
 */
export function mismatchHint(provider, message, baseUrl) {
  const answers = /answers "([^"]+)"/u.exec(message);
  if (answers === null) return undefined;
  const answered = answers[1];
  const wanted = answered === "Cloud" ? "cloud" : "server";
  return [
    `the instance answers "${answered}" — re-run with --deployment=${wanted}:`,
    `  node scripts/probe-provider.mjs --provider=${provider} --base-url=${baseUrl} --deployment=${wanted} --token-env=<ENV_VAR>`,
  ].join("\n");
}

/** The human summary: connect facts, then the shape of what was read. */
export function formatSummary(report) {
  const lines = [
    `connected:    ${report.displayName} (${report.externalUserId || "no account id"})`,
    `tenant:       ${report.tenantId}`,
    `declared:     ${report.declared}`,
    `capabilities: ${report.capabilities.length}`,
  ];
  if (report.operation !== undefined) {
    lines.push(
      `operation:    ${report.operation} → ${JSON.stringify(report.answer)}`,
    );
  }
  lines.push("(full report: add --json)");
  return lines.join("\n");
}

async function main() {
  const options = parseProbeArgs(process.argv.slice(2));
  const dialer = probeFetcher();
  const detected = await detectDeploymentType(
    options.provider,
    options.baseUrl,
    dialer,
  );
  if (detected !== undefined) {
    const root = detected.product === "server" ? "/rest/api/2" : "/rest/api/3";
    process.stdout.write(
      `the instance answers "${detected.deploymentType ?? detected.product}" (${root})\n`,
    );
    if (options.deployment === undefined) {
      options.deployment = detected.product;
      process.stdout.write(
        `declaring deploymentType: ${detected.product} for this probe\n`,
      );
    } else if (options.deployment !== detected.product) {
      process.stdout.write(
        `WARNING: this probe declares ${options.deployment} while the instance answers ${detected.product}\n`,
      );
    }
  }
  const secret = readToken(options);
  const Provider = await loadProvider(BUILT_ENTRY, options.provider);
  const configModule = await import(pathToFileURL(BUILT_ENTRY).href);

  const instance = new Provider(
    configModule.resolveConfig(probeConfig(options)),
    dialer,
  );
  const credentialOptions = {};
  if (options.description.instanceOption !== undefined) {
    credentialOptions[options.description.instanceOption] = "probe";
  }
  if (options.description.takesEmail === true && options.email !== undefined) {
    credentialOptions.email = options.email;
  }
  const credential = instance.parseCredential(
    options.description.credentialIsAddress === true ? options.baseUrl : secret,
    credentialOptions,
  );

  let connected;
  try {
    connected = await instance.validate({
      credential: credential.credential,
      credentialSource: "personal",
    });
  } catch (error) {
    const hint = mismatchHint(options.provider, error.message, options.baseUrl);
    throw new Error(
      redactProbeText(
        hint === undefined ? error.message : `${error.message}\n\n${hint}`,
        secret,
      ),
      { cause: error },
    );
  }

  const report = {
    provider: options.provider,
    address: options.baseUrl,
    declared: options.deployment ?? "cloud",
    portal: credential.portal,
    tenantId: connected.tenantId,
    externalUserId: connected.externalUserId,
    displayName: connected.displayName,
    capabilities: connected.capabilities,
  };

  if (options.operation !== undefined) {
    const paths = await catalogPaths(options.provider, options.operation);
    if (!options.json) {
      process.stdout.write(
        `paths this provider will call for ${options.operation}: ${paths.join(" | ")}\n`,
      );
    }
    const answer = await instance.execute(
      {
        credential: credential.credential,
        externalUserId: connected.externalUserId,
        credentialSource: "personal",
        serviceBoundary: undefined,
      },
      options.operation,
      options.args,
    );
    report.operation = options.operation;
    report.answer = summarize(answer);
  }

  const text = redactProbeText(JSON.stringify(report, null, 2), secret);
  process.stdout.write(
    options.json ? `${text}\n` : `${formatSummary(report)}\n`,
  );
  // An agent keep-alive socket outlives the fetch that opened it, and on
  // Windows tearing the process down around one trips a libuv assertion. The
  // report is written; there is nothing left to wait for.
  process.exit(0);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}
