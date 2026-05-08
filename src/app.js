const photoshop = require("photoshop");
const { entrypoints, storage } = require("uxp");

const app = photoshop.app;
const action = photoshop.action;
const core = photoshop.core;
const fs = storage.localFileSystem;

entrypoints.setup({
  panels: {
    openaiPanel: {
      show() {},
      hide() {},
    },
  },
});

const HISTORY_KEY = "openaiPhotoshop.history.v1";
const SETTINGS_KEY = "openaiPhotoshop.settings.v1";
const DEFAULT_BASE_URL = "https://sub.love-gwen.top/v1";
const MAX_BATCH_COUNT = 10;
const MAX_REFERENCE_FILES = 16;
const PROMPT_PRESETS = [
  {
    label: "产品质感",
    prompt: "高级产品摄影，工作室布光，材质细节清晰，边缘干净，真实阴影。",
    negative: "模糊，重复结构，脏污背景，低清晰度，畸变。",
  },
  {
    label: "电影海报",
    prompt: "电影感海报构图，主体明确，层次丰富，戏剧性光影，色彩统一。",
    negative: "水印，过曝，构图松散，五官错乱，低分辨率。",
  },
  {
    label: "材质细化",
    prompt: "保留主体结构，加强材质纹理、边缘细节和光照层次，整体更干净。",
    negative: "结构改动过大，局部融化，重复纹理，脏边。",
  },
  {
    label: "电商白底",
    prompt: "纯净白底，主体居中，阴影克制，适合电商展示，细节真实。",
    negative: "杂色背景，灰底，变形，过度锐化，裁切不完整。",
  },
];

const MODE_META = {
  generate: { hint: "直接生成新图", label: "文生图" },
  reference: { hint: "使用当前画布作为参考图编辑", label: "参考图" },
  inpaint: { hint: "按当前矩形选区进行局部重绘", label: "选区重绘" },
  outpaint: { hint: "向画布四周扩展内容", label: "扩图" },
};

const state = {
  mode: "generate",
  outputView: "results",
  results: [],
  history: [],
  manualReferenceFiles: [],
  selectedId: null,
  busy: false,
};

const CRC32_TABLE = createCrc32Table();

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", init);

function setOpenAiPsMode(mode) {
  if (!MODE_META[mode]) return;
  state.mode = mode;
  updateModeUI();
  if ($("statusBar")) {
    setStatus(`已切换到：${MODE_META[mode].label}`);
  }
}

globalThis.setOpenAiPsMode = setOpenAiPsMode;
if (typeof window !== "undefined") {
  window.setOpenAiPsMode = setOpenAiPsMode;
}

function init() {
  loadSettings();
  renderPromptPresets();
  bindEvents();
  updateModeUI();
  updateKeyBadge();
  syncCountUI();
  renderManualReferenceSummary();
  renderResults();
  renderHistory();
  renderOutputView();
  setStatus("就绪");
}

function bindEvents() {
  document.querySelectorAll("#modeGrid [data-mode]").forEach((button) => {
    button.addEventListener("click", (event) => {
      setOpenAiPsMode(event.currentTarget.getAttribute("data-mode"));
    });
  });
  document.querySelectorAll("#outputTabs [data-output]").forEach((button) => {
    button.addEventListener("click", (event) => {
      state.outputView = event.currentTarget.getAttribute("data-output");
      renderOutputView();
    });
  });

  $("settingsToggleBtn").addEventListener("click", openSettingsView);
  $("settingsBackBtn").addEventListener("click", closeSettingsView);
  $("quickApiToggleBtn").addEventListener("click", toggleQuickApiPanel);
  $("quickSaveApiKeyBtn").addEventListener("click", saveQuickSettings);
  $("quickTestConnectionBtn").addEventListener("click", testConnection);
  [
    ["quickBaseUrlInput", "baseUrlInput"],
    ["quickApiKeyInput", "apiKeyInput"],
    ["quickModelInput", "modelInput"],
  ].forEach(([quickId, settingsId]) => {
    $(quickId).addEventListener("input", () => {
      $(settingsId).value = $(quickId).value;
      updateKeyBadge();
    });
  });

  $("saveSettingsBtn").addEventListener("click", () => {
    saveSettings();
    closeSettingsView();
    setStatus("配置已保存");
  });
  $("testConnectionBtn").addEventListener("click", testConnection);
  $("apiKeyVisibilityBtn").addEventListener("click", toggleApiKeyVisibility);

  $("generateBtn").addEventListener("click", runGeneration);
  $("importSelectedBtn").addEventListener("click", importSelected);
  $("clearResultsBtn").addEventListener("click", () => {
    state.results = [];
    state.selectedId = null;
    renderResults();
    setStatus("结果已清空");
  });

  $("useSelectionSizeBtn").addEventListener("click", applySelectionRatioToSize);
  $("matchDocumentBtn").addEventListener("click", applyDocumentPaddingPreset);
  $("currentDocumentReferenceBtn").addEventListener("click", confirmCurrentDocumentReference);
  $("addReferenceFilesBtn").addEventListener("click", addManualReferenceFiles);
  $("clearReferenceFilesBtn").addEventListener("click", clearManualReferenceFiles);
  $("promptPresetBtn").addEventListener("click", togglePresetMenu);
  $("loadHistoryBtn").addEventListener("click", loadHistory);
  $("clearHistoryBtn").addEventListener("click", clearHistory);
  $("historySearchInput").addEventListener("input", renderHistory);
  $("historyModeFilter").addEventListener("change", renderHistory);
  $("reuseSelectedBtn").addEventListener("click", reuseSelectedSettings);
  $("countInput").addEventListener("input", syncCountUI);
  $("sizeInput").addEventListener("change", syncCustomSizeUI);
  $("customWidthInput").addEventListener("input", syncCustomSizeUI);
  $("customHeightInput").addEventListener("input", syncCustomSizeUI);
  $("apiKeyInput").addEventListener("input", updateKeyBadge);

  document.addEventListener("click", (event) => {
    const menu = $("promptPresetMenu");
    const presetBtn = $("promptPresetBtn");
    if (
      menu.classList.contains("hidden") ||
      presetBtn.contains(event.target) ||
      menu.contains(event.target)
    ) {
      return;
    }
    menu.classList.add("hidden");
  });
}

function loadSettings() {
  const defaults = {
    baseUrl: DEFAULT_BASE_URL,
    apiKey: "",
    model: "gpt-image-2",
    generationPath: "/v1/images/generations",
    editPath: "/v1/images/edits",
    size: "auto",
    quality: "auto",
    count: 1,
    format: "png",
    posterText: "",
    seed: -1,
    stylePreset: "none",
    timeout: 300,
    infiniteTimeout: false,
    customWidth: 1536,
    customHeight: 864,
  };

  const stored = readJsonLocal(SETTINGS_KEY, {});
  const settings = { ...defaults, ...stored };
  settings.baseUrl = normalizeBaseUrl(settings.baseUrl);
  $("baseUrlInput").value = settings.baseUrl;
  $("apiKeyInput").value = settings.apiKey;
  $("quickBaseUrlInput").value = settings.baseUrl;
  $("quickApiKeyInput").value = settings.apiKey;
  $("modelInput").value = settings.model;
  $("quickModelInput").value = settings.model;
  $("generationPathInput").value = settings.generationPath;
  $("editPathInput").value = settings.editPath;
  $("sizeInput").value = settings.size;
  $("qualityInput").value = settings.quality;
  $("countInput").value = clampInteger(settings.count, 1, MAX_BATCH_COUNT, 1);
  $("formatInput").value = settings.format;
  $("posterTextInput").value = settings.posterText || "";
  $("seedInput").value = Number.isFinite(Number(settings.seed)) ? Number(settings.seed) : -1;
  $("stylePresetInput").value = settings.stylePreset || "none";
  $("timeoutInput").value = clampInteger(settings.timeout, 1, 3600, 300);
  $("infiniteTimeoutInput").checked = Boolean(settings.infiniteTimeout);
  $("customWidthInput").value = clampInteger(settings.customWidth, 16, 3840, 1536);
  $("customHeightInput").value = clampInteger(settings.customHeight, 16, 3840, 864);
  syncCustomSizeUI();
}

function saveSettings() {
  const settings = getSettings();
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  $("baseUrlInput").value = settings.baseUrl;
  $("quickBaseUrlInput").value = settings.baseUrl;
  $("quickApiKeyInput").value = settings.apiKey;
  $("quickModelInput").value = settings.model;
  updateKeyBadge();
}

function saveQuickSettings() {
  $("baseUrlInput").value = $("quickBaseUrlInput").value;
  $("apiKeyInput").value = $("quickApiKeyInput").value;
  $("modelInput").value = $("quickModelInput").value;
  saveSettings();
  setQuickApiCollapsed(true);
  setStatus($("apiKeyInput").value.trim() ? "服务配置已保存" : "服务配置已保存，未填写 API Key");
}

