const photoshop = require("photoshop");
const uxp = require("uxp");

const { app, action, core } = photoshop;
const imaging = photoshop.imaging;
const { localFileSystem, formats } = uxp.storage;

const els = {
  baseUrl: document.getElementById("baseUrl"),
  endpointPath: document.getElementById("endpointPath"),
  model: document.getElementById("model"),
  apiKey: document.getElementById("apiKey"),
  rememberKey: document.getElementById("rememberKey"),
  forgetKey: document.getElementById("forgetKey"),
  sourceMode: document.getElementById("sourceMode"),
  prompt: document.getElementById("prompt"),
  size: document.getElementById("size"),
  quality: document.getElementById("quality"),
  background: document.getElementById("background"),
  extraJson: document.getElementById("extraJson"),
  requestUrl: document.getElementById("requestUrl"),
  generate: document.getElementById("generate"),
  status: document.getElementById("status"),
  preview: document.getElementById("preview")
};

const KEY_STORAGE = "openai-ps-api-key";
const SETTINGS_STORAGE = "openai-ps-provider-settings";

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function updateRequestUrlPreview() {
  const baseUrl = els.baseUrl.value.trim();
  const endpointPath = els.endpointPath.value.trim();
  if (!baseUrl) {
    els.requestUrl.textContent = "Request URL: -";
    return;
  }
  try {
    const url = els.sourceMode && els.sourceMode.value !== "text"
      ? normalizeEditUrl(baseUrl)
      : normalizeUrl(baseUrl, endpointPath);
    els.requestUrl.textContent = `Request URL: ${url}`;
  } catch (error) {
    els.requestUrl.textContent = "Request URL: invalid";
  }
}

function base64ToArrayBuffer(base64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(base64 || "").replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
  let bufferLength = clean.length * 0.75;

  if (clean.endsWith("==")) {
    bufferLength -= 2;
  } else if (clean.endsWith("=")) {
    bufferLength -= 1;
  }

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let index = 0; index < clean.length; index += 4) {
    const encoded1 = chars.indexOf(clean[index]);
    const encoded2 = chars.indexOf(clean[index + 1]);
    const encoded3 = chars.indexOf(clean[index + 2]);
    const encoded4 = chars.indexOf(clean[index + 3]);
    const bitmap = (encoded1 << 18) | (encoded2 << 12) | ((encoded3 & 63) << 6) | (encoded4 & 63);

    if (p < bufferLength) {
      bytes[p++] = (bitmap >> 16) & 255;
    }
    if (p < bufferLength) {
      bytes[p++] = (bitmap >> 8) & 255;
    }
    if (p < bufferLength) {
      bytes[p++] = bitmap & 255;
    }
  }

  return bytes.buffer;
}

function normalizeUrl(baseUrl, endpointPath) {
  const url = baseUrl.replace(/\/+$/, "");
  let endpoint = endpointPath.trim() || "/v1/images/generations";
  if (!endpoint.startsWith("/")) {
    endpoint = `/${endpoint}`;
  }
  if (endpoint.startsWith("/images/")) {
    endpoint = `/v1${endpoint}`;
  }

  const knownEndpoints = [
    "/v1/images/generations",
    "/v1/images/edits",
    "/v1/responses"
  ];

  for (const known of knownEndpoints) {
    if (url.endsWith(known)) {
      return `${url.slice(0, -known.length)}${endpoint}`;
    }
  }

  if (url.endsWith("/v1/images")) {
    if (endpoint.startsWith("/v1/images/")) {
      return `${url}${endpoint.slice("/v1/images".length)}`;
    }
    return `${url.slice(0, -"/v1/images".length)}${endpoint}`;
  }

  if (url.endsWith("/v1")) {
    if (endpoint.startsWith("/v1/")) {
      return `${url}${endpoint.slice("/v1".length)}`;
    }
    return `${url}${endpoint}`;
  }

  return `${url}${endpoint}`;
}

function normalizeEditUrl(baseUrl) {
  return normalizeUrl(baseUrl, "/v1/images/edits");
}

function parseExtraJson() {
  const raw = els.extraJson.value.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Extra JSON must be an object.");
    }
    return parsed;
  } catch (error) {
    throw new Error(`Extra JSON is invalid: ${error.message}`);
  }
}

function loadStoredKey() {
  const stored = localStorage.getItem(KEY_STORAGE);
  if (stored) {
    els.apiKey.value = stored;
    els.rememberKey.checked = true;
  }

  const settings = localStorage.getItem(SETTINGS_STORAGE);
  if (settings) {
    try {
      const parsed = JSON.parse(settings);
      els.baseUrl.value = parsed.baseUrl || els.baseUrl.value;
      els.endpointPath.value = parsed.endpointPath || els.endpointPath.value;
      els.model.value = parsed.model || els.model.value;
      if (els.endpointPath.value.trim().startsWith("/images/")) {
        els.endpointPath.value = `/v1${els.endpointPath.value.trim()}`;
      }
    } catch (error) {
      localStorage.removeItem(SETTINGS_STORAGE);
    }
  }
}

