import { copyFile, mkdir } from "node:fs/promises";

const source = new URL("../src/client.js", import.meta.url);
const outputDirectory = new URL("../lib/", import.meta.url);
const output = new URL("client.js", outputDirectory);

await mkdir(outputDirectory, { recursive: true });
await copyFile(source, output);

process.stdout.write("build-client: generated lib/client.js from src/client.js\n");
