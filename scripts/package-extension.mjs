import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const projectRoot = process.cwd();
const distRoot = join(projectRoot, "dist");
const releaseRoot = join(projectRoot, "release");
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8")
);
const outputPath = join(releaseRoot, `adcheck-extension-${packageJson.version}.zip`);

mkdirSync(releaseRoot, { recursive: true });

if (existsSync(outputPath)) {
  rmSync(outputPath);
}

execFileSync("zip", ["-qr", outputPath, "."], {
  cwd: distRoot,
  stdio: "inherit"
});