function getSettings() {
  const baseUrl = normalizeBaseUrl($("baseUrlInput").value.trim() || DEFAULT_BASE_URL);
  return {
    baseUrl,
    apiKey: $("apiKeyInput").value.trim(),
    model: $("modelInput").value.trim() || "gpt-image-2",
    generationPath: normalizePath($("generationPathInput").value.trim() || "/v1/images/generations"),
    editPath: normalizePath($("editPathInput").value.trim() || "/v1/images/edits"),
    size: $("sizeInput").value,
    quality: $("qualityInput").value,
    count: clampInteger($("countInput").value, 1, MAX_BATCH_COUNT, 1),
    format: $("formatInput").value,
    posterText: $("posterTextInput").value.trim(),
    seed: clampInteger($("seedInput").value, -1, 2147483647, -1),
    stylePreset: $("stylePresetInput").value || "none",
    timeout: clampInteger($("timeoutInput").value, 1, 3600, 300),
    infiniteTimeout: $("infiniteTimeoutInput").checked,
    customWidth: clampInteger($("customWidthInput").value, 16, 3840, 1536),
    customHeight: clampInteger($("customHeightInput").value, 16, 3840, 864),
  };
}

function updateKeyBadge() {
  const dot = $("connectionBadge");
  const hasKey = Boolean($("apiKeyInput").value.trim());
  dot.classList.toggle("is-ok", hasKey);
  dot.classList.toggle("is-off", !hasKey);
  dot.title = hasKey ? "已配置 API Key" : "未配置 API Key";
  $("quickApiKeyInput").value = $("apiKeyInput").value;
  updateQuickApiSummary();
}

function updateQuickApiSummary() {
  const summary = $("quickApiSummary");
  if (!summary) return;
  const hasKey = Boolean($("apiKeyInput").value.trim());
  const model = $("modelInput").value.trim() || "gpt-image-2";
  summary.textContent = hasKey ? `已配置 · ${model}` : `未配置 · ${model}`;
}

function toggleQuickApiPanel() {
  setQuickApiCollapsed(!$("quickApiPanel").classList.contains("is-collapsed"));
}

function setQuickApiCollapsed(collapsed) {
  $("quickApiPanel").classList.toggle("is-collapsed", collapsed);
  $("quickApiBody").classList.toggle("hidden", collapsed);
  $("quickApiToggleBtn").setAttribute("aria-expanded", collapsed ? "false" : "true");
}

function updateModeUI() {
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.classList.toggle("is-active", button.getAttribute("data-mode") === state.mode);
  });

  $("outpaintControls").classList.toggle("hidden", state.mode !== "outpaint");
  $("sizeField").classList.toggle("hidden", state.mode === "inpaint");
  $("modeContextPanel").classList.toggle("hidden", state.mode === "generate");
  $("referenceContext").classList.toggle("hidden", state.mode !== "reference");
  $("selectionContext").classList.toggle(
    "hidden",
    state.mode !== "inpaint" && state.mode !== "outpaint"
  );

  const modeLabels = {
    generate: {
      icon: "✦",
      title: "文生图",
      text: "直接调用图片生成接口，结果会显示在下方结果区。",
      prompt: "提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述您想要生成的画面...",
      negativePlaceholder: "不希望出现的内容...",
    },
    reference: {
      icon: "▧",
      title: "参考图模式",
      text: "当前 Photoshop 画布作为主参考图，手动参考图会一起加入图片编辑接口。",
      prompt: "修改提示词 (Prompt Modification)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述如何修改或延展当前参考图...",
      negativePlaceholder: "不希望改变或出现的内容...",
    },
    inpaint: {
      icon: "□",
      title: "选区重绘",
      text: "基于当前矩形选区生成蒙版，只重绘选中的区域。",
      prompt: "重绘提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述选区内需要替换成什么内容...",
      negativePlaceholder: "不希望在选区里出现的内容...",
    },
    outpaint: {
      icon: "↔",
      title: "扩图模式",
      text: "按九宫格边距扩展画布，并用透明蒙版补全新增区域。",
      prompt: "扩图提示词 (Prompt)",
      negative: "反向提示词 (Negative Prompt)",
      placeholder: "描述扩展区域应该补出的画面...",
      negativePlaceholder: "不希望在扩展区域出现的内容...",
    },
  };

  const meta = modeLabels[state.mode] || modeLabels.generate;
  $("modeContextIcon").textContent = meta.icon;
  $("modeContextTitle").textContent = meta.title;
  $("modeContextText").textContent = meta.text;
  $("promptLabel").textContent = meta.prompt;
  $("negativePromptLabel").textContent = meta.negative;
  $("promptInput").placeholder = meta.placeholder;
  $("negativePromptInput").placeholder = meta.negativePlaceholder;

  const hint = $("modeHint");
  if (hint) {
    hint.textContent = MODE_META[state.mode]?.hint || "直接生成新图";
  }
}

function applyDocumentPaddingPreset() {
  $("padTopInput").value = 0;
  $("padRightInput").value = 256;
  $("padBottomInput").value = 0;
  $("padLeftInput").value = 256;
  setStatus("已按横向扩图预设设置边距");
}

function openSettingsView() {
  $("workspaceView").classList.add("hidden");
  $("settingsView").classList.remove("hidden");
}

function closeSettingsView() {
  $("settingsView").classList.add("hidden");
  $("workspaceView").classList.remove("hidden");
}

function toggleApiKeyVisibility() {
  const input = $("apiKeyInput");
  const button = $("apiKeyVisibilityBtn");
  const visible = input.type === "text";
  input.type = visible ? "password" : "text";
  button.title = visible ? "显示 API Key" : "隐藏 API Key";
  button.setAttribute("aria-label", button.title);
}

function syncCountUI() {
  const count = clampInteger($("countInput").value, 1, MAX_BATCH_COUNT, 1);
  $("countInput").value = count;
  $("countValue").textContent = String(count);
}

function syncCustomSizeUI() {
  const enabled = $("sizeInput").value === "custom";
  $("customSizeControls").classList.toggle("hidden", !enabled);
  const validation = validateCustomSize($("customWidthInput").value, $("customHeightInput").value);
  $("customSizeHint").textContent = enabled ? validation.message : "选择自定义尺寸后生效。";
  $("customSizeHint").classList.toggle("is-invalid", enabled && !validation.ok);
}

function validateCustomSize(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    return { ok: false, message: "请输入宽和高两个正整数。" };
  }
  if (width > 3840 || height > 3840) {
    return { ok: false, message: "宽高都不能超过 3840。" };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { ok: false, message: `宽高都需要是 16 的倍数，建议 ${roundToMultiple(width, 16)} x ${roundToMultiple(height, 16)}。` };
  }
  const pixels = width * height;
  if (pixels < 655360) {
    return { ok: false, message: "尺寸太小，请提高宽或高。" };
  }
  if (pixels > 8294400) {
    return { ok: false, message: "尺寸太大，请降低宽或高。" };
  }
  const ratio = Math.max(width, height) / Math.max(1, Math.min(width, height));
  if (ratio > 3) {
    return { ok: false, message: "宽高比例不能超过 3:1。" };
  }
  return { ok: true, message: `将使用 ${width} x ${height}。` };
}

function getResolvedRequestSize(settings) {
  if (settings.size !== "custom") return settings.size;
  return `${settings.customWidth}x${settings.customHeight}`;
}

function describeRequestPlan(settings, mode) {
  const endpoint = mode === "generate" ? "generations" : "edits";
  const parts = [
    `准备 ${MODE_META[mode]?.label || "图片"} 请求`,
    `接口 ${endpoint}`,
    `尺寸 ${getResolvedRequestSize(settings)}`,
  ];
  if (mode === "reference") {
    parts.push(`参考图 ${state.manualReferenceFiles.length + 1} 张`);
  }
  return parts.join(" · ");
}

function confirmCurrentDocumentReference() {
  if (!app.activeDocument) {
    setStatus("当前没有打开的 Photoshop 文档");
    return;
  }

  const size = getDocumentSize();
  setStatus(`将使用当前 Photoshop 文档作为参考图：${size.width} x ${size.height}`);
}

async function addManualReferenceFiles() {
  try {
    const selected = await fs.getFileForOpening({
      allowMultiple: true,
      types: ["png", "jpg", "jpeg", "webp"],
    });
    const files = Array.isArray(selected) ? selected : selected ? [selected] : [];
    for (const file of files) {
      if (state.manualReferenceFiles.length >= MAX_REFERENCE_FILES) break;
      state.manualReferenceFiles.push(file);
    }
    renderManualReferenceSummary();
    if (files.length) {
      setStatus(`已添加 ${files.length} 张参考图`);
    }
  } catch (error) {
    setStatus(`添加参考图失败：${error?.message || error}`);
  }
}

function clearManualReferenceFiles() {
  state.manualReferenceFiles = [];
  renderManualReferenceSummary();
  setStatus("手动参考图已清空");
}

function renderManualReferenceSummary() {
  const summary = $("manualReferenceSummary");
  if (!summary) return;
  if (!state.manualReferenceFiles.length) {
    summary.textContent = "未添加手动参考图";
    renderManualReferencePreview();
    return;
  }
  const names = state.manualReferenceFiles.slice(0, 2).map((file) => file.name || "image").join(", ");
  const suffix = state.manualReferenceFiles.length > 2 ? ` +${state.manualReferenceFiles.length - 2}` : "";
  summary.textContent = `${state.manualReferenceFiles.length} 张：${names}${suffix}`;
  renderManualReferencePreview();
}

