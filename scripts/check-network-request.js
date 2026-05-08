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
  source.includes("function isAbortError("),
  "sendRequest should detect AbortError separately from network failures"
);
assert(
  source.includes("function makeTimeoutError("),
  "sendRequest should report timeout errors without retrying the request"
);
assert(
  /requestTimedOut\s*=\s*true;\s*controller\.abort\(\);/s.test(source),
  "the timeout handler should mark the request as timed out before aborting fetch"
);
assert(
  /if\s*\(\s*requestTimedOut\s*\|\|\s*isAbortError\(fetchError\)\s*\)\s*\{\s*throw makeTimeoutError/s.test(source),
  "fetch aborts should throw the timeout error before the XHR fallback path"
);

const sendRequestBody = source.match(/async function sendRequest[\s\S]*?\n}\n\nfunction sendXhrRequest/);
assert(sendRequestBody, "could not locate sendRequest body");
const abortCheckIndex = sendRequestBody[0].indexOf("isAbortError(fetchError)");
const xhrFallbackIndex = sendRequestBody[0].lastIndexOf("catch (xhrError)");
assert(
  abortCheckIndex !== -1 && xhrFallbackIndex !== -1 && abortCheckIndex < xhrFallbackIndex,
  "AbortError handling must happen before the fetch fallback catches XHR errors"
);

console.log("network request checks passed");
