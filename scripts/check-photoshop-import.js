const fs = require("fs");

const js = fs.readFileSync("src/app.js", "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  /async function ensureTargetDocument\(/.test(js) &&
    /await app\.documents\.add/.test(js),
  "import should create a Photoshop document when none is active"
);
assert(
  /async function placeFileAsLayer\(/.test(js) &&
    /_obj:\s*"placeEvent"/.test(js) &&
    /placeEvent 执行后没有新增图层/.test(js),
  "placeEvent path should verify that a new layer was actually created"
);
assert(
  /async function duplicateResultFileAsLayer\(/.test(js) &&
    /sourceDocument = await app\.open\(file\)/.test(js) &&
    /sourceDocument\.duplicateLayers\(sourceLayers, targetDocument\)/.test(js) &&
    /sourceDocument\.closeWithoutSaving\(\)/.test(js),
  "fallback import should open the result file, duplicate its layer, and close the temporary document"
);
assert(
  /async function showPluginAlert\(/.test(js) &&
    /core\.showAlert/.test(js) &&
    /window\.alert/.test(js),
  "import failures should show a visible UXP alert"
);

console.log("photoshop import checks passed");