async function renderManualReferencePreview() {
  const container = $("manualReferencePreview");
  if (!container) return;
  container.innerHTML = "";
  container.classList.toggle("has-items", state.manualReferenceFiles.length > 0);

  state.manualReferenceFiles.forEach((file, index) => {
    const item = document.createElement("div");
    item.className = "manual-reference-item";

    const image = document.createElement("img");
    image.alt = file.name || `参考图 ${index + 1}`;
    image.title = file.name || image.alt;
    image.src = "";
    image.onerror = () => {
      item.classList.add("is-error");
      image.alt = "参考图预览失败";
    };
    readReferenceFileAsDataUrl(file).then((src) => {
      image.src = src;
    }).catch((error) => {
      console.warn("reference preview failed", error);
      item.classList.add("is-error");
    });

    const indexBadge = document.createElement("span");
    indexBadge.className = "manual-reference-index";
    indexBadge.textContent = String(index + 1);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "manual-reference-remove";
    remove.title = `移除 ${file.name || `参考图 ${index + 1}`}`;
    remove.setAttribute("aria-label", remove.title);
    remove.textContent = "x";
    remove.addEventListener("click", () => removeManualReferenceFile(index));

    item.appendChild(image);
    item.appendChild(indexBadge);
    item.appendChild(remove);
    container.appendChild(item);
  });
}

function removeManualReferenceFile(index) {
  if (index < 0 || index >= state.manualReferenceFiles.length) return;
  const [removed] = state.manualReferenceFiles.splice(index, 1);
  renderManualReferenceSummary();
  setStatus(`已移除参考图：${removed?.name || index + 1}`);
}

async function readReferenceFileAsDataUrl(file) {
  const buffer = await file.read({ format: storage.formats.binary });
  const mimeType = guessMimeType(file.name || "");
  return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
}

async function readManualReferenceImages() {
  const images = [];
  for (const file of state.manualReferenceFiles.slice(0, MAX_REFERENCE_FILES)) {
    const buffer = await file.read({ format: storage.formats.binary });
    const mimeType = guessMimeType(file.name || "");
    images.push({
      b64: arrayBufferToBase64(buffer),
      mimeType,
      name: file.name || `reference.${mimeToExtension(mimeType)}`,
      file,
    });
  }
  return images;
}

function renderPromptPresets() {
  const menu = $("promptPresetMenu");
  menu.innerHTML = "";
  PROMPT_PRESETS.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => applyPromptPreset(preset));
    menu.appendChild(button);
  });
}

function togglePresetMenu() {
  $("promptPresetMenu").classList.toggle("hidden");
}

function applyPromptPreset(preset) {
  $("promptInput").value = preset.prompt;
  if (!$("negativePromptInput").value.trim()) {
    $("negativePromptInput").value = preset.negative || "";
  }
  $("promptPresetMenu").classList.add("hidden");
  setStatus(`已应用模板：${preset.label}`);
}

async function testConnection() {
  const settings = getSettings();
  $("baseUrlInput").value = settings.baseUrl;
  if (!settings.baseUrl) {
    setStatus("请先填写 Base URL");
    return;
  }
  if (!settings.apiKey) {
    setStatus("请先填写 API Key");
    return;
  }

  $("testConnectionBtn").disabled = true;
  $("saveSettingsBtn").disabled = true;
  setStatus("正在测试连接...");

  try {
    const response = await sendRequest(buildApiUrl(settings.baseUrl, "/models"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
      },
    }, "测试连接");

    if (response.ok) {
      setStatus("连接正常，服务可用");
    } else if (response.status === 401 || response.status === 403) {
      setStatus("服务可达，但 API Key 无效");
    } else if (response.status === 404) {
      setStatus("服务可达，但 /models 不可用");
    } else {
      setStatus(`服务有响应：HTTP ${response.status}`);
    }
  } catch (error) {
    setStatus(`连接失败：${error.message || error}`);
  } finally {
    $("testConnectionBtn").disabled = false;
    $("saveSettingsBtn").disabled = false;
  }
}

async function runGeneration() {
  if (state.busy) return;

  const settings = getSettings();
  $("baseUrlInput").value = settings.baseUrl;
  if (!settings.apiKey) {
    setStatus("请先填写 OpenAI API Key");
    return;
  }

  const rawPrompt = $("promptInput").value.trim();
  if (!rawPrompt) {
    setStatus("请先输入提示词");
    return;
  }

  const customSize = validateCustomSize(settings.customWidth, settings.customHeight);
  if (settings.size === "custom" && !customSize.ok) {
    setStatus(customSize.message);
    return;
  }

  const negativePrompt = $("negativePromptInput").value.trim();
  const prompt = buildEffectivePrompt(rawPrompt, negativePrompt, settings.posterText);
  saveSettings();
  setBusy(true);
  setProgress(8, true);

  try {
    setStatus(describeRequestPlan(settings, state.mode));
    let items = [];
    let outputSize = getResolvedRequestSize(settings);
    let targetRect = null;
    let placementRect = null;

    if (state.mode === "generate") {
      setProgress(20, true);
      items = await requestGenerations(settings, prompt);
    } else if (state.mode === "reference") {
      setProgress(18, true);
      const image = await exportActiveDocumentAsBase64();
      const manualImages = await readManualReferenceImages();
      setProgress(36, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "reference"), image, null, { extraImages: manualImages });
    } else if (state.mode === "inpaint") {
      setProgress(15, true);
      const selection = await getSelectionInfo();
      if (!isSelectionValid(selection)) {
        throw new Error("请先用矩形选框选中要重绘的区域");
      }
      setStatus("正在导出选区上下文...");
      setProgress(34, true);
      const inpaint = await createInpaintInputs(selection, getDocumentSize(), settings.model);
      outputSize = inpaint.displaySize;
      targetRect = inpaint.targetRect;
      placementRect = inpaint.placementRect;
      setStatus(`正在重绘选区截图，接口尺寸 ${inpaint.apiSize}，导回 ${inpaint.displaySize}`);
      setProgress(58, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "inpaint"), inpaint.image, inpaint.mask, { size: inpaint.apiSize });
    } else if (state.mode === "outpaint") {
      setProgress(18, true);
      const image = await exportActiveDocumentAsBase64();
      const docSize = getDocumentSize();
      setProgress(36, true);
      const outpaint = await createOutpaintInputs(image, docSize, getPadding());
      setProgress(58, true);
      items = await requestEdits(settings, buildImageEditPrompt(prompt, "outpaint"), outpaint.image, outpaint.mask);
    }

    const stamped = (items || []).map((item, index) => ({
      id: `${Date.now()}-${index}`,
      b64: item.b64,
      url: item.url || null,
      prompt,
      rawPrompt,
      negativePrompt,
      posterText: settings.posterText,
      mode: state.mode,
      model: settings.model,
      size: outputSize,
      quality: getEffectiveQuality(settings),
      seed: settings.seed,
      stylePreset: settings.stylePreset,
      timeout: settings.timeout,
      infiniteTimeout: settings.infiniteTimeout,
      referenceCount: state.mode === "reference" ? state.manualReferenceFiles.length + 1 : 0,
      format: item.format || settings.format,
      targetRect,
      placementRect,
      cropRect: targetRect,
      createdAt: new Date().toISOString(),
    }));

    if (!stamped.length) {
      throw new Error("接口请求成功，但响应里没有可显示的图片数据");
    }

    state.results = [...stamped, ...state.results];
    state.selectedId = stamped[0]?.id || state.selectedId;
    setProgress(88, true);
    renderResults();
    await Promise.all(stamped.map(saveHistoryItem));
    const imported = await importGeneratedResult(stamped[0], { manageBusy: false });
    setProgress(100, true);
    setStatus(imported
      ? `完成：生成 ${stamped.length} 张，已导入第一张`
      : `完成：生成 ${stamped.length} 张，但自动导入失败，请点“导入”重试`);
  } catch (error) {
    console.error(error);
    setStatus(`失败：${error.message || error}`);
  } finally {
    setBusy(false);
    window.setTimeout(() => setProgress(0, false), 700);
  }
}

function buildEffectivePrompt(prompt, negative, posterText) {
  let effective = prompt;
  const posterTextClean = String(posterText || "").trim();
  if (posterTextClean) {
    effective = `${effective}\n\nThe image must contain this exact readable text:\n${posterTextClean}\n不要省略这些文字，不要改写这些文字，不要使用乱码、伪文字或无法辨认的装饰字。`;
  }
  if (negative) {
    effective = `${effective}\n\nAvoid: ${negative}`;
  }
  return effective;
}

function buildPrompt(prompt, negative) {
  return buildEffectivePrompt(prompt, negative, "");
}

function buildImageEditPrompt(prompt, mode) {
  const modeGuidance = {
    reference: [
      "Use the provided Photoshop image as the primary visual reference.",
      "Preserve the original composition, style, lighting, perspective, color palette, and texture unless the user prompt explicitly asks to change them.",
      "Make the requested change while keeping unrelated areas as close to the source image as possible.",
    ],
    inpaint: [
      "Use the provided Photoshop crop as the source image.",
      "Only edit the transparent mask area. Preserve every unmasked surrounding pixel, edge, style, lighting, perspective, color palette, and texture as closely as possible.",
      "If the masked area contains UI, HUD, menus, buttons, frames, borders, cards, labels, text, numbers, icons, badges, panels, tabs, or decorative interface containers, treat them as foreground elements to remove.",
      "Reconstruct only the underlying base background art behind those UI elements. Do not generate or keep any UI buttons, panel borders, frames, labels, text, icons, counters, cards, or menu elements in the edited area.",
      "Blend the new content into the original image context instead of creating an unrelated standalone image.",
    ],
    outpaint: [
      "Use the provided Photoshop image as the source image.",
      "Only fill the transparent expanded canvas area. Preserve the original content, style, lighting, perspective, color palette, and texture.",
      "Extend the scene naturally from the existing image instead of replacing it.",
    ],
  };

  const guidance = modeGuidance[mode];
  if (!guidance) return prompt;
  return `${guidance.join("\n")}\n\nUser edit request:\n${prompt}`;
}