function saveKeyIfRequested(apiKey) {
  if (els.rememberKey.checked) {
    localStorage.setItem(KEY_STORAGE, apiKey);
    localStorage.setItem(SETTINGS_STORAGE, JSON.stringify({
      baseUrl: els.baseUrl.value.trim(),
      endpointPath: els.endpointPath.value.trim(),
      model: els.model.value.trim()
    }));
  } else {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(SETTINGS_STORAGE);
  }
}

async function generateImage(apiKey, prompt, options) {
  const body = {
    model: options.model,
    prompt,
    n: 1,
    ...options.extra
  };

  if (options.size !== "auto") {
    body.size = options.size;
  }

  if (options.quality !== "auto") {
    body.quality = options.quality;
  }

  if (options.background !== "auto") {
    body.background = options.background;
  }

  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json();

  if (!response.ok) {
    const detail = payload && payload.error && payload.error.message
      ? payload.error.message
      : `OpenAI request failed with HTTP ${response.status}`;
    throw new Error(detail);
  }

  return imageValueToResult(findImageValue(payload));
}

async function generateImageEdit(apiKey, prompt, options) {
  const referenceFile = await exportReferencePng(options.sourceMode);
  const form = new FormData();

  form.append("model", options.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("image", referenceFile, "reference.jpg");

  if (options.size !== "auto") {
    form.append("size", options.size);
  }
  if (options.quality !== "auto") {
    form.append("quality", options.quality);
  }
  if (options.background !== "auto") {
    form.append("background", options.background);
  }

  const extra = options.extra || {};
  for (const key of Object.keys(extra)) {
    const value = extra[key];
    if (value === undefined || value === null) {
      continue;
    }
    form.append(key, typeof value === "string" ? value : JSON.stringify(value));
  }

  const response = await fetch(options.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const payload = await response.json();
  if (!response.ok) {
    const detail = payload && payload.error && payload.error.message
      ? payload.error.message
      : `Image edit request failed with HTTP ${response.status}`;
    throw new Error(detail);
  }

  return imageValueToResult(findImageValue(payload));
}

async function exportReferencePng(sourceMode) {
  if (!app.documents.length) {
    throw new Error("Open a Photoshop document before using a reference source.");
  }

  const folder = await localFileSystem.getDataFolder();
  const file = await folder.createFile("openai-ps-reference.jpg", { overwrite: true });

  if (!imaging || typeof imaging.getPixels !== "function") {
    throw new Error("This Photoshop version does not expose the imaging API needed to export a reference image.");
  }

  const documentId = app.activeDocument.id;
  const options = {
    documentID: documentId,
    targetSize: {
      width: Math.min(app.activeDocument.width, 1536),
      height: Math.min(app.activeDocument.height, 1536)
    },
    componentSize: 8,
    applyAlpha: true,
    colorSpace: "RGB"
  };

  if (sourceMode === "activeLayer") {
    const layer = app.activeDocument.activeLayers && app.activeDocument.activeLayers[0];
    if (!layer) {
      throw new Error("Select a layer before using Active layer reference.");
    }
    options.layerID = layer.id;
  }

  const pixels = await imaging.getPixels(options);
  const base64Jpeg = await imaging.encodeImageData({
    imageData: pixels.imageData,
    base64: true
  });
  await file.write(base64ToArrayBuffer(base64Jpeg), { format: formats.binary });
  if (pixels.imageData && typeof pixels.imageData.dispose === "function") {
    pixels.imageData.dispose();
  }
  return file;
}

function findImageValue(payload) {
  const seen = [];

  function visit(value) {
    if (!value || typeof value !== "object") {
      return null;
    }

    if (Array.isArray(value)) {
      for (const child of value) {
        const found = visit(child);
        if (found) {
          return found;
        }
      }
      return null;
    }

    for (const key of ["b64_json", "url", "image_url", "result"]) {
      const item = value[key];
      if (typeof item === "string" && looksLikeImageValue(item, key)) {
        return item.trim();
      }
    }

    for (const child of Object.values(value)) {
      if (child && typeof child === "object" && !seen.includes(child)) {
        seen.push(child);
        const found = visit(child);
        if (found) {
          return found;
        }
      }
    }

    return null;
  }

  const found = visit(payload);
  if (!found) {
    throw new Error("The image API response did not contain b64_json, url, image_url, or result.");
  }
  return found;
}

function looksLikeImageValue(value, key) {
  const text = value.trim();
  return Boolean(
    text &&
    (
      key === "b64_json" ||
      key === "result" ||
      text.startsWith("data:image") ||
      text.startsWith("http://") ||
      text.startsWith("https://") ||
      text.length > 200
    )
  );
}

async function imageValueToResult(value) {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const imageResponse = await fetch(value);
    if (!imageResponse.ok) {
      throw new Error(`Generated image URL could not be downloaded: HTTP ${imageResponse.status}`);
    }
    return {
      arrayBuffer: await imageResponse.arrayBuffer(),
      previewSrc: value
    };
  }

  if (value.startsWith("data:image")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) {
      throw new Error("Image data URL is invalid.");
    }
    const base64 = value.slice(commaIndex + 1);
    return {
      arrayBuffer: base64ToArrayBuffer(base64),
      previewSrc: value
    };
  }

  return {
    arrayBuffer: base64ToArrayBuffer(value.replace(/\s+/g, "")),
    previewSrc: `data:image/png;base64,${value}`
  };
}

