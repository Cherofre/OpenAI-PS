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
  source.includes("function createMultipartImageFile("),
  "multipart image uploads should create File objects when the runtime supports them"
);
assert(
  !source.includes('form.append("image[]"'),
  'edits requests must not upload images with the non-standard "image[]" field'
);
assert(
  /appendMultipartFile\(form,\s*"image"/.test(source),
  'edits requests should append source and reference files with the multipart "image" field'
);
assert(
  /new File\(\[blob\],\s*fileName,\s*\{\s*type:\s*mimeType\s*\}\)/.test(source),
  "multipart image uploads should prefer File([blob], fileName, { type }) for UXP compatibility"
);

console.log("edits multipart checks passed");
