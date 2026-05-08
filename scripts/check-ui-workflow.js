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
  "visible version and asset cache busting must match manifest version"
);
assert(
  html.includes('id="quickAdvancedToggleBtn"') &&
    html.includes('id="quickAdvancedFields"') &&
    /quickAdvancedFields" class="quick-advanced-fields hidden"/.test(html),
  "Base URL should live behind a collapsed advanced connection section"
);
assert(
  /function bindInputValueGuards\(/.test(js) &&
    /restoreUnexpectedFocusClear\(input\)/.test(js) &&
    /getGuardedInputIds\(\)[\s\S]*promptInput[\s\S]*negativePromptInput[\s\S]*posterTextInput/.test(js),
  "prompt and text inputs should be guarded against UXP focus-time clearing"
);
assert(
  /quick-advanced-toggle/.test(css) &&
    /\.prompt-input:focus,[\s\S]*box-shadow:\s*inset 0 0 0 1px/.test(css),
  "interactive controls should have visible focus and advanced toggle styling"
);

console.log("ui workflow checks passed");