async function writeTempPng(arrayBuffer) {
  const folder = await localFileSystem.getDataFolder();
  const file = await folder.createFile("openai-ps-generated.png", { overwrite: true });
  await file.write(arrayBuffer, { format: formats.binary });
  return file;
}

async function placeFileAsLayer(file) {
  if (!app.documents.length) {
    throw new Error("Open or create a Photoshop document before generating a layer.");
  }

  const token = await localFileSystem.createSessionToken(file);

  const placeGeneratedFile = async () => {
    await action.batchPlay(
      [
        {
          _obj: "placeEvent",
          null: {
            _path: token,
            _kind: "local"
          },
          freeTransformCenterState: {
            _enum: "quadCenterState",
            _value: "QCSAverage"
          },
          _options: {
            dialogOptions: "dontDisplay"
          }
        }
      ],
      {}
    );
  };

  if (core && typeof core.executeAsModal === "function") {
    await core.executeAsModal(placeGeneratedFile, { commandName: "Place OpenAI generated image" });
  } else {
    await placeGeneratedFile();
  }
}

async function onGenerate() {
  const baseUrl = els.baseUrl.value.trim();
  const endpointPath = els.endpointPath.value.trim();
  const model = els.model.value.trim();
  const apiKey = els.apiKey.value.trim();
  const prompt = els.prompt.value.trim();

  if (!baseUrl || !model || (els.sourceMode.value === "text" && !endpointPath)) {
    setStatus("Enter Base URL, Endpoint, and Model first.", true);
    return;
  }

  if (!apiKey) {
    setStatus("Enter your API key first.", true);
    return;
  }

  if (!prompt) {
    setStatus("Enter a prompt first.", true);
    return;
  }

  els.generate.disabled = true;
  setStatus("Generating image...");

  try {
    saveKeyIfRequested(apiKey);
    const isEditMode = els.sourceMode.value !== "text";
    const requestUrl = isEditMode ? normalizeEditUrl(baseUrl) : normalizeUrl(baseUrl, endpointPath);
    const options = {
      url: requestUrl,
      model,
      size: els.size.value,
      quality: els.quality.value,
      background: els.background.value,
      extra: parseExtraJson(),
      sourceMode: els.sourceMode.value
    };
    const result = isEditMode
      ? await generateImageEdit(apiKey, prompt, options)
      : await generateImage(apiKey, prompt, options);

    els.preview.src = result.previewSrc;
    els.preview.style.display = "block";

    setStatus("Writing PNG into the plugin data folder...");
    const file = await writeTempPng(result.arrayBuffer);

    setStatus("Placing generated image into Photoshop...");
    await placeFileAsLayer(file);

    setStatus("Done. The generated image was placed as a new layer.");
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (/network request failed/i.test(message)) {
      setStatus("Network request failed. Reload the plugin after manifest changes; also check provider URL, proxy, firewall, and HTTPS certificate.", true);
    } else {
      setStatus(message, true);
    }
  } finally {
    els.generate.disabled = false;
  }
}

els.generate.addEventListener("click", onGenerate);
els.forgetKey.addEventListener("click", () => {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(SETTINGS_STORAGE);
  els.apiKey.value = "";
  els.rememberKey.checked = false;
  setStatus("Stored API key removed.");
});

loadStoredKey();
updateRequestUrlPreview();

els.baseUrl.addEventListener("input", updateRequestUrlPreview);
els.endpointPath.addEventListener("input", updateRequestUrlPreview);
els.sourceMode.addEventListener("change", updateRequestUrlPreview);
els.endpointPath.addEventListener("blur", () => {
  const endpoint = els.endpointPath.value.trim();
  if (endpoint.startsWith("/images/")) {
    els.endpointPath.value = `/v1${endpoint}`;
    updateRequestUrlPreview();
  }
});
