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

try {
  if (!existsSync(buildInfoPath)) {
    throw new Error(`Missing build info file at ${buildInfoPath}`);
  }

  const buildInfoSource = readFileSync(buildInfoPath, "utf8");
  const replacedBuildInfoSource = buildInfoSource.replace(
    "AdCheckShared.IS_DEV_BUILD = true",
    "AdCheckShared.IS_DEV_BUILD = false",
  );

  if (replacedBuildInfoSource === buildInfoSource) {
    throw new Error(`Failed to replace dev flag in ${buildInfoPath}`);
  }

  writeFileSync(buildInfoPath, replacedBuildInfoSource);

  execFileSync("zip", ["-qr", outputPath, "."], {
    cwd: packagedDistRoot,
    stdio: "inherit"
  });
} finally {
  rmSync(packageRoot, { recursive: true, force: true });
}