async function requestGenerations(settings, prompt) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    setStatus(total > 1
      ? `正在调用 OpenAI 文生图 ${index + 1}/${total}...`
      : "正在调用 OpenAI 文生图...");
    setProgress(64 + Math.round((index / total) * 18), true);
    const batch = await requestSingleGeneration(settings, prompt);
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleGeneration(settings, prompt) {
  const payload = cleanObject({
    model: settings.model,
    prompt,
    n: 1,
    size: getResolvedRequestSize(settings),
    output_format: settings.format,
  });
  applyOptionalImageParameters(payload, settings);

  const response = await sendRequest(buildApiUrl(settings.baseUrl, settings.generationPath), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
    timeoutMs: getRequestTimeoutMs(settings),
  }, "文生图请求");

  return parseOpenAIImageResponse(response);
}

async function requestEdits(settings, prompt, imageB64, maskB64, options = {}) {
  const total = Math.max(1, settings.count);
  const results = [];

  for (let index = 0; index < total; index += 1) {
    setStatus(maskB64
      ? `正在调用 OpenAI 局部编辑 ${index + 1}/${total}...`
      : `正在调用 OpenAI 参考图编辑 ${index + 1}/${total}...`);
    setProgress(68 + Math.round((index / total) * 14), true);
    const batch = await requestSingleEdit(settings, prompt, imageB64, maskB64, options);
    results.push(...batch);
  }

  return results.slice(0, total);
}

async function requestSingleEdit(settings, prompt, imageB64, maskB64, options = {}) {
  const requestSize = options.size || getResolvedRequestSize(settings);
  const extraImages = Array.isArray(options.extraImages) ? options.extraImages : [];
  const imageBytes = estimateBase64Bytes(imageB64);
  const maskBytes = maskB64 ? estimateBase64Bytes(maskB64) : 0;
  const extraBytes = extraImages.reduce((sum, image) => sum + estimateBase64Bytes(image.b64), 0);
  const uploadBytes = imageBytes + maskBytes + extraBytes;
  if (uploadBytes > 75 * 1024 * 1024) {
    throw new Error(`上传图片过大：${formatBytes(uploadBytes)}。请缩小选区或画布后重试`);
  }

  setStatus(maskB64
    ? `正在上传局部编辑：图像 ${formatBytes(imageBytes)}，Mask ${formatBytes(maskBytes)}`
    : `正在上传参考图：${formatBytes(imageBytes + extraBytes)}`);

  const url = buildApiUrl(settings.baseUrl, settings.editPath);
  const requestOptions = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
    },
    timeoutMs: getRequestTimeoutMs(settings),
    preferXhr: true,
  };
  const label = maskB64 ? "局部编辑请求" : "参考图编辑请求";
  let response = await sendRequest(url, {
    ...requestOptions,
    body: await createEditFormData(settings, prompt, imageB64, maskB64, extraImages, requestSize, "image"),
  }, label);

  if (!response.ok && isMissingImageFileError(await cloneResponseJson(response))) {
    setStatus("图片编辑接口未识别 image 字段，正在用 image[] 兼容模式重试...");
    response = await sendRequest(url, {
      ...requestOptions,
      body: await createEditFormData(settings, prompt, imageB64, maskB64, extraImages, requestSize, "image[]"),
    }, `${label} image[]`);
  }

  return parseOpenAIImageResponse(response);
}

async function createEditFormData(settings, prompt, imageB64, maskB64, extraImages, requestSize, imageFieldName) {
  const form = new FormData();
  form.append("model", settings.model);
  form.append("prompt", prompt);
  form.append("n", "1");
  if (requestSize) {
    form.append("size", requestSize);
  }
  appendOptionalImageParameters(form, settings);
  form.append("output_format", settings.format);
  await appendEditImageFiles(form, imageB64, extraImages, imageFieldName);
  if (maskB64) {
    appendMultipartFile(form, "mask", await createMultipartImageFile(maskB64, "image/png", "mask.png"), "mask.png");
  }
  return form;
}

