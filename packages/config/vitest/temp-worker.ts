import { inject } from "vitest";
import { TEST_TEMP_CONTEXT } from "./temp-root.js";

const directory = inject(TEST_TEMP_CONTEXT);
if (!directory)
  throw new Error("The shared test temporary directory is missing.");
// os.tmpdir() follows TEMP/TMP on Windows and TMPDIR on POSIX. Tests and the
// subprocesses they start inherit this run's directory instead of the OS root.
process.env.TEMP = directory;
process.env.TMP = directory;
process.env.TMPDIR = directory;
