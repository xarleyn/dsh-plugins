import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts"],
  sourcemap: true,
  clean: true,
  outDir: "lib",
  dts: false,
});