async function parseOpenAIImageResponse(response) {
  const text = await response.text();
  let json;

  try {
    json = JSON.parse(text);
  } catch (error) {
    const detail = text ? text.slice(0, 300) : response.statusText;
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${json?.error?.message || response.statusText}`);
  }

  const data = json.data || [];
  return data.map((item) => ({
    b64: item.b64_json || item.b64 || null,
    url: item.url || null,
    format: item.output_format || item.format || null,
  }));
}

async function sendRequest(url, options = {}, label = "请求") {
  const { responseType, timeoutMs, preferXhr, ...fetchOptions } = options;
  const controller = timeoutMs > 0 && typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutId = null;
  let requestTimedOut = false;
  if (preferXhr && typeof XMLHttpRequest !== "undefined") {
    try {
      return await sendXhrRequest(url, options);
    } catch (xhrError) {
      throw makeNetworkError(xhrError, url, label);
    }
  }

  if (controller) {
    fetchOptions.signal = controller.signal;
    timeoutId = setTimeout(() => {
      requestTimedOut = true;
      controller.abort();
    }, timeoutMs);
  }
  try {
    return await fetch(url, fetchOptions);
  } catch (fetchError) {
    if (requestTimedOut || isAbortError(fetchError)) {
      throw makeTimeoutError(url, label, timeoutMs);
    }

    if (typeof XMLHttpRequest === "undefined") {
      throw makeNetworkError(fetchError, url, label);
    }

    try {
      return await sendXhrRequest(url, options);
    } catch (xhrError) {
      throw makeNetworkError(xhrError, url, label);
    }
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function sendXhrRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method || "GET", url, true);
    xhr.timeout = options.timeoutMs > 0 ? options.timeoutMs : 0;
    if (options.responseType) {
      xhr.responseType = options.responseType;
    }

    Object.entries(options.headers || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        xhr.setRequestHeader(key, String(value));
      }
    });

    xhr.onload = () => {
      const getText = () => {
        try {
          return xhr.responseText || "";
        } catch (error) {
          return "";
        }
      };
      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        statusText: xhr.statusText,
        text: () => Promise.resolve(getText()),
        arrayBuffer: () => Promise.resolve(xhr.response instanceof ArrayBuffer ? xhr.response : new ArrayBuffer(0)),
      });
    };
    xhr.onerror = () => reject(new Error("Network request failed"));
    xhr.ontimeout = () => reject(new Error("request timeout"));
    xhr.send(options.body || null);
  });
}

async function cloneResponseJson(response) {
  try {
    const text = await response.text();
    response.text = () => Promise.resolve(text);
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function isMissingImageFileError(json) {
  const message = String(json?.error?.message || json?.detail || json?.message || "");
  return /image file is required|image.*required|missing.*image|需要.*(?:image|图片|参考图)/i.test(message);
}

function makeNetworkError(error, url, label) {
  const detail = error?.message || String(error || "Network request failed");
  return new Error(`${label}网络失败：${detail}。地址：${safeUrlForMessage(url)}`);
}

function makeTimeoutError(url, label, timeoutMs) {
  const seconds = timeoutMs > 0 ? Math.round(timeoutMs / 1000) : 0;
  const hint = seconds ? `超过 ${seconds} 秒未完成` : "请求被中止";
  return new Error(`${label}请求超时：${hint}。地址：${safeUrlForMessage(url)}`);
}

function isAbortError(error) {
  return error?.name === "AbortError" || /abort/i.test(error?.message || "");
}

function safeUrlForMessage(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch (error) {
    return String(value || "").slice(0, 160);
  }
}

async function exportActiveDocumentAsBase64() {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_reference.png", { overwrite: true });
  await core.executeAsModal(async () => {
    await app.activeDocument.saveAs.png(file, null, true);
  }, { commandName: "Export OpenAI reference" });

  const buffer = await file.read({ format: storage.formats.binary });
  return arrayBufferToBase64(buffer);
}

async function exportDocumentRegionAsBase64(rect, outputSize) {
  if (!app.activeDocument) {
    throw new Error("当前没有打开的 Photoshop 文档");
  }

  const folder = await fs.getTemporaryFolder();
  const file = await folder.createFile("openai_inpaint_region.png", { overwrite: true });
  const cropRect = roundRectToPixels(rect);
  let duplicateDoc = null;

  await core.executeAsModal(async () => {
    const sourceDoc = app.activeDocument;
    duplicateDoc = await sourceDoc.duplicate("OpenAI inpaint region", true);
    try {
      await cropDocumentToRect(duplicateDoc, cropRect);
      if (outputSize?.width && outputSize?.height) {
        const currentWidth = Math.round(toNumber(duplicateDoc.width));
        const currentHeight = Math.round(toNumber(duplicateDoc.height));
        if (currentWidth !== outputSize.width || currentHeight !== outputSize.height) {
          await duplicateDoc.resizeImage(outputSize.width, outputSize.height);
        }
      }
      await duplicateDoc.saveAs.png(file, null, true);
    } finally {
      if (duplicateDoc) {
        await duplicateDoc.closeWithoutSaving();
      }
    }
  }, { commandName: "Export OpenAI inpaint region" });

  const buffer = await file.read({ format: storage.formats.binary });
  return arrayBufferToBase64(buffer);
}

async function cropDocumentToRect(documentRef, rect) {
  const bounds = {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };

  try {
    await documentRef.crop(bounds);
  } catch (error) {
    await documentRef.crop([bounds.left, bounds.top, bounds.right, bounds.bottom]);
  }
}

async function importSelected() {
  const item = getSelectedResult();
  if (!item) return;

  await importGeneratedResult(item);
}

async function importGeneratedResult(item, options = {}) {
  if (!item) return false;
  const shouldManageBusy = options.manageBusy !== false;

  try {
    if (shouldManageBusy) setBusy(true);
    const shouldForceCapturedSelection = isInpaintResult(item);
    const shouldFit = shouldForceCapturedSelection || $("fitSelectionInput").checked;
    const liveSelection = shouldFit && !shouldForceCapturedSelection && !item.placementRect && !item.targetRect
      ? await getSelectionInfo()
      : null;
    const placementRect = shouldForceCapturedSelection
      ? (item.placementRect || item.targetRect)
      : shouldFit
      ? (item.placementRect || item.targetRect || liveSelection)
      : null;
    const cropRect = shouldForceCapturedSelection
      ? (item.cropRect || item.targetRect)
      : shouldFit ? item.cropRect : null;
    await placeResultAsLayer(item, placementRect, shouldForceCapturedSelection ? "OpenAI Inpaint" : "OpenAI Image", cropRect);
    setStatus(shouldForceCapturedSelection ? "已按生成时选区裁切导入" : "已导入到当前文档");
    return true;
  } catch (error) {
    console.error(error);
    setStatus(`导入失败：${error.message || error}`);
    return false;
  } finally {
    if (shouldManageBusy) setBusy(false);
  }
}

function isInpaintResult(item) {
  return item?.mode === "inpaint" &&
    (isSelectionValid(item.placementRect) || isSelectionValid(item.targetRect));
}

async function placeResultAsLayer(item, selectionInfo, layerName, cropRect = null) {
  const binary = await resultToArrayBuffer(item);
  const format = item.format || detectFormatFromResult(item) || "png";
  const imageSize = getPngSize(binary) || { width: 1024, height: 1024 };

  if (!app.activeDocument) {
    await core.executeAsModal(async () => {
      await app.documents.add({
        width: imageSize.width,
        height: imageSize.height,
        resolution: 72,
        mode: "RGBColorMode",
        fill: "transparent",
      });
    }, { commandName: "Create OpenAI document" });
  }

  const folder = await fs.getTemporaryFolder();
  const extension = ["png", "jpeg", "jpg", "webp"].includes(format) ? format : "png";
  const file = await folder.createFile(`openai_result.${extension}`, { overwrite: true });
  await file.write(binary, { format: storage.formats.binary });
  const token = await fs.createSessionToken(file);

  let importedLayer;
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "placeEvent",
        null: { _path: token, _kind: "local" },
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSCorner0",
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 },
        },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { modalBehavior: "execute" });
    importedLayer = app.activeDocument.activeLayers[0];
    importedLayer.name = layerName;
  }, { commandName: "Place OpenAI image" });

  if (isSelectionValid(selectionInfo) && importedLayer) {
    await transformLayerToRect(importedLayer, selectionInfo);
  }

  if (isSelectionValid(cropRect) && importedLayer) {
    await applyRectMaskToLayer(importedLayer, cropRect);
  }
}

async function resultToArrayBuffer(item) {
  if (item.b64) {
    return base64ToArrayBuffer(stripDataUrl(item.b64));
  }

  if (item.url) {
    const response = await sendRequest(item.url, { responseType: "arraybuffer" }, "下载结果");
    if (!response.ok) {
      throw new Error(`下载结果失败：HTTP ${response.status}`);
    }
    return await response.arrayBuffer();
  }

  throw new Error("结果中没有可用的图片数据");
}

function resultToPreviewSrc(item) {
  if (item.url) return item.url;
  if (item.previewUrl) return item.previewUrl;
  if (item.b64) {
    const format = item.format || "png";
    try {
      if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
        item.previewUrl = URL.createObjectURL(base64ToBlob(item.b64, mimeTypeForFormat(format)));
        return item.previewUrl;
      }
    } catch (error) {
      console.warn("Blob preview failed, falling back to data URL", error);
    }
    return toDataUrl(item.b64, format);
  }
  return "";
}

function detectFormatFromResult(item) {
  if (item.format) return item.format;
  if (item.url && item.url.includes(".webp")) return "webp";
  if (item.url && (item.url.includes(".jpg") || item.url.includes(".jpeg"))) return "jpeg";
  return "png";
}

async function transformLayerToRect(layer, targetRect) {
  const bounds = normalizeBounds(layer.boundsNoEffects || layer.bounds);
  if (!bounds || !bounds.width || !bounds.height) return;

  const scaleX = (targetRect.width / bounds.width) * 100;
  const scaleY = (targetRect.height / bounds.height) * 100;

  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "transform",
        _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
        freeTransformCenterState: {
          _enum: "quadCenterState",
          _value: "QCSIndependent",
        },
        position: {
          _obj: "paint",
          horizontal: { _unit: "pixelsUnit", _value: bounds.left },
          vertical: { _unit: "pixelsUnit", _value: bounds.top },
        },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: targetRect.left - bounds.left },
          vertical: { _unit: "pixelsUnit", _value: targetRect.top - bounds.top },
        },
        width: { _unit: "percentUnit", _value: scaleX },
        height: { _unit: "percentUnit", _value: scaleY },
        linked: false,
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Fit OpenAI image" });
}

async function applyRectMaskToLayer(layer, rect) {
  await core.executeAsModal(async () => {
    await action.batchPlay([
      {
        _obj: "select",
        _target: [{ _id: layer.id, _ref: "layer" }],
        makeVisible: false,
        _options: { dialogOptions: "dontDisplay" },
      },
      rectSelectionCommand(rect),
      {
        _obj: "make",
        new: { _class: "channel" },
        at: { _ref: "channel", _enum: "channel", _value: "mask" },
        using: { _enum: "userMaskEnabled", _value: "revealSelection" },
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" });
  }, { commandName: "Crop OpenAI image to selection" });
}

function rectSelectionCommand(rect) {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: {
      _obj: "rectangle",
      top: { _unit: "pixelsUnit", _value: rect.top },
      left: { _unit: "pixelsUnit", _value: rect.left },
      bottom: { _unit: "pixelsUnit", _value: rect.bottom },
      right: { _unit: "pixelsUnit", _value: rect.right },
    },
    _options: { dialogOptions: "dontDisplay" },
  };
}

async function getSelectionInfo() {
  try {
    const result = await core.executeAsModal(async () => action.batchPlay([
      {
        _obj: "get",
        _target: [
          { _property: "selection" },
          { _ref: "document", _id: app.activeDocument._id },
        ],
        _options: { dialogOptions: "dontDisplay" },
      },
    ], { synchronousExecution: true, modalBehavior: "execute" }), {
      commandName: "Read selection",
    });

    const selection = result[0]?.selection;
    if (!selection) return null;
    return {
      left: toNumber(selection.left),
      right: toNumber(selection.right),
      top: toNumber(selection.top),
      bottom: toNumber(selection.bottom),
      width: toNumber(selection.right) - toNumber(selection.left),
      height: toNumber(selection.bottom) - toNumber(selection.top),
    };
  } catch (error) {
    return null;
  }
}

function isSelectionValid(selection) {
  return selection &&
    Number.isFinite(selection.left) &&
    Number.isFinite(selection.right) &&
    Number.isFinite(selection.top) &&
    Number.isFinite(selection.bottom) &&
    selection.width > 0 &&
    selection.height > 0;
}

function getDocumentSize() {
  if (!app.activeDocument) return { width: 1024, height: 1024 };
  return {
    width: Math.round(toNumber(app.activeDocument.width)),
    height: Math.round(toNumber(app.activeDocument.height)),
  };
}

async function createRectMaskBase64(width, height, selection) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = 255;
  }

  const left = Math.max(0, Math.floor(selection.left));
  const top = Math.max(0, Math.floor(selection.top));
  const right = Math.min(width, Math.ceil(selection.right));
  const bottom = Math.min(height, Math.ceil(selection.bottom));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = (y * width + x) * 4;
      rgba[offset] = 0;
      rgba[offset + 1] = 0;
      rgba[offset + 2] = 0;
      rgba[offset + 3] = 0;
    }
  }

  return bytesToBase64(encodePngRgba(width, height, rgba));
}

async function createInpaintInputs(selection, docSize, model) {
  const targetRect = clampRectToDocument(cloneRect(selection), docSize);
  const placementRect = roundRectToPixels(targetRect);
  const apiSize = getImageEditSizeForSelection(placementRect.width, placementRect.height, model);
  const image = await exportDocumentRegionAsBase64(placementRect);
  const mask = await createRelativeRectMaskBase64(placementRect.width, placementRect.height, placementRect, targetRect);
  await saveDebugBase64Image("openai-last-inpaint-input.png", image);
  await saveDebugBase64Image("openai-last-inpaint-mask.png", mask);

  return {
    image,
    mask,
    apiSize,
    displaySize: `${targetRect.width}x${targetRect.height}`,
    targetRect,
    placementRect,
  };
}

function getInpaintPlacementRect(targetRect, docSize, model) {
  const contextualRect = expandRectForInpaintContext(targetRect, docSize);
  if (supportsFlexibleImageSize(model)) {
    return roundRectToPixels(contextualRect);
  }

  const apiSize = getImageEditSizeForSelection(contextualRect.width, contextualRect.height, model);
  return roundRectToPixels(clampRectToDocument(getPaddedPlacementRect(contextualRect, apiSize), docSize));
}

function expandRectForInpaintContext(targetRect, docSize) {
  const horizontalPadding = getInpaintContextPadding(targetRect.width, 0.18);
  const verticalPadding = getInpaintContextPadding(targetRect.height, 0.25);
  return clampRectToDocument({
    left: targetRect.left - horizontalPadding,
    top: targetRect.top - verticalPadding,
    right: targetRect.right + horizontalPadding,
    bottom: targetRect.bottom + verticalPadding,
  }, docSize);
}

function getInpaintContextPadding(value, ratio) {
  return Math.round(Math.max(64, Math.min(384, value * ratio)));
}

async function createRelativeRectMaskBase64(width, height, sourceRect, targetRect) {
  const scaleX = width / Math.max(1, sourceRect.width);
  const scaleY = height / Math.max(1, sourceRect.height);
  const relative = {
    left: (targetRect.left - sourceRect.left) * scaleX,
    top: (targetRect.top - sourceRect.top) * scaleY,
    right: (targetRect.right - sourceRect.left) * scaleX,
    bottom: (targetRect.bottom - sourceRect.top) * scaleY,
  };
  relative.width = relative.right - relative.left;
  relative.height = relative.bottom - relative.top;
  return createRectMaskBase64(width, height, relative);
}

function getPaddedPlacementRect(targetRect, apiSize) {
  const apiDimensions = parseImageSize(apiSize);
  if (!apiDimensions || !isSelectionValid(targetRect)) {
    return targetRect;
  }

  const apiRatio = apiDimensions.width / apiDimensions.height;
  const targetRatio = targetRect.width / targetRect.height;
  let width = targetRect.width;
  let height = targetRect.height;

  if (targetRatio > apiRatio) {
    height = width / apiRatio;
  } else {
    width = height * apiRatio;
  }

  const centerX = targetRect.left + targetRect.width / 2;
  const centerY = targetRect.top + targetRect.height / 2;
  return {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
    width,
    height,
  };
}

function parseImageSize(size) {
  const match = String(size || "").match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

function getImageEditSizeForSelection(width, height, model) {
  if (!supportsFlexibleImageSize(model)) {
    return nearestStandardImageSize(width, height);
  }

  return constrainFlexibleImageSize(width, height);
}

function supportsFlexibleImageSize(model) {
  return /gpt-image-2/i.test(String(model || ""));
}

function nearestStandardImageSize(width, height) {
  const ratio = Math.max(0.01, width / Math.max(1, height));
  if (ratio > 1.25) return "1536x1024";
  if (ratio < 0.8) return "1024x1536";
  return "1024x1024";
}

function constrainFlexibleImageSize(width, height) {
  const rules = {
    multiple: 16,
    minPixels: 655360,
    maxPixels: 8294400,
    maxEdge: 3840,
    maxRatio: 3,
  };
  const sourceWidth = Math.max(1, Number(width) || 1);
  const sourceHeight = Math.max(1, Number(height) || 1);
  const ratio = Math.min(
    rules.maxRatio,
    Math.max(1 / rules.maxRatio, sourceWidth / sourceHeight)
  );
  const sourcePixels = sourceWidth * sourceHeight;
  const targetPixels = Math.min(rules.maxPixels, Math.max(rules.minPixels, sourcePixels));

  let outputWidth = Math.sqrt(targetPixels * ratio);
  let outputHeight = outputWidth / ratio;
  const edgeScale = Math.min(1, rules.maxEdge / Math.max(outputWidth, outputHeight));
  outputWidth *= edgeScale;
  outputHeight *= edgeScale;

  return normalizeFlexibleImageSize(outputWidth, outputHeight, rules);
}

function normalizeFlexibleImageSize(width, height, rules) {
  let outputWidth = roundToMultiple(width, rules.multiple);
  let outputHeight = roundToMultiple(height, rules.multiple);

  for (let index = 0; index < 16; index += 1) {
    outputWidth = Math.max(rules.multiple, Math.min(rules.maxEdge, outputWidth));
    outputHeight = Math.max(rules.multiple, Math.min(rules.maxEdge, outputHeight));

    if (outputWidth / outputHeight > rules.maxRatio) {
      outputHeight = ceilToMultiple(outputWidth / rules.maxRatio, rules.multiple);
      continue;
    }

    if (outputHeight / outputWidth > rules.maxRatio) {
      outputWidth = ceilToMultiple(outputHeight / rules.maxRatio, rules.multiple);
      continue;
    }

    const pixels = outputWidth * outputHeight;
    if (pixels < rules.minPixels) {
      const scale = Math.sqrt(rules.minPixels / pixels);
      outputWidth = ceilToMultiple(outputWidth * scale, rules.multiple);
      outputHeight = ceilToMultiple(outputHeight * scale, rules.multiple);
      continue;
    }

    if (pixels > rules.maxPixels || outputWidth > rules.maxEdge || outputHeight > rules.maxEdge) {
      const scale = Math.min(
        rules.maxEdge / outputWidth,
        rules.maxEdge / outputHeight,
        Math.sqrt(rules.maxPixels / pixels)
      );
      outputWidth = floorToMultiple(outputWidth * scale, rules.multiple);
      outputHeight = floorToMultiple(outputHeight * scale, rules.multiple);
      continue;
    }

    break;
  }

  return `${outputWidth}x${outputHeight}`;
}

function roundToMultiple(value, multiple) {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

function ceilToMultiple(value, multiple) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple);
}

function floorToMultiple(value, multiple) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple);
}

function cloneRect(rect) {
  return {
    left: toNumber(rect.left),
    top: toNumber(rect.top),
    right: toNumber(rect.right),
    bottom: toNumber(rect.bottom),
    width: toNumber(rect.width),
    height: toNumber(rect.height),
  };
}

function roundRectToPixels(rect) {
  const left = Math.floor(toNumber(rect.left));
  const top = Math.floor(toNumber(rect.top));
  const right = Math.ceil(toNumber(rect.right));
  const bottom = Math.ceil(toNumber(rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function clampRectToDocument(rect, docSize) {
  const width = Math.max(1, Math.round(toNumber(docSize?.width) || 1));
  const height = Math.max(1, Math.round(toNumber(docSize?.height) || 1));
  const left = Math.max(0, Math.min(width - 1, Math.floor(toNumber(rect.left))));
  const top = Math.max(0, Math.min(height - 1, Math.floor(toNumber(rect.top))));
  const right = Math.max(left + 1, Math.min(width, Math.ceil(toNumber(rect.right))));
  const bottom = Math.max(top + 1, Math.min(height, Math.ceil(toNumber(rect.bottom))));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

async function createOutpaintInputs(imageB64, docSize, padding) {
  const image = await loadImage(`data:image/png;base64,${stripDataUrl(imageB64)}`);
  const width = docSize.width + padding.left + padding.right;
  const height = docSize.height + padding.top + padding.bottom;

  const imageCanvas = document.createElement("canvas");
  imageCanvas.width = width;
  imageCanvas.height = height;
  const imageCtx = imageCanvas.getContext("2d");
  imageCtx.clearRect(0, 0, width, height);
  imageCtx.drawImage(image, padding.left, padding.top, docSize.width, docSize.height);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = width;
  maskCanvas.height = height;
  const maskCtx = maskCanvas.getContext("2d");
  maskCtx.clearRect(0, 0, width, height);
  maskCtx.fillStyle = "rgba(255,255,255,1)";
  maskCtx.fillRect(padding.left, padding.top, docSize.width, docSize.height);

  return {
    image: await canvasToBase64(imageCanvas),
    mask: await canvasToBase64(maskCanvas),
  };
}

function getPadding() {
  return {
    left: clampNumber($("padLeftInput").value, 0, 1600, 0),
    right: clampNumber($("padRightInput").value, 0, 1600, 0),
    top: clampNumber($("padTopInput").value, 0, 1600, 0),
    bottom: clampNumber($("padBottomInput").value, 0, 1600, 0),
  };
}

async function applySelectionRatioToSize() {
  const selection = await getSelectionInfo();
  if (!isSelectionValid(selection)) {
    setStatus("没有读取到矩形选区");
    return;
  }

  const ratio = selection.width / selection.height;
  if (ratio > 1.25) {
    $("sizeInput").value = "1536x1024";
  } else if (ratio < 0.8) {
    $("sizeInput").value = "1024x1536";
  } else {
    $("sizeInput").value = "1024x1024";
  }

  setStatus(`已按选区比例设置尺寸：${$("sizeInput").value}`);
}

function renderResults() {
  $("resultCount").textContent = `${state.results.length}`;
  $("importSelectedBtn").disabled = !state.selectedId || state.busy;
  renderSelectedPreview();
  renderSelectedDetails();
  renderGrid($("resultGrid"), state.results, true);
  renderOutputView();
}

function renderHistory() {
  renderGrid($("historyGrid"), getFilteredHistory(), false);
  renderOutputView();
}

function renderOutputView() {
  $("selectedPreview").classList.toggle(
    "hidden",
    state.outputView !== "results" || !getSelectedResult()
  );
  $("resultGrid").classList.toggle("hidden", state.outputView !== "results");
  $("historyGrid").classList.toggle("hidden", state.outputView !== "history");
  $("historyActions").classList.toggle("hidden", state.outputView !== "history");
  $("reuseSelectedBtn").classList.toggle("hidden", !getSelectedResult());
  $("selectedDetails").classList.toggle("hidden", !getSelectedResult());

  document.querySelectorAll("[data-output]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.output === state.outputView);
  });
}

function getFilteredHistory() {
  const query = ($("historySearchInput")?.value || "").trim().toLowerCase();
  const mode = $("historyModeFilter")?.value || "all";
  return state.history.filter((item) => {
    if (mode !== "all" && item.mode !== mode) return false;
    if (!query) return true;
    return [
      item.prompt,
      item.rawPrompt,
      item.negativePrompt,
      item.posterText,
      item.model,
      item.fileName,
    ].some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function renderGrid(container, items, isCurrent) {
  container.innerHTML = "";

  items.forEach((item) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "thumb-tile";
    tile.classList.toggle("is-active", item.id === state.selectedId);
    tile.title = describeItem(item);

    const image = document.createElement("img");
    image.src = resultToPreviewSrc(item);
    image.alt = item.prompt || describeItem(item);
    image.onerror = () => {
      tile.classList.add("is-error");
      tile.title = "图片预览失败，但结果数据已返回";
      setStatus("图片预览失败：请尝试导入或重新生成");
    };
    image.addEventListener("click", () => selectResult(item, isCurrent));

    tile.appendChild(image);
    tile.addEventListener("click", () => selectResult(item, isCurrent));
    container.appendChild(tile);
  });

  fillGridPlaceholders(container, Math.max(0, 6 - items.length), isCurrent ? "results" : "history");
}

function renderSelectedPreview() {
  const preview = $("selectedPreview");
  const item = getSelectedResult();
  preview.innerHTML = "";

  if (!item) {
    preview.classList.add("hidden");
    return;
  }

  const image = document.createElement("img");
  image.src = resultToPreviewSrc(item);
  image.alt = item.prompt || describeItem(item);
  image.onerror = () => {
    preview.classList.add("is-error");
    setStatus("图片预览失败：接口返回了结果，但 UXP 没能显示缩略图");
  };

  const meta = document.createElement("div");
  meta.className = "selected-preview-meta";
  meta.textContent = `${MODE_META[item.mode]?.label || "结果"} · ${item.size || "auto"} · ${item.format || "png"}`;

  preview.appendChild(image);
  preview.appendChild(meta);
  preview.classList.remove("hidden", "is-error");
}

function renderSelectedDetails() {
  const details = $("selectedDetails");
  const item = getSelectedResult();
  details.innerHTML = "";
  if (!item) {
    details.classList.add("hidden");
    return;
  }

  [
    ["模式", MODE_META[item.mode]?.label || item.mode || "结果"],
    ["模型", item.model || "gpt-image-2"],
    ["尺寸", item.size || "auto"],
    ["质量", item.quality || "auto"],
    ["Seed", item.seed ?? "-1"],
    ["风格", item.stylePreset || "none"],
    ["参考图", item.referenceCount || 0],
  ].forEach(([label, value]) => {
    const row = document.createElement("div");
    row.className = "selected-detail-row";
    const key = document.createElement("span");
    key.textContent = label;
    const val = document.createElement("strong");
    val.textContent = String(value);
    row.appendChild(key);
    row.appendChild(val);
    details.appendChild(row);
  });
  details.classList.remove("hidden");
}

function fillGridPlaceholders(container, count, type) {
  for (let index = 0; index < count; index += 1) {
    const placeholder = document.createElement("div");
    placeholder.className = "thumb-placeholder";
    if (type === "history") {
      placeholder.classList.add("is-history");
    }
    container.appendChild(placeholder);
  }
}

function selectResult(item, isCurrent) {
  state.selectedId = item.id;
  if (!isCurrent && !state.results.find((entry) => entry.id === item.id)) {
    state.results.unshift(item);
  }
  renderResults();
  renderHistory();
}

function getSelectedResult() {
  return state.results.find((item) => item.id === state.selectedId) ||
    state.history.find((item) => item.id === state.selectedId);
}

function reuseSelectedSettings() {
  const item = getSelectedResult();
  if (!item) {
    setStatus("请先选择一张结果或历史图");
    return;
  }

  $("promptInput").value = item.rawPrompt || item.prompt || "";
  $("negativePromptInput").value = item.negativePrompt || "";
  $("posterTextInput").value = item.posterText || "";
  if (item.size) {
    if (/^\d+x\d+$/i.test(item.size) && !Array.from($("sizeInput").options).some((option) => option.value === item.size)) {
      const parsed = parseImageSize(item.size);
      $("sizeInput").value = "custom";
      if (parsed) {
        $("customWidthInput").value = String(parsed.width);
        $("customHeightInput").value = String(parsed.height);
      }
    } else {
      $("sizeInput").value = item.size;
    }
  }
  if (item.quality) {
    $("qualityInput").value = item.quality;
  }
  if (item.seed !== undefined && item.seed !== null) {
    $("seedInput").value = String(item.seed);
  }
  if (item.stylePreset) {
    $("stylePresetInput").value = item.stylePreset;
  }
  if (item.timeout) {
    $("timeoutInput").value = String(item.timeout);
  }
  $("infiniteTimeoutInput").checked = Boolean(item.infiniteTimeout);
  syncCustomSizeUI();
  setStatus("已复用选中项的提示词和参数");
}

function describeItem(item) {
  const label = MODE_META[item.mode]?.label || "结果";
  const stamp = item.createdAt
    ? new Date(item.createdAt).toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  return stamp ? `${label} · ${stamp}` : label;
}

async function saveHistoryItem(item) {
  try {
    const binary = await resultToArrayBuffer(item);
    const folder = await getHistoryFolder();
    const format = detectFormatFromResult(item);
    const fileName = `${item.id}.${format}`;
    const file = await folder.createFile(fileName, { overwrite: true });
    await file.write(binary, { format: storage.formats.binary });

    const record = {
      id: item.id,
      fileName,
      prompt: item.prompt,
      rawPrompt: item.rawPrompt || item.prompt,
      mode: item.mode,
      model: item.model,
      size: item.size,
      quality: item.quality,
      negativePrompt: item.negativePrompt || "",
      posterText: item.posterText || "",
      seed: item.seed,
      stylePreset: item.stylePreset,
      timeout: item.timeout,
      infiniteTimeout: item.infiniteTimeout,
      referenceCount: item.referenceCount || 0,
      format,
      targetRect: item.targetRect || null,
      placementRect: item.placementRect || null,
      cropRect: item.cropRect || null,
      createdAt: item.createdAt,
    };
    const index = readJsonLocal(HISTORY_KEY, []);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([record, ...index].slice(0, 40)));
    addHistoryRecord({ ...record, b64: arrayBufferToBase64(binary), previewUrl: null });
  } catch (error) {
    console.warn("saveHistoryItem failed", error);
  }
}

function addHistoryRecord(record) {
  state.history = [
    record,
    ...state.history.filter((item) => item.id !== record.id),
  ].slice(0, 40);
  renderHistory();
}

async function loadHistory() {
  try {
    const index = readJsonLocal(HISTORY_KEY, []);
    const folder = await getHistoryFolder();
    const loaded = [];

    for (const record of index.slice(0, 20)) {
      try {
        const file = await folder.getEntry(record.fileName);
        const buffer = await file.read({ format: storage.formats.binary });
        loaded.push({ ...record, b64: arrayBufferToBase64(buffer), previewUrl: null });
      } catch (error) {
        console.warn("history entry missing", record.fileName);
      }
    }

    state.history = loaded;
    state.outputView = "history";
    renderHistory();
    setStatus(`已加载历史：${loaded.length} 张`);
  } catch (error) {
    setStatus(`加载历史失败：${error.message || error}`);
  }
}

async function clearHistory() {
  localStorage.setItem(HISTORY_KEY, "[]");
  state.history = [];
  renderHistory();
  setStatus("历史已清空");
}

async function getHistoryFolder() {
  const dataFolder = await fs.getDataFolder();
  try {
    return await dataFolder.getEntry("history");
  } catch (error) {
    return await dataFolder.createFolder("history");
  }
}

async function saveDebugBase64Image(fileName, b64) {
  try {
    const dataFolder = await fs.getDataFolder();
    let debugFolder;
    try {
      debugFolder = await dataFolder.getEntry("debug");
    } catch (error) {
      debugFolder = await dataFolder.createFolder("debug");
    }
    const file = await debugFolder.createFile(fileName, { overwrite: true });
    await file.write(base64ToArrayBuffer(stripDataUrl(b64)), { format: storage.formats.binary });
  } catch (error) {
    console.warn("saveDebugBase64Image failed", error);
  }
}

function setBusy(busy) {
  state.busy = busy;
  $("generateBtn").disabled = busy;
  $("importSelectedBtn").disabled = busy || !state.selectedId;
  $("clearResultsBtn").disabled = busy;
  $("quickSaveApiKeyBtn").disabled = busy;
  $("quickTestConnectionBtn").disabled = busy;
  $("saveSettingsBtn").disabled = busy;
  $("testConnectionBtn").disabled = busy;
  $("generateBtnLabel").textContent = busy ? "生成中..." : "生成";
}

function setProgress(value, visible) {
  const track = $("progressTrack");
  const fill = $("progressFill");
  if (!track || !fill) return;
  const percent = Math.max(0, Math.min(100, Number(value) || 0));
  track.classList.toggle("hidden", !visible);
  fill.style.width = `${percent}%`;
}

function setStatus(message) {
  $("statusBar").textContent = message;
  const settingsStatus = $("settingsStatusBar");
  if (settingsStatus) {
    settingsStatus.textContent = message;
  }
  updateStatusTone(message);
  const settingsDot = $("settingsStatusDot");
  if (settingsDot) {
    settingsDot.className = $("statusDot").className;
  }
}

function updateStatusTone(message) {
  const dot = $("statusDot");
  dot.classList.remove("is-busy", "is-error", "is-warn");
  const settingsDot = $("settingsStatusDot");
  if (settingsDot) {
    settingsDot.className = dot.className;
  }

  if (/失败|无效|错误|不可用|下载结果失败/i.test(message)) {
    dot.classList.add("is-error");
    return;
  }

  if (/请先|未配置|没有|未读取/i.test(message)) {
    dot.classList.add("is-warn");
    return;
  }

  if (state.busy || /^正在/.test(message)) {
    dot.classList.add("is-busy");
  }
}

function base64ToBlob(b64, mimeType) {
  return new Blob([base64ToArrayBuffer(stripDataUrl(b64))], { type: mimeType });
}

async function createMultipartImageFile(b64, mimeType, fileName) {
  const folder = await fs.getTemporaryFolder();
  const safeName = String(fileName || `image.${mimeToExtension(mimeType)}`).replace(/[\\/:*?"<>|]/g, "_");
  const file = await folder.createFile(`openai-upload-${Date.now()}-${safeName}`, { overwrite: true });
  await file.write(base64ToArrayBuffer(stripDataUrl(b64)), { format: storage.formats.binary });
  return file;
}

function appendMultipartFile(form, fieldName, file, fileName) {
  try {
    form.append(fieldName, file, fileName);
  } catch (error) {
    form.append(fieldName, file);
  }
}

async function appendEditImageFiles(form, imageB64, extraImages = [], fieldName = "image") {
  appendMultipartFile(form, fieldName, await createMultipartImageFile(imageB64, "image/png", "input.png"), "input.png");
  for (let index = 0; index < extraImages.length; index += 1) {
    const image = extraImages[index];
    const mime = image.mimeType || "image/png";
    const fileName = image.name || `reference-${index + 1}.${mimeToExtension(mime)}`;
    const file = image.file || await createMultipartImageFile(image.b64, mime, fileName);
    appendMultipartFile(form, fieldName, file, fileName);
  }
}

function estimateBase64Bytes(value) {
  const b64 = stripDataUrl(value).replace(/\s/g, "");
  if (!b64) return 0;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

function formatBytes(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${Math.round(value)} B`;
}

function getEffectiveQuality(settings) {
  return settings?.quality && settings.quality !== "auto" ? settings.quality : "auto";
}

function applyOptionalImageParameters(payload, settings) {
  const quality = getEffectiveQuality(settings);
  if (quality !== "auto") {
    payload.quality = quality;
  }
  if (settings.seed !== -1) {
    payload.seed = settings.seed;
  }
  if (settings.stylePreset && settings.stylePreset !== "none") {
    payload.style_preset = settings.stylePreset;
  }
}

function appendOptionalImageParameters(form, settings) {
  const params = {};
  applyOptionalImageParameters(params, settings);
  Object.entries(params).forEach(([key, value]) => {
    form.append(key, String(value));
  });
}

function getRequestTimeoutMs(settings) {
  if (settings?.infiniteTimeout) return 0;
  return clampInteger(settings?.timeout, 1, 3600, 300) * 1000;
}

function stripDataUrl(value) {
  return String(value || "").replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function mimeTypeForFormat(format) {
  if (format === "jpeg" || format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function guessMimeType(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/png";
}

function mimeToExtension(mimeType) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "png";
}

async function canvasToBase64(canvas) {
  if (canvas && typeof canvas.toBlob === "function") {
    const blob = await new Promise((resolve, reject) => {
      try {
        canvas.toBlob((value) => {
          if (value) {
            resolve(value);
          } else {
            reject(new Error("Canvas 导出 PNG 失败"));
          }
        }, "image/png");
      } catch (error) {
        reject(error);
      }
    });
    return arrayBufferToBase64(await blobToArrayBuffer(blob));
  }

  if (canvas && typeof canvas.toDataURL === "function") {
    return canvas.toDataURL("image/png").split(",")[1];
  }

  const ctx = canvas?.getContext?.("2d");
  if (ctx && typeof ctx.getImageData === "function") {
    const width = Math.max(1, Math.round(canvas.width));
    const height = Math.max(1, Math.round(canvas.height));
    const imageData = ctx.getImageData(0, 0, width, height);
    return bytesToBase64(encodePngRgba(width, height, imageData.data));
  }

  throw new Error("当前 Photoshop UXP Canvas 不支持导出 PNG");
}

function blobToArrayBuffer(blob) {
  if (blob && typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("读取 Blob 失败"));
    reader.readAsArrayBuffer(blob);
  });
}

function createSolidMaskBase64(width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 255;
    rgba[index + 1] = 255;
    rgba[index + 2] = 255;
    rgba[index + 3] = 255;
  }
  return bytesToBase64(encodePngRgba(width, height, rgba));
}

