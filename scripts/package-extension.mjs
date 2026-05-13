import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const projectRoot = process.cwd();
const distRoot = join(projectRoot, "dist");
const releaseRoot = join(projectRoot, "release");
const packageJson = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8")
);
const outputPath = join(releaseRoot, `adcheck-extension-${packageJson.version}.zip`);
const packageRoot = mkdtempSync(join(tmpdir(), "adcheck-package-"));
const packagedDistRoot = join(packageRoot, "dist");
const buildInfoPath = join(packagedDistRoot, "shared", "build-info.js");

mkdirSync(releaseRoot, { recursive: true });

if (existsSync(outputPath)) {
  rmSync(outputPath);
}

cpSync(distRoot, packagedDistRoot, { recursive: true });

if (existsSync(buildInfoPath)) {
  const buildInfoSource = readFileSync(buildInfoPath, "utf8");
  writeFileSync(
    buildInfoPath,
    buildInfoSource.replace("AdCheckShared.IS_DEV_BUILD = true", "AdCheckShared.IS_DEV_BUILD = false")
  );
}

execFileSync("zip", ["-qr", outputPath, "."], {
  cwd: packagedDistRoot,
  stdio: "inherit"
});

rmSync(packageRoot, { recursive: true, force: true });
