const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "src", "app.js");
const stylesPath = path.join(__dirname, "..", "src", "styles.css");
const appSource = fs.readFileSync(appPath, "utf8");
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  appSource.includes("function createEditFormData("),
  "edits requests should build a fresh FormData body for retries"
);
assert(
  /preferXhr:\s*true/.test(appSource),
  "edits multipart requests should prefer XHR in Photoshop UXP"
);
assert(
  appSource.includes("isMissingImageFileError("),
  "edits requests should detect missing image-file 400s"
);
assert(
  appSource.includes('"image[]"'),
  "edits requests should have an image[] fallback for compatible third-party APIs"
);
assert(
  appSource.includes("CLEAR_PROMPT_CONFIRM_MS") &&
    /function clearPrompts\(event\)/.test(appSource),
  "clear prompt should require a guarded second click to prevent accidental clears"
);
assert(
  /--text-muted:\s*#[a-fA-F0-9]{6};/.test(stylesSource) &&
    !stylesSource.includes("--text-muted: #8e8e8e;"),
  "muted text should be brighter than the old low-contrast gray"
);
assert(
  /\.prompt-input\s*\{[\s\S]*?background:\s*#1b1b1b;/.test(stylesSource) &&
    /\.field-input\s*\{[\s\S]*?background:\s*#1b1b1b;/.test(stylesSource),
  "prompt and field inputs should use high-contrast dark backgrounds"
);

console.log("uxp regression checks passed");