function encodePngRgba(width, height, rgba) {
  const rowLength = width * 4;
  const raw = new Uint8Array((rowLength + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (rowLength + 1);
    const rgbaOffset = y * rowLength;
    raw[rawOffset] = 0;
    raw.set(rgba.subarray(rgbaOffset, rgbaOffset + rowLength), rawOffset + 1);
  }

  return concatBytes([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", createIhdr(width, height)),
    pngChunk("IDAT", zlibStore(raw)),
    pngChunk("IEND", new Uint8Array(0)),
  ]);
}

function createIhdr(width, height) {
  const data = new Uint8Array(13);
  writeUint32(data, 0, width);
  writeUint32(data, 4, height);
  data[8] = 8;
  data[9] = 6;
  data[10] = 0;
  data[11] = 0;
  data[12] = 0;
  return data;
}

function pngChunk(type, data) {
  const typeBytes = asciiBytes(type);
  const out = new Uint8Array(12 + data.length);
  writeUint32(out, 0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  writeUint32(out, 8 + data.length, crc32(concatBytes([typeBytes, data])));
  return out;
}

function zlibStore(data) {
  const blockCount = Math.ceil(data.length / 65535) || 1;
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let outOffset = 0;
  let dataOffset = 0;
  out[outOffset++] = 0x78;
  out[outOffset++] = 0x01;

  for (let block = 0; block < blockCount; block += 1) {
    const remaining = data.length - dataOffset;
    const length = Math.min(65535, remaining);
    out[outOffset++] = block === blockCount - 1 ? 1 : 0;
    out[outOffset++] = length & 0xff;
    out[outOffset++] = (length >> 8) & 0xff;
    const nlen = (~length) & 0xffff;
    out[outOffset++] = nlen & 0xff;
    out[outOffset++] = (nlen >> 8) & 0xff;
    out.set(data.subarray(dataOffset, dataOffset + length), outOffset);
    outOffset += length;
    dataOffset += length;
  }

  writeUint32(out, outOffset, adler32(data));
  return out;
}

function asciiBytes(value) {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index);
  }
  return bytes;
}

