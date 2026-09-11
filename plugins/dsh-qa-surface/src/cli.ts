#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
  QaAccounts,
  QaAccountsError,
  defaultAccountsFilePath,
} from "./accounts/store.js";

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
  qa-accounts [--file <path>] add <email> --password-stdin [--name <name>] [--role admin|user]
  qa-accounts [--file <path>] set-role <email> <admin|user>
  qa-accounts [--file <path>] disable <email>     # blocks logins and revokes live tokens
  qa-accounts [--file <path>] enable <email>
  qa-accounts [--file <path>] revoke <email>      # invalidates every issued token

The accounts file defaults to \\$DSH_HOME/qa-accounts.json. Passwords are read
from stdin (one line) so they never land in shell history.`;

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

/** Execute one management command; returns the process exit code. */
export function run(
  argv: readonly string[],
  io: CliIo,
  readPassword: () => string = readPasswordStdin,
): number {
  const positional: string[] = [];
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === "--password-stdin") {
      options.set("password-stdin", "true");
      continue;
    }
    if (arg === "--file" || arg === "--name" || arg === "--role") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value`);
      }
      options.set(arg.slice(2), value);
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
      if (role !== undefined && role !== "admin" && role !== "user") {
        throw new Error("--role must be admin or user");
      }
      const name = options.get("name");
      const user = accounts.addUser(first as string, readPassword(), {
        ...(name === undefined ? {} : { displayName: name }),
        ...(role === undefined ? {} : { role: role as "admin" | "user" }),
      });
      io.out(`added ${user.email} (${user.role})`);
      return 0;
    }
    case "set-role": {
      requireArgs(2);
      if (second !== "admin" && second !== "user") {
        throw new Error("role must be admin or user");
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
    default:
      throw new Error(`unknown command ${JSON.stringify(command)}`);
  }
}

export function main(
  argv: readonly string[],
  io: CliIo = defaultIo,
  readPassword: () => string = readPasswordStdin,
): number {
  try {
    return run(argv, io, readPassword);
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
