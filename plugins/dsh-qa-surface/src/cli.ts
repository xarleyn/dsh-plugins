#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  QaAccounts,
  QaAccountsError,
  defaultAccountsFilePath,
} from "./accounts/store.js";
import type { QaAccountRole, QaAccountUserPublic } from "./types.js";

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const defaultIo: CliIo = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

const USAGE = `Usage:
  qa-accounts [--file <path>] list
  qa-accounts [--file <path>] show <email>
  qa-accounts [--file <path>] add <email> --password-stdin [--name <name>] [--role admin|reviewer|user]
  qa-accounts [--file <path>] set-password <email> --password-stdin
  qa-accounts [--file <path>] set-role <email> <admin|reviewer|user>
  qa-accounts [--file <path>] disable <email>     # blocks logins and revokes live tokens
  qa-accounts [--file <path>] enable <email>
  qa-accounts [--file <path>] revoke <email>      # invalidates every issued token
  qa-accounts [--file <path>] profile <email> [--full-name <name>]
      [--identity <key>=<value>]... [--clear-identity <key>]...
      [--instructions-file <path|->] [--clear-full-name] [--clear-instructions]

The accounts file defaults to \\$DSH_HOME/qa-accounts.json. Passwords are read
from stdin (one line) so they never land in shell history; --instructions-file -
reads that text from stdin too. Profile identity keys are free-form here: the
deployment's accounts.profile.identities decides which of them reach the prompt.`;

