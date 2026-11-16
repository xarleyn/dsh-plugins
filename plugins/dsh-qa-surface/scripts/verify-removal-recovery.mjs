import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { QaAccounts } from "../lib/accounts/store.js";
import { QaAdminService } from "../lib/admin/service.js";
import { QaQualityStore } from "../lib/admin/quality-store.js";
import { staticSessionLogReader } from "../lib/admin/session-log.js";
import { createSessionPurge } from "../lib/admin/session-purge.js";
import { QaChatSharingStore } from "../lib/chat-sharing/store.js";

const reader = "reader@example.test";
const password = "synthetic-password";
const chat = "fixture-chat";
const transcript = (home) =>
  path.join(home, "sessions", "project", chat, "log");
const script = fileURLToPath(import.meta.url);
function open(home) {
  const accounts = new QaAccounts(path.join(home, "accounts.db"), {
    sessionTtlDays: 1,
    allowRegistration: true,
  });
  const quality = new QaQualityStore(path.join(home, "quality.db"));
  const sharing = new QaChatSharingStore(
    path.join(home, "sharing.db"),
    () => accounts,
  );
  const files = createSessionPurge(
    () => {},
    (error) => {
      throw error;
    },
    home,
  );
  files.recover(accounts);
  return {
    accounts,
    quality,
    sharing,
    files,
    close() {
      sharing.storage.close();
      quality.close();
      accounts.close();
    },
  };
}

async function interrupt(home, cut, purge) {
  const f = open(home);
  const actor = f.accounts.login("admin@example.test", password);
  const target = f.accounts.findUser(reader);
  const admin = new QaAdminService({
    accounts: () => f.accounts,
    quality: () => f.quality,
    sharing: () => f.sharing,
    sessionPurge: f.files,
    sessionLog: staticSessionLogReader({
      sessions: [{ id: chat, createdAt: 1 }],
    }),
    logger: console,
  });
  const exec = DatabaseSync.prototype.exec;
  let commits = 0;
  function kill() {
    writeSync(1, "interrupted at " + cut + "\n");
    process.kill(process.pid, "SIGKILL");
  }
  DatabaseSync.prototype.exec = function (sql) {
    const isCommit =
      sql === "COMMIT" &&
      path.resolve(this.location("main")) === path.resolve(f.accounts.filePath);
    if (isCommit && commits === 0 && cut === "before") kill();
    const result = exec.call(this, sql);
    if (isCommit && String(++commits) === cut) kill();
    return result;
  };
  await admin.deleteUser(actor.token, target.id, purge, 1);
  throw new Error("Process did not reach the requested crash boundary");
}

function scalar(home, dbName, sql) {
  const db = new DatabaseSync(path.join(home, dbName + ".db"), {
    readOnly: true,
  });
  try {
    return Object.values(db.prepare(sql).get())[0];
  } finally {
    db.close();
  }
}

function checkCut(cut, purge) {
  const home = mkdtempSync(path.join(tmpdir(), "qa-crash-recovery-"));
  let f;
  try {
    f = open(home);
    const admin = f.accounts.register("admin@example.test", password);
    const user = f.accounts.register(reader, password);
    const bob = f.accounts.register("other@example.test", password);
    f.accounts.reserveSession(user.token, chat);
    f.sharing.set(user.token, chat, bob.user.email, "read");
    f.sharing.recordAuthor(
      user.token,
      f.sharing.access(user.token, chat),
      "fixture-request",
    );
    f.quality.rateFeedback(
      { conversationId: chat, messageId: "1", userId: user.user.id },
      { rating: "positive" },
    );
    mkdirSync(path.dirname(transcript(home)), { recursive: true });
    writeFileSync(transcript(home), "original history");
    f.close();
    f = undefined;
    const child = spawnSync(
      process.execPath,
      [script, "child", home, cut, String(purge)],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    if (child.error) throw child.error;
    assert.ok(child.signal === "SIGKILL" || child.status !== 0);
    assert.match(
      child.stdout,
      new RegExp("interrupted at " + cut),
      child.stderr,
    );
    // Observe the interrupted state without running the application's recovery.
    const done = cut === "before" ? 0 : Number(cut);
    assert.equal(
      scalar(home, "accounts", "SELECT count(*) FROM qa_account_removals"),
      done >= 1 && done < 6 ? 1 : 0,
    );
    assert.equal(
      scalar(home, "sharing", "SELECT count(*) FROM grants"),
      done >= 2 ? 0 : 1,
    );
    assert.equal(
      scalar(
        home,
        "quality",
        "SELECT count(*) FROM quality_rows WHERE kind='audit'",
      ),
      done >= 3 ? 1 : 0,
    );
    const revisionBefore = scalar(
      home,
      "sharing",
      "SELECT revision FROM revisions",
    );
    f = open(home);
    f.accounts.recoverAccountRemovals();
    f.files.recover(f.accounts);
    assert.equal(f.accounts.whoami(user.token).authenticated, done === 0);
    assert.equal(f.quality.allFeedback().length, done && purge ? 0 : 1);
    const audits = f.quality
      .auditEvents()
      .filter((event) => event.action === "user.deleted");
    assert.equal(audits.length, done ? 1 : 0);
    if (done) {
      assert.equal(audits[0].actorId, admin.user.id);
      assert.equal(audits[0].targetId, user.user.id);
      assert.deepEqual(JSON.parse(audits[0].after), {
        deleteConversations: purge,
        removed: purge ? 1 : 0,
        retained: purge ? 0 : 1,
      });
    }
    assert.equal(
      scalar(home, "sharing", "SELECT count(*) FROM grants"),
      done ? 0 : 1,
    );
    assert.equal(
      f.sharing.requestActor(chat, "fixture-request")?.displayName,
      done
        ? purge
          ? undefined
          : "Удалённый пользователь"
        : user.user.displayName,
    );
    if (done >= 2)
      assert.equal(
        scalar(home, "sharing", "SELECT revision FROM revisions"),
        revisionBefore,
      );
    if (done && purge) assert.equal(existsSync(transcript(home)), false);
    else
      assert.equal(readFileSync(transcript(home), "utf8"), "original history");
    assert.equal(
      scalar(home, "accounts", "SELECT count(*) FROM qa_account_removals"),
      0,
    );
    for (const store of ["quality", "sharing"])
      assert.equal(
        scalar(
          home,
          store,
          "SELECT count(*) FROM qa_meta WHERE key LIKE 'account-removal/%'",
        ),
        0,
      );
  } finally {
    f?.close();
    rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[2] === "child") {
  await interrupt(process.argv[3], process.argv[4], process.argv[5] === "true");
} else {
  for (const purge of [false, true]) {
    for (const cut of ["before", "1", "2", "3", "4", "5", "6"])
      checkCut(cut, purge);
  }
  console.log(
    "account removal recovery: 14 forced process interruptions passed across both deletion modes",
  );
}
