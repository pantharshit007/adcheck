import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = process.cwd();
const distRoot = join(projectRoot, "dist");

mkdirSync(distRoot, { recursive: true });

const entries = [
  ["manifest.json", "manifest.json"],
  ["popup.html", "popup.html"],
  ["styles.css", "styles.css"],
  ["page.css", "page.css"],
  ["icons", "icons"]
];

for (const [sourceName, targetName] of entries) {
  const sourcePath = join(projectRoot, sourceName);
  if (!existsSync(sourcePath)) {
    continue;
  }

  cpSync(sourcePath, join(distRoot, targetName), { recursive: true });
}

const widgetCssPath = join(projectRoot, "widget.css");
if (existsSync(widgetCssPath)) {
  const sharedDir = join(distRoot, "shared");
  mkdirSync(sharedDir, { recursive: true });
  const widgetCss = readFileSync(widgetCssPath, "utf8");
  writeFileSync(
    join(sharedDir, "widget-styles.js"),
    `var AdCheckShared = AdCheckShared || {};\nAdCheckShared.WIDGET_CSS = ${JSON.stringify(widgetCss)};\n`,
    "utf8"
  );
}