function readPasswordStdin(): string {
  let password: string;
  try {
    password = readFileSync(0, "utf8");
  } catch (error) {
    throw new Error(
      `could not read the password from stdin: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return password.replace(/\r?\n$/u, "");
}

/** Read the instructions text from a file, or from stdin when the path is "-". */
function readInstructions(path: string, readStdin: () => string): string {
  if (path === "-") return readStdin();
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `could not read the instructions from ${path}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** Print one account's self-declared profile under its `show` header. */
function printProfile(io: CliIo, user: QaAccountUserPublic): void {
  const profile = user.profile;
  io.out(
    `  full name: ${profile.fullName === "" ? "(unset)" : profile.fullName}`,
  );
  const keys = Object.keys(profile.identities);
  if (keys.length === 0) io.out("  identities: (none)");
  for (const key of keys) io.out(`  ${key}: ${profile.identities[key] ?? ""}`);
  if (profile.instructions === "") {
    io.out("  instructions: (none)");
  } else {
    io.out(`  instructions (${profile.instructions.length} characters):`);
    for (const line of profile.instructions.split("\n")) io.out(`    ${line}`);
  }
  io.out(`  updated: ${profile.updatedAt ?? "(never)"}`);
}

/** One `--identity key=value` pair as the command line spelled it. */
interface IdentityFlag {
  readonly key: string;
  readonly value: string;
}

/** Options that consume the following argument. */
const VALUE_OPTIONS = new Set([
  "--file",
  "--name",
  "--role",
  "--full-name",
  "--identity",
  "--clear-identity",
  "--instructions-file",
]);

/** Options that stand alone. */
const FLAG_OPTIONS = new Set([
  "--password-stdin",
  "--clear-full-name",
  "--clear-instructions",
]);

/** Parse one `--identity` argument; the key is normalized like the config's. */
function identityFlag(raw: string): IdentityFlag {
  const separator = raw.indexOf("=");
  const key = separator < 0 ? "" : raw.slice(0, separator).trim().toLowerCase();
  if (key === "") {
    throw new Error("--identity expects <key>=<value>");
  }
  return { key, value: raw.slice(separator + 1) };
}

/** Execute one management command; returns the process exit code. */
export function run(
  argv: readonly string[],
  io: CliIo,
  readStdin: () => string = readPasswordStdin,
): number {
  const positional: string[] = [];
  const options = new Map<string, string>();
  const identities: IdentityFlag[] = [];
  const clearedIdentities: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (FLAG_OPTIONS.has(arg)) {
      options.set(arg.slice(2), "true");
      continue;
    }
    if (VALUE_OPTIONS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      if (arg === "--identity") identities.push(identityFlag(value));
      else if (arg === "--clear-identity")
        clearedIdentities.push(value.trim().toLowerCase());
      else options.set(arg.slice(2), value);
      index += 1;
      continue;
    }
    positional.push(arg);
  }
  const file = options.get("file") ?? defaultAccountsFilePath();
  const [command, first, second] = positional;
  if (command === undefined || command === "help" || command === "--help") {
    io.out(USAGE);
    return command === undefined ? 1 : 0;
  }
  // Management options that only shape minting behavior; the CLI never mints.
  const accounts = new QaAccounts(file, {
    sessionTtlDays: 30,
    allowRegistration: false,
  });
  const requireArgs = (count: number): void => {
    const given = [first, second].filter((value) => value !== undefined).length;
    if (given < count) {
      throw new Error(`the ${command} command requires ${count} argument(s)`);
    }
  };
  switch (command) {
    case "list": {
      const users = accounts.listUsers();
      if (users.length === 0) {
        io.out("no accounts yet");
        return 0;
      }
      for (const user of users) {
        io.out(
          `${user.email}\t${user.displayName}\t${user.role}` +
            `${user.disabled ? "\tdisabled" : ""}` +
            `${user.lastLoginAt === null ? "" : `\tlast login ${user.lastLoginAt}`}`,
        );
      }
      return 0;
    }
    case "add": {
      requireArgs(1);
      if (!options.has("password-stdin")) {
        throw new Error("the add command requires --password-stdin");
      }
      const role = options.get("role");
      if (
        role !== undefined &&
        role !== "admin" &&
        role !== "reviewer" &&
        role !== "user"
      ) {
        throw new Error("--role must be admin, reviewer or user");
      }
      const name = options.get("name");
      const user = accounts.addUser(first as string, readStdin(), {
        ...(name === undefined ? {} : { displayName: name }),
        ...(role === undefined ? {} : { role: role as QaAccountRole }),
      });
      io.out(`added ${user.email} (${user.role})`);
      return 0;
    }
    case "set-password": {
      requireArgs(1);
      if (!options.has("password-stdin")) {
        throw new Error("the set-password command requires --password-stdin");
      }
      const user = accounts.setPassword(first as string, readStdin());
      io.out(`${user.email} password updated; live tokens revoked`);
      return 0;
    }
    case "set-role": {
      requireArgs(2);
      if (second !== "admin" && second !== "reviewer" && second !== "user") {
        throw new Error("role must be admin, reviewer or user");
      }
      const user = accounts.setUserRole(first as string, second);
      io.out(`${user.email} is now ${user.role}`);
      return 0;
    }
    case "disable": {
      requireArgs(1);
      const user = accounts.setUserDisabled(first as string, true);
      io.out(`${user.email} disabled; live tokens revoked`);
      return 0;
    }
    case "enable": {
      requireArgs(1);
      const user = accounts.setUserDisabled(first as string, false);
      io.out(`${user.email} enabled`);
      return 0;
    }
    case "revoke": {
      requireArgs(1);
      const user = accounts.revokeTokens(first as string);
      io.out(`${user.email} tokens revoked`);
      return 0;
    }
    case "show": {
      requireArgs(1);
      const user = accounts.findUser(first as string);
      if (user === undefined) {
        throw new Error(`no account for ${first}`);
      }
      io.out(
        `${user.email}\t${user.displayName}\t${user.role}` +
          `${user.disabled ? "\tdisabled" : ""}`,
      );
      printProfile(io, user);
      return 0;
    }
    case "profile": {
      requireArgs(1);
      const email = first as string;
      const current = accounts.findUser(email);
      if (current === undefined) {
        throw new Error(`no account for ${email}`);
      }
      // Field-level flags merge into the stored profile; anything the command
      // line does not mention keeps its stored value.
      const mergedIdentities: Record<string, string> = {
        ...current.profile.identities,
      };
      for (const key of clearedIdentities) delete mergedIdentities[key];
      for (const identity of identities) {
        mergedIdentities[identity.key] = identity.value;
      }
      const instructionsFile = options.get("instructions-file");
      const instructions = options.has("clear-instructions")
        ? ""
        : instructionsFile === undefined
          ? current.profile.instructions
          : readInstructions(instructionsFile, readStdin);
      const user = accounts.setProfile(email, {
        fullName: options.has("clear-full-name")
          ? ""
          : (options.get("full-name") ?? current.profile.fullName),
        identities: mergedIdentities,
        instructions,
      });
      io.out(`profile updated for ${user.email}`);
      printProfile(io, user);
      return 0;
    }
    default:
      throw new Error(`unknown command ${JSON.stringify(command)}`);
  }
}

export function main(
  argv: readonly string[],
  io: CliIo = defaultIo,
  readStdin: () => string = readPasswordStdin,
): number {
  try {
    return run(argv, io, readStdin);
  } catch (error) {
    io.err(
      `qa-accounts: ${error instanceof QaAccountsError ? `${error.message} (reason: ${error.reason})` : error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
}

/* v8 ignore next */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = main(process.argv.slice(2));
}
