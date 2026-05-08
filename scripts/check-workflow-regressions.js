const fs = require("fs");

const html = fs.readFileSync("index.html", "utf8");
const js = fs.readFileSync("src/app.js", "utf8");
const css = fs.readFileSync("src/styles.css", "utf8");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  html.includes(`src/styles.css?v=${manifest.version}`) &&
    html.includes(`src/app.js?v=${manifest.version}`) &&
    html.includes(`v${manifest.version}`),
  "index.html should show the manifest version and version CSS/JS URLs so UXP reloads fresh assets"
);
assert(
  !html.includes('id="clearPromptBtn"') &&
    !js.includes("clearPromptBtn") &&
    !js.includes("function clearPrompts") &&
    !js.includes("clearPromptArmedUntil"),
  "the destructive clear-prompt control and handlers should be removed"
);
assert(
  /const imported = await importGeneratedResult\(stamped\[0\], \{ manageBusy: false \}\)/.test(js) &&
    /自动导入失败/.test(js) &&
    /showPluginAlert/.test(js),
  "generation should automatically import the first result into Photoshop and report import failure honestly"
);
assert(
  /async function placeFileAsLayer\(/.test(js) &&
    /async function duplicateResultFileAsLayer\(/.test(js) &&
    /sourceDocument = await app\.open\(file\)/.test(js) &&
    /duplicateLayers\(sourceLayers, targetDocument\)/.test(js),
  "Photoshop import should fall back from placeEvent to opening and duplicating a result layer"
);
assert(
  /addHistoryRecord\(record\)/.test(js),
  "saving history should update in-memory history so the History tab has thumbnails immediately"
);
assert(
  /function addHistoryRecord\(/.test(js),
  "history should have a helper that upserts records with b64 preview data"
);
assert(
  /input:disabled,\s*\nselect:disabled,\s*\ntextarea:disabled/.test(css) &&
    /-webkit-text-fill-color:\s*var\(--text-soft\)/.test(css),
  "disabled inputs should remain legible in UXP dark panels"
);
assert(
  /\.checkbox-line,\s*\n\.checkbox-line span/.test(css) &&
    /color:\s*#f2f5f8/.test(css) &&
    /-webkit-text-fill-color:\s*#ffffff/.test(css),
  "checkbox labels should use high-contrast foreground text"
);
assert(
  /v0\.1\.22: final UXP contrast guard/.test(css) &&
    /input::placeholder,\s*\ntextarea::placeholder/.test(css) &&
    /\.section-label,[\s\S]*\.version-inline[\s\S]*-webkit-text-fill-color:\s*var\(--text-soft\)/.test(css),
  "UXP contrast guard should cover secondary labels, placeholders, and version text"
);

console.log("workflow regression checks passed");