function concatBytes(parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
}

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function adler32(data) {
  let a = 1;
  let b = 0;
  for (let index = 0; index < data.length; index += 1) {
    a = (a + data[index]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[index] = c >>> 0;
  }
  return table;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function toDataUrl(b64, format) {
  if (String(b64).startsWith("data:")) return b64;
  return `data:${mimeTypeForFormat(format)};base64,${stripDataUrl(b64)}`;
}

function base64ToArrayBuffer(base64) {
  const binary = atob(stripDataUrl(base64));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function getPngSize(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) return null;
  const view = new DataView(buffer);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

function normalizeBounds(bounds) {
  if (!bounds) return null;
  const left = toNumber(bounds.left ?? bounds._left);
  const top = toNumber(bounds.top ?? bounds._top);
  const right = toNumber(bounds.right ?? bounds._right);
  const bottom = toNumber(bounds.bottom ?? bounds._bottom);
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function toNumber(value) {
  if (typeof value === "number") return value;
  if (value && typeof value._value === "number") return value._value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampInteger(value, min, max, fallback) {
  return Math.round(clampNumber(value, min, max, fallback));
}

function cleanObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== "" && value !== undefined && value !== null)
  );
}

function normalizeBaseUrl(value) {
  let url = String(value || "").trim().replace(/\/+$/, "");
  url = url.replace(/^(https?:\/\/)(?:localhost|127\.0\.0\.1):9456(\/|$)/i, `http://127.0.0.1:49456$2`);
  url = url.replace(/\/(?:v1\/)?(?:chat\/completions|images\/generations|images\/edits|models)$/i, "");
  return url.replace(/\/+$/, "");
}

function normalizePath(value) {
  let path = String(value || "");
  if (/^https?:\/\//i.test(path)) {
    return path.trim();
  }
  if (path.startsWith("/images/")) {
    path = `/v1${path}`;
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function buildApiUrl(baseUrl, path) {
  let endpoint = normalizePath(path);
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  const base = normalizeBaseUrl(baseUrl);
  if (/\/v1$/i.test(base) && /^\/v1(?:\/|$)/i.test(endpoint)) {
    endpoint = endpoint.replace(/^\/v1/i, "");
  }
  return `${base}${endpoint}`;
}

function readJsonLocal(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch (error) {
    return fallback;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}
