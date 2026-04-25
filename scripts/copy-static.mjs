import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const distRoot = join(projectRoot, "dist");

mkdirSync(distRoot, { recursive: true });

const entries = [
  ["manifest.json", "manifest.json"],
  ["popup.html", "popup.html"],
  ["styles.css", "styles.css"],
  ["icons", "icons"]
];

for (const [sourceName, targetName] of entries) {
  const sourcePath = join(projectRoot, sourceName);
  if (!existsSync(sourcePath)) {
    continue;
  }

  cpSync(sourcePath, join(distRoot, targetName), { recursive: true });
}
