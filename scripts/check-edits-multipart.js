const fs = require("fs");
const path = require("path");

const appPath = path.join(__dirname, "..", "src", "app.js");
const source = fs.readFileSync(appPath, "utf8");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

assert(
  source.includes("function appendEditImageFiles("),
  "edits requests should use appendEditImageFiles() for image multipart fields"
);
assert(
  source.includes("async function createMultipartImageFile("),
  "multipart image uploads should create UXP File objects for Photoshop FormData"
);
assert(
  source.includes('createEditFormData(settings, prompt, imageB64, maskB64, extraImages, requestSize, "image")'),
  'edits requests should first upload source and reference files with the multipart "image" field'
);
assert(
  source.includes('createEditFormData(settings, prompt, imageB64, maskB64, extraImages, requestSize, "image[]")'),
  'edits requests should retry with the multipart "image[]" field for third-party compatibility'
);
assert(
  /file\.write\(base64ToArrayBuffer\(stripDataUrl\(b64\)\),\s*\{\s*format:\s*storage\.formats\.binary\s*\}\)/.test(source),
  "generated edit images should be written to temporary UXP files before FormData upload"
);
assert(
  /file,/.test(source),
  "manual reference images should keep their UXP File object for FormData upload"
);

console.log("edits multipart checks passed");
