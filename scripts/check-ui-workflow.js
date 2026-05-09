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
  html.includes('id="promptOptionsToggleBtn"') &&
    html.includes('id="promptOptionsBody"') &&
    html.includes('id="parameterToggleBtn"') &&
    html.includes('id="parameterBody"') &&
    /promptOptionsBody" class="collapsible-body hidden"/.test(html) &&
    /parameterBody" class="collapsible-body hidden"/.test(html),
  "prompt options and generation settings should be collapsed by default"
);
assert(
  /function bindInputValueGuards\(/.test(js) &&
    /restoreUnexpectedFocusClear\(input\)/.test(js) &&
    /getGuardedInputIds\(\)[\s\S]*promptInput[\s\S]*negativePromptInput[\s\S]*posterTextInput/.test(js),
  "prompt and text inputs should be guarded against UXP focus-time clearing"
);
assert(
  /function updatePanelSummaries\(/.test(js) &&
    /promptOptionsSummary/.test(js) &&
    /parameterSummary/.test(js),
  "collapsed prompt and parameter panels should show useful summaries"
);
assert(
  /confirmPluginAction\("清空当前结果/.test(js) &&
    /confirmPluginAction\("清空所有手动参考图/.test(js) &&
    /confirmPluginAction\("清空本地历史记录索引/.test(js),
  "destructive clear actions should ask for confirmation"
);
assert(
  /empty\.className = "empty-state"/.test(js) &&
    /生成后会显示结果缩略图/.test(js) &&
    /\.thumb-grid \.empty-state/.test(css),
  "result and history grids should show clear empty states"
);
assert(
  /quick-advanced-toggle/.test(css) &&
    /section-toggle/.test(css) &&
    /\.prompt-input:focus,[\s\S]*box-shadow:\s*inset 0 0 0 1px/.test(css),
  "interactive controls should have visible focus and advanced toggle styling"
);
assert(
  /地址已隐藏/.test(js) &&
    /未配置 Key/.test(js),
  "collapsed API summary should make hidden endpoint state clear"
);

console.log("ui workflow checks passed");
