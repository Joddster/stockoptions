// Optional: presets used for quick setup and (optionally) live pricing updates
const stockPresets = [
  {
    ticker: "AAPL",
    name: "Apple Inc.",
    stockPrice: 192.15,
    stockMove: 2,
    optionType: "call",
    strikePrice: 195,
    daysToExpiration: 30,
    impliedVol: 32,
    riskFreeRate: 3,
    targetProfit: 1000,
  },
  {
    ticker: "MSFT",
    name: "Microsoft Corp.",
    stockPrice: 415.39,
    stockMove: 3.5,
    optionType: "call",
    strikePrice: 420,
    daysToExpiration: 35,
    impliedVol: 28,
    riskFreeRate: 3,
    targetProfit: 1000,
  },
  {
    ticker: "TSLA",
    name: "Tesla Inc.",
    stockPrice: 235.27,
    stockMove: 5,
    optionType: "call",
    strikePrice: 240,
    daysToExpiration: 25,
    impliedVol: 55,
    riskFreeRate: 3,
    targetProfit: 1000,
  },
  {
    ticker: "NVDA",
    name: "NVIDIA Corp.",
    stockPrice: 1185.5,
    stockMove: 40,
    optionType: "call",
    strikePrice: 1200,
    daysToExpiration: 40,
    impliedVol: 48,
    riskFreeRate: 3,
    targetProfit: 1000,
  },
  {
    ticker: "SPY",
    name: "SPDR S&P 500 ETF",
    stockPrice: 553.8,
    stockMove: 5,
    optionType: "call",
    strikePrice: 555,
    daysToExpiration: 20,
    impliedVol: 20,
    riskFreeRate: 3,
    targetProfit: 1000,
  },
];

const presetMap = new Map(stockPresets.map((preset) => [preset.ticker, preset]));

// Optional live-quote API configuration.
// NOTE: This app works without any API. To enable live prices with Finnhub:
//   enabled: true
//   baseUrl: "https://finnhub.io/api/v1/quote"
//   apiKey: "YOUR_FINNHUB_TOKEN_HERE"
const QUOTE_API = {
  enabled: true, // set to true after configuring baseUrl and apiKey
  baseUrl: "https://finnhub.io/api/v1/quote",
  apiKey: "d4mf8v9r01qjidhvf0pgd4mf8v9r01qjidhvf0q0",
  // Build the full URL for a given symbol. Finnhub shape: /quote?symbol=SYM&token=KEY
  buildUrl(symbol) {
    if (!this.baseUrl || !this.apiKey) return null;
    const url = new URL(this.baseUrl);
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("token", this.apiKey);
    return url.toString();
  },
  // Extract last price from the provider JSON
  // For Finnhub quote: { c: current price, h, l, o, pc, t }
  extractPrice(json) {
    if (!json) return null;
    if (typeof json.c === "number") return json.c;
    if (typeof json.price === "number") return json.price;
    return null;
  },
  // How often to refresh quotes (in ms)
  activePollMs: 2000, // active ticker: ~2s (safer for free tier)
  backgroundPollMs: 15000, // other watchlist tickers: ~15s
};

// Cache of latest live prices per ticker
const livePrices = new Map();

const inputIds = [
  "ticker",
  "stockPrice",
  "stockMove",
  "optionType",
  "strikePrice",
  "daysToExpiration",
  "impliedVol",
  "riskFreeRate",
  "targetProfit",
  "contractOverride",
];

const inputs = Object.fromEntries(
  inputIds.map((id) => [id, document.getElementById(id)])
);

const outputs = {
  delta: document.querySelector('[data-output="delta"]'),
  perContract: document.querySelector('[data-output="perContract"]'),
  contracts: document.querySelector('[data-output="contracts"]'),
  contractsPrimary: document.querySelector('[data-output="contractsPrimary"]'),
  totalCost: document.querySelector('[data-output="totalCost"]'),
  requiredMove: document.querySelector('[data-output="requiredMove"]'),
  optionPrice: document.querySelector('[data-output="optionPrice"]'),
  summary: document.querySelector('[data-output="summary"]'),
  lossValue: document.querySelector('[data-output="lossValue"]'),
  lossCaption: document.querySelector('[data-output="lossCaption"]'),
  contractNote: document.querySelector('[data-output="contractNote"]'),
};

const selectedTickerOutput = document.querySelector('[data-output="selectedTicker"]');
const stockListEl = document.getElementById("stockList");
const hotkeyStatusEl = document.getElementById("hotkeyStatus");
const strikeChoicesEl = document.getElementById("strikeChoices");
const layoutSurface = document.querySelector("[data-layout-surface]");
const editorToggleBtn = document.getElementById("editorToggle");
const saveLayoutBtn = document.getElementById("saveLayout");
const resetLayoutBtn = document.getElementById("resetLayout");

const stockButtons = new Map();
const tickerHotkeys = new Map();
const hotkeyMap = new Map();
let activeTicker = null;
let pendingHotkeyTicker = null;
const HOTKEY_STORAGE_KEY = "optionsHotkeys";
const HOTKEY_DEFAULT_MSG =
  "Click + on a ticker, press a key (letters/numbers or side mouse buttons) to bind it.";
const POINTER_HOTKEYS = {
  3: { id: "mouse4", label: "M4" }, // Browser Back button
  4: { id: "mouse5", label: "M5" }, // Browser Forward button
};
const LAYOUT_STORAGE_KEY = "optionsLayoutState";
const METRIC_VIS_STORAGE_KEY = "optionsMetricsHidden";

const NUMBER_PLACEHOLDER = "—";

let editorActive = false;
let draggingCard = null;
let dragPointerId = null;
let dragPlaceholder = null;
let layoutSnapshot = null;
let savedLayoutState = null;

inputIds.forEach((id) => {
  const el = inputs[id];
  const eventType = el.tagName === "SELECT" ? "change" : "input";
  el.addEventListener(eventType, handleChange);
});

initStockList();
handleChange();
setupHotkeys();
initLayoutEditor();
initMetricVisibility();
startQuotePolling();

function handleChange() {
  const state = collectInputs();
  const calc = calculateEstimates(state);
  render(calc, state);
  syncActiveSelection(state.ticker);
  renderStrikeChoices(state);
}

function collectInputs() {
  return {
    ticker: inputs.ticker.value.trim(),
    stockPrice: toNumber(inputs.stockPrice.value),
    stockMove: toNumber(inputs.stockMove.value),
    optionType: inputs.optionType.value,
    strikePrice: toNumber(inputs.strikePrice.value),
    daysToExpiration: toNumber(inputs.daysToExpiration.value),
    impliedVol: toNumber(inputs.impliedVol.value),
    riskFreeRate: toNumber(inputs.riskFreeRate.value) ?? 3,
    targetProfit: toNumber(inputs.targetProfit.value) ?? 0,
    contractOverride: toNumber(inputs.contractOverride.value),
  };
}

function calculateEstimates(state) {
  if (
    !isPositive(state.stockPrice) ||
    !isPositive(state.strikePrice) ||
    !isPositive(state.impliedVol) ||
    !isPositive(state.daysToExpiration)
  ) {
    return null;
  }

  const time = state.daysToExpiration / 365;
  const sigma = state.impliedVol / 100;
  const rate = (state.riskFreeRate ?? 3) / 100;
  const sqrtT = Math.sqrt(time);
  const logTerm = Math.log(state.stockPrice / state.strikePrice);
  const d1Numerator = logTerm + (rate + 0.5 * sigma * sigma) * time;
  const d1 = d1Numerator / (sigma * sqrtT); // Black-Scholes d1
  const d2 = d1 - sigma * sqrtT; // Black-Scholes d2

  const Nd1 = normalCdf(d1);
  const Nd2 = normalCdf(d2);

  const delta =
    state.optionType === "call"
      ? Nd1 // Call delta = N(d1)
      : Nd1 - 1; // Put delta = N(d1) - 1

  const optionPrice =
    state.optionType === "call"
      ? state.stockPrice * Nd1 -
        state.strikePrice * Math.exp(-rate * time) * Nd2 // Black-Scholes call price
      : state.strikePrice * Math.exp(-rate * time) * normalCdf(-d2) -
        state.stockPrice * normalCdf(-d1); // Black-Scholes put price

  const perContractPnL =
    typeof state.stockMove === "number"
      ? delta * 100 * state.stockMove // Approximate contract P&L = delta × 100 shares × move
      : null; // 100 shares per contract

  const targetProfit = Math.max(state.targetProfit ?? 0, 0);
  const autoContracts =
    perContractPnL && perContractPnL > 0
      ? Math.ceil(targetProfit / perContractPnL) // Contracts to reach target
      : null;

  const overrideValid =
    typeof state.contractOverride === "number" && state.contractOverride > 0;
  const contractsUsed = overrideValid
    ? state.contractOverride
    : autoContracts ?? null;

  const requiredMove =
    contractsUsed && delta && delta !== 0
      ? targetProfit / (delta * 100 * contractsUsed) // Reverse-solve required move
      : null;

  const totalCost =
    contractsUsed && optionPrice
      ? contractsUsed * optionPrice * 100 // Premium × 100 shares
      : null;

  return {
    delta,
    optionPrice,
    perContractPnL,
    autoContracts,
    contractsUsed,
    requiredMove,
    totalCost,
    overrideUsed: overrideValid,
    downsideLoss: calcDownsideLoss(delta, state.stockMove, contractsUsed),
    downsideMove: getDownsideMove(state.stockMove),
  };
}

function render(calc, state) {
  if (!calc) {
    setOutputsToPlaceholder();
    outputs.summary.textContent = "Enter the required inputs to see estimates.";
    renderLoss(null, state);
    updateSelectedTickerLabel(state.ticker);
    return;
  }

  outputs.delta.textContent = formatNumber(calc.delta, 3);
  outputs.optionPrice.textContent = formatCurrency(calc.optionPrice);
  outputs.perContract.textContent = calc.perContractPnL
    ? formatCurrency(calc.perContractPnL)
    : NUMBER_PLACEHOLDER;

  const contractsDisplay = calc.contractsUsed ?? calc.autoContracts;
  if (typeof contractsDisplay === "number" && Number.isFinite(contractsDisplay)) {
    const contractsText = `${contractsDisplay}`;
    outputs.contracts.textContent = contractsText;
    outputs.contractsPrimary.textContent = contractsText;

    const moveText =
      typeof state.stockMove === "number" && Number.isFinite(state.stockMove)
        ? `$${formatNumber(state.stockMove, 2)} move`
        : "an assumed move";
    const profitText = `$${formatNumber(state.targetProfit ?? 0, 2)} target`;
    if (outputs.contractNote) {
      outputs.contractNote.textContent = `Sizing for ${profitText} with ${moveText}.`;
    }
  } else {
    outputs.contracts.textContent = NUMBER_PLACEHOLDER;
    if (outputs.contractsPrimary) {
      outputs.contractsPrimary.textContent = NUMBER_PLACEHOLDER;
    }
    if (outputs.contractNote) {
      outputs.contractNote.textContent =
        "Provide target profit and expected move to size contracts.";
    }
  }

  outputs.totalCost.textContent = calc.totalCost
    ? formatCurrency(calc.totalCost)
    : NUMBER_PLACEHOLDER;

  outputs.requiredMove.textContent =
    typeof calc.requiredMove === "number"
      ? formatCurrency(calc.requiredMove)
      : NUMBER_PLACEHOLDER;

  outputs.summary.textContent = buildSummary(calc, state);
  renderLoss(calc, state);
  updateSelectedTickerLabel(state.ticker);
}

function setOutputsToPlaceholder() {
  Object.entries(outputs).forEach(([key, el]) => {
    if (!el || key === "summary") {
      return;
    }
    if (key === "contractNote") {
      el.textContent = "Provide a target and stock move to size properly.";
      return;
    }
    el.textContent = NUMBER_PLACEHOLDER;
  });
}

function buildSummary(calc, state) {
  const moveText =
    typeof state.stockMove === "number"
      ? `$${formatNumber(state.stockMove, 2)}`
      : "the assumed move";

  const profitText = `$${formatNumber(state.targetProfit ?? 0, 2)}`;

  if (!calc.contractsUsed) {
    return "Delta calculated. Add a price move to estimate contracts.";
  }

  if (calc.overrideUsed && calc.autoContracts) {
    return `To make ${profitText} with ${moveText}, you set ${calc.contractsUsed} contract(s); estimated need is ~${calc.autoContracts}.`;
  }

  if (calc.overrideUsed) {
    const estProfit =
      calc.perContractPnL && calc.contractsUsed
        ? calc.perContractPnL * calc.contractsUsed
        : null;
    return estProfit
      ? `Using ${calc.contractsUsed} contract(s) and ${moveText}, estimated profit is ${formatCurrency(
          estProfit
        )}.`
      : `Using ${calc.contractsUsed} contract(s); add a price move to see profit.`;
  }

  return `To make ${profitText} with ${moveText}, you need ~${calc.contractsUsed} contract(s).`;
}

function toNumber(value) {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num : null;
}

function isPositive(value) {
  return typeof value === "number" && value > 0;
}

function formatNumber(value, decimals = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NUMBER_PLACEHOLDER;
  }
  return Number(value).toFixed(decimals);
}

function formatCurrency(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return NUMBER_PLACEHOLDER;
  }
  const absVal = Math.abs(value).toFixed(2);
  return value < 0 ? `-$${absVal}` : `$${absVal}`;
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

// Numerical approximation of error function (Abramowitz and Stegun 7.1.26)
function erf(x) {
  const sign = Math.sign(x);
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1 / (1 + p * absX);
  const y =
    1 -
    (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) *
      Math.exp(-absX * absX);

  return sign * y;
}

function initStockList() {
  if (!stockListEl) {
    return;
  }

  stockPresets.forEach((preset, index) => {
    const item = document.createElement("div");
    item.className = "stock-item";
    item.tabIndex = 0;
    item.setAttribute("role", "button");
    item.innerHTML = `
      <div class="stock-symbol-row">
        <div class="symbol-left">
          <span class="stock-symbol">${preset.ticker}</span>
          <span class="stock-hotkey" data-role="hotkey"></span>
        </div>
        <div class="symbol-actions">
          <button type="button" class="remove-hotkey" aria-label="Remove hotkey from ${preset.ticker}">&times;</button>
          <button type="button" class="assign-hotkey" aria-label="Assign hotkey to ${preset.ticker}">+</button>
        </div>
      </div>
      <div class="stock-meta">${preset.name}</div>
    `;

    item.addEventListener("click", (event) => {
      if (event.target.closest(".assign-hotkey") || event.target.closest(".remove-hotkey")) {
        return;
      }
      applyPreset(preset);
    });

    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        applyPreset(preset);
      }
    });

    const assignBtn = item.querySelector(".assign-hotkey");
    assignBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      startHotkeyAssignment(preset.ticker);
    });

    const removeBtn = item.querySelector(".remove-hotkey");
    removeBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      removeHotkey(preset.ticker);
    });

    stockListEl.appendChild(item);
    stockButtons.set(preset.ticker, item);

    if (index === 0) {
      applyPreset(preset);
    }
  });

  restoreStoredHotkeys();
}

function applyPreset(preset) {
  inputs.ticker.value = preset.ticker ?? "";
  setNumericInput("stockPrice", preset.stockPrice);
  setNumericInput("stockMove", preset.stockMove);
  setNumericInput("strikePrice", preset.strikePrice);
  setNumericInput("daysToExpiration", preset.daysToExpiration);
  setNumericInput("impliedVol", preset.impliedVol);
  setNumericInput("riskFreeRate", preset.riskFreeRate);
  setNumericInput("targetProfit", preset.targetProfit);

  inputs.optionType.value = preset.optionType ?? "call";
  inputs.contractOverride.value =
    typeof preset.contractOverride === "number" ? preset.contractOverride : "";

  highlightStock(preset.ticker);
  handleChange();
}

function setNumericInput(id, value) {
  if (!inputs[id]) return;
  inputs[id].value =
    typeof value === "number" && Number.isFinite(value) ? value : "";
}

function highlightStock(ticker) {
  if (activeTicker === ticker) {
    return;
  }
  clearActiveStock();
  const button = stockButtons.get(ticker);
  if (button) {
    button.classList.add("active");
    activeTicker = ticker;
  }
}

function clearActiveStock() {
  if (!activeTicker) return;
  const activeButton = stockButtons.get(activeTicker);
  if (activeButton) {
    activeButton.classList.remove("active");
  }
  activeTicker = null;
}

function syncActiveSelection(currentTicker) {
  if (activeTicker && currentTicker !== activeTicker) {
    clearActiveStock();
  }
}

function updateSelectedTickerLabel(ticker) {
  if (!selectedTickerOutput) return;
  if (!ticker) {
    selectedTickerOutput.textContent = "Custom";
    return;
  }
  const preset = presetMap.get(ticker);
  selectedTickerOutput.textContent = preset
    ? `${preset.name} (${preset.ticker})`
    : ticker;
}

function getDownsideMove(stockMove) {
  if (typeof stockMove !== "number" || !Number.isFinite(stockMove) || stockMove === 0) {
    return null;
  }
  return -Math.abs(stockMove);
}

function calcDownsideLoss(delta, stockMove, contractsUsed) {
  const downsideMove = getDownsideMove(stockMove);
  if (
    typeof delta !== "number" ||
    !Number.isFinite(delta) ||
    downsideMove === null ||
    typeof contractsUsed !== "number"
  ) {
    return null;
  }

  const perContractDownside = delta * 100 * downsideMove;
  const totalDownside = perContractDownside * contractsUsed;
  if (!Number.isFinite(totalDownside) || totalDownside >= 0) {
    return 0;
  }
  return Math.abs(totalDownside);
}

function renderLoss(calc, state) {
  if (!outputs.lossValue || !outputs.lossCaption) return;
  const downsideMove = getDownsideMove(state.stockMove);
  if (!calc || downsideMove === null) {
    outputs.lossValue.textContent = NUMBER_PLACEHOLDER;
    outputs.lossCaption.textContent = "Set a move to see risk.";
    return;
  }

  const contractsText = calc.contractsUsed ?? calc.autoContracts ?? null;
  const moveLabel = formatNumber(Math.abs(downsideMove), 2);

  if (calc.downsideLoss === null) {
    outputs.lossValue.textContent = NUMBER_PLACEHOLDER;
    outputs.lossCaption.textContent = "Need contracts to compute downside.";
    return;
  }

  if (calc.downsideLoss === 0) {
    outputs.lossValue.textContent = "$0.00";
    outputs.lossCaption.textContent = `A $${moveLabel} drop does not reduce value for this setup.`;
    return;
  }

  outputs.lossValue.textContent = formatCurrency(-calc.downsideLoss);
  outputs.lossCaption.textContent = contractsText
    ? `${contractsText} contract(s) lose this amount if price falls $${moveLabel}.`
    : `Contracts not set; enter a move and target.`;
}

function setupHotkeys() {
  setHotkeyStatus(HOTKEY_DEFAULT_MSG);
  document.addEventListener("keydown", handleGlobalHotkey);
  document.addEventListener("pointerdown", handlePointerHotkey, true);
}

function startHotkeyAssignment(ticker) {
  pendingHotkeyTicker = ticker;
  stockButtons.forEach((btn) => btn.classList.remove("awaiting-hotkey"));
  const button = stockButtons.get(ticker);
  if (button) {
    button.classList.add("awaiting-hotkey");
  }
  setHotkeyStatus(`Assigning ${ticker}: press any letter or number.`);
}

function handleGlobalHotkey(event) {
  const key = normalizeHotkey(event);
  if (!key) {
    return;
  }

  if (pendingHotkeyTicker) {
    event.preventDefault();
    assignHotkey(pendingHotkeyTicker, key);
    setHotkeyStatus(
      `Assigned ${formatHotkeyLabel(key)} to ${pendingHotkeyTicker}. Click another + to bind more, or press shortcuts to load.`
    );
    pendingHotkeyTicker = null;
    stockButtons.forEach((btn) => btn.classList.remove("awaiting-hotkey"));
    return;
  }

  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag && ["input", "select", "textarea"].includes(activeTag)) {
    return;
  }

  const ticker = hotkeyMap.get(key);
  if (!ticker) {
    return;
  }
  const preset = presetMap.get(ticker);
  if (preset) {
    event.preventDefault();
    applyPreset(preset);
  }
}

function normalizeHotkey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) {
    return null;
  }
  const char = event.key.toLowerCase();
  if (!/[a-z0-9]/.test(char)) {
    return null;
  }
  return char;
}

function assignHotkey(ticker, key, options = {}) {
  const { skipPersist = false } = options;
  const normalized = key.toLowerCase();

  const existingTicker = hotkeyMap.get(normalized);
  if (existingTicker && existingTicker !== ticker) {
    removeHotkey(existingTicker, { silent: true, skipPersist: true });
  }

  if (tickerHotkeys.has(ticker)) {
    removeHotkey(ticker, { silent: true, skipPersist: true });
  }

  hotkeyMap.set(normalized, ticker);
  tickerHotkeys.set(ticker, normalized);
  updateHotkeyBadge(ticker, normalized);

  if (!skipPersist) {
    persistHotkeys();
  }
}

function updateHotkeyBadge(ticker, key) {
  const button = stockButtons.get(ticker);
  if (!button) return;
  const badge = button.querySelector('[data-role="hotkey"]');
  const removeBtn = button.querySelector(".remove-hotkey");
  if (!badge) return;

  if (key) {
    badge.textContent = formatHotkeyLabel(key);
    button.classList.add("has-hotkey");
    removeBtn?.classList.add("visible");
  } else {
    badge.textContent = "";
    button.classList.remove("has-hotkey");
    removeBtn?.classList.remove("visible");
  }
}

function setHotkeyStatus(message) {
  if (!hotkeyStatusEl) return;
  hotkeyStatusEl.textContent = message || HOTKEY_DEFAULT_MSG;
}

function handlePointerHotkey(event) {
  const mapping = POINTER_HOTKEYS[event.button];
  if (!mapping) {
    return;
  }

  if (pendingHotkeyTicker) {
    event.preventDefault();
    assignHotkey(pendingHotkeyTicker, mapping.id);
    setHotkeyStatus(
      `Assigned ${mapping.label} to ${pendingHotkeyTicker}. Click another + to bind more, or press shortcuts to load.`
    );
    pendingHotkeyTicker = null;
    stockButtons.forEach((btn) => btn.classList.remove("awaiting-hotkey"));
    return;
  }

  const activeTag = document.activeElement?.tagName?.toLowerCase();
  if (activeTag && ["input", "select", "textarea"].includes(activeTag)) {
    return;
  }

  const ticker = hotkeyMap.get(mapping.id);
  if (ticker) {
    event.preventDefault();
    const preset = presetMap.get(ticker);
    if (preset) {
      applyPreset(preset);
    }
  }
}

function formatHotkeyLabel(key) {
  if (!key) return "";
  if (key.startsWith("mouse")) {
    return key.replace("mouse", "M").toUpperCase();
  }
  return key.length === 1 ? key.toUpperCase() : key.toUpperCase();
}

function removeHotkey(ticker, options = {}) {
  const { silent = false, skipPersist = false } = options;
  const key = tickerHotkeys.get(ticker);
  if (!key) {
    if (!silent) {
      setHotkeyStatus(`${ticker} has no hotkey assigned.`);
    }
    return;
  }

  tickerHotkeys.delete(ticker);
  hotkeyMap.delete(key);
  updateHotkeyBadge(ticker, "");

  if (!skipPersist) {
    persistHotkeys();
  }

  if (!silent) {
    setHotkeyStatus(`Removed hotkey from ${ticker}.`);
  }
}

function persistHotkeys() {
  try {
    const data = Object.fromEntries(tickerHotkeys);
    localStorage.setItem(HOTKEY_STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.warn("Unable to persist hotkeys", error);
  }
}

function loadStoredHotkeys() {
  try {
    const raw = localStorage.getItem(HOTKEY_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to read stored hotkeys", error);
    return {};
  }
}

function restoreStoredHotkeys() {
  const stored = loadStoredHotkeys();
  Object.entries(stored).forEach(([ticker, key]) => {
    if (!stockButtons.has(ticker) || typeof key !== "string") {
      return;
    }
    assignHotkey(ticker, key, { skipPersist: true });
  });
  if (Object.keys(stored).length) {
    setHotkeyStatus("Hotkeys restored. Click + to rebind or × to clear.");
  }
}

function startQuotePolling() {
  if (!QUOTE_API.enabled) {
    return;
  }
  // Initial fetch on load for all tickers
  refreshAllQuotes();

  const activeInterval =
    QUOTE_API.activePollMs && Number.isFinite(QUOTE_API.activePollMs)
      ? QUOTE_API.activePollMs
      : 2000;
  const backgroundInterval =
    QUOTE_API.backgroundPollMs && Number.isFinite(QUOTE_API.backgroundPollMs)
      ? QUOTE_API.backgroundPollMs
      : 15000;

  // High-frequency polling for the active ticker
  setInterval(refreshActiveQuote, activeInterval);
  // Slower polling for the rest of the watchlist
  setInterval(refreshBackgroundQuotes, backgroundInterval);
}

async function refreshAllQuotes() {
  const tickers = stockPresets.map((p) => p.ticker).filter(Boolean);
  for (const ticker of tickers) {
    await refreshQuoteForTicker(ticker);
  }
}

async function refreshActiveQuote() {
  if (!QUOTE_API.enabled) return;
  // Use the highlighted ticker if available; fall back to input field
  const tickerFromHighlight = activeTicker;
  const tickerFromInput = inputs.ticker.value.trim();
  const symbol = (tickerFromHighlight || tickerFromInput || "").toUpperCase();
  if (!symbol) return;
  await refreshQuoteForTicker(symbol);
}

async function refreshBackgroundQuotes() {
  if (!QUOTE_API.enabled) return;
  const current = (activeTicker || inputs.ticker.value.trim() || "").toUpperCase();
  const tickers = stockPresets
    .map((p) => p.ticker)
    .filter(Boolean)
    .filter((t) => t.toUpperCase() !== current);

  for (const ticker of tickers) {
    await refreshQuoteForTicker(ticker);
  }
}

async function refreshQuoteForTicker(ticker) {
  if (!QUOTE_API.enabled) return;
  const url = QUOTE_API.buildUrl(ticker);
  if (!url) return;

  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const json = await res.json();
    const price = QUOTE_API.extractPrice(json);
    if (typeof price !== "number" || !Number.isFinite(price) || price <= 0) {
      return;
    }

    // Debug logging so you can verify live pricing is working
    console.log("Live quote", ticker, price);

    livePrices.set(ticker, price);
    const preset = presetMap.get(ticker);
    if (preset) {
      preset.stockPrice = price;
    }

    // If this ticker is currently active in the UI, update inputs and recalc
    if (inputs.ticker.value.trim().toUpperCase() === ticker.toUpperCase()) {
      inputs.stockPrice.value = price.toFixed(2);
      handleChange();
    }

    // Optionally, show live price in the watchlist subtitle
    const btn = stockButtons.get(ticker);
    if (btn) {
      const meta = btn.querySelector(".stock-meta");
      if (meta) {
        meta.textContent = `${preset?.name || ticker} · $${price.toFixed(2)}`;
      }
    }
  } catch (error) {
    // Swallow errors so a bad API response doesn't break the app
    console.warn("Quote refresh failed for", ticker, error);
  }
}

function initMetricVisibility() {
  const hiddenMetrics = loadHiddenMetrics();
  document
    .querySelectorAll(".metric-box[data-metric-id]")
    .forEach((box) => {
      const id = box.dataset.metricId;
      if (!id) return;
      if (hiddenMetrics.has(id)) {
        box.classList.add("card-hidden");
      }
      const btn = box.querySelector(".metric-remove");
      if (btn) {
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          toggleMetricHidden(id, true);
        });
      }
    });
}

function toggleMetricHidden(metricId, hidden) {
  const box = document.querySelector(`.metric-box[data-metric-id="${metricId}"]`);
  if (!box) return;
  box.classList.toggle("card-hidden", hidden);
  saveHiddenMetrics();
}

function loadHiddenMetrics() {
  try {
    const raw = localStorage.getItem(METRIC_VIS_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed);
  } catch {
    return new Set();
  }
}

function saveHiddenMetrics() {
  try {
    const ids = Array.from(
      document.querySelectorAll(".metric-box[data-metric-id].card-hidden")
    ).map((box) => box.dataset.metricId);
    localStorage.setItem(METRIC_VIS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

function renderStrikeChoices(state) {
  if (!strikeChoicesEl) return;
  strikeChoicesEl.innerHTML = "";

  const stockPrice = state.stockPrice;
  if (!isPositive(stockPrice)) {
    return;
  }

  const optionType = state.optionType || "call";
  const STEP = 2.5;
  const atm = Math.round(stockPrice / STEP) * STEP;
  const offsets = [STEP, 2 * STEP, 3 * STEP];

  const strikes = [];
  if (optionType === "call") {
    offsets.forEach((o) => strikes.push({ kind: "ITM", value: atm - o }));
    offsets.forEach((o) => strikes.push({ kind: "OTM", value: atm + o }));
  } else {
    offsets.forEach((o) => strikes.push({ kind: "ITM", value: atm + o }));
    offsets.forEach((o) => strikes.push({ kind: "OTM", value: atm - o }));
  }

  const filtered = strikes.filter((s) => s.value > 0);
  if (!filtered.length) return;

  const currentStrike = state.strikePrice;

  filtered.forEach((strike) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `strike-btn ${strike.kind === "ITM" ? "itm" : "otm"}`;
    if (typeof currentStrike === "number" && Math.abs(currentStrike - strike.value) < 0.001) {
      btn.classList.add("active");
    }
    btn.innerHTML = `<span>${strike.value.toFixed(2)}</span><small>${strike.kind}</small>`;
    btn.addEventListener("click", () => {
      inputs.strikePrice.value = strike.value.toFixed(2);
      handleChange();
    });
    strikeChoicesEl.appendChild(btn);
  });
}

function initLayoutEditor() {
  if (!layoutSurface) {
    return;
  }

  ensureCardRemoveButtons();
  editorToggleBtn?.addEventListener("click", toggleEditorMode);
  saveLayoutBtn?.addEventListener("click", handleSaveLayout);
  resetLayoutBtn?.addEventListener("click", resetLayout);

  const storedLayout = loadLayoutState();
  if (isValidLayoutState(storedLayout)) {
    savedLayoutState = storedLayout;
    applyLayoutState(storedLayout, { activateCustom: true });
  } else {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    savedLayoutState = null;
    clearAbsoluteLayout();
  }
}

function layoutCards() {
  if (!layoutSurface) {
    return [];
  }
  return Array.from(layoutSurface.querySelectorAll("[data-card-id]"));
}

function ensureCardRemoveButtons() {
  layoutCards().forEach((card) => {
    if (card.querySelector(".card-remove")) {
      return;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-remove";
    btn.innerHTML = "&times;";
    btn.setAttribute("aria-label", "Remove card");
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleCardHidden(card.dataset.cardId, true);
    });
    card.appendChild(btn);
  });
}

function toggleEditorMode() {
  if (!editorActive) {
    enterEditorMode();
  } else {
    exitEditorMode({ revert: true });
  }
}

function enterEditorMode() {
  if (editorActive || !layoutSurface) return;
  editorActive = true;

  layoutSnapshot = savedLayoutState
    ? JSON.parse(JSON.stringify(savedLayoutState))
    : captureCurrentLayout({ fallbackToFlow: true });

  document.body.classList.add("layout-edit-active");
  document.body.classList.remove("layout-custom-active");
  saveLayoutBtn?.removeAttribute("disabled");
  editorToggleBtn && (editorToggleBtn.textContent = "Exit Editor Mode");

  prepareCardsForAbsolute(layoutSnapshot, { fallbackToFlow: true });
  enableCardDragging();
  refreshSurfaceHeight();
}

function exitEditorMode({ revert }) {
  if (!editorActive) return;
  editorActive = false;
  document.body.classList.remove("layout-edit-active");
  disableCardDragging();
  saveLayoutBtn?.setAttribute("disabled", "true");
  editorToggleBtn && (editorToggleBtn.textContent = "Enter Editor Mode");

  if (revert) {
    if (savedLayoutState) {
      applyLayoutState(savedLayoutState, { activateCustom: true });
    } else {
      clearAbsoluteLayout();
    }
  }
  layoutSnapshot = null;
}

function handleSaveLayout() {
  if (!editorActive) return;
  const state = captureCurrentLayout();
  if (!isValidLayoutState(state)) {
    setHotkeyStatus?.("Unable to save layout; please reposition cards and try again.");
    return;
  }
  savedLayoutState = state;
  saveLayoutState(state);
  exitEditorMode({ revert: false });
  applyLayoutState(state, { activateCustom: true });
}

function resetLayout() {
  localStorage.removeItem(LAYOUT_STORAGE_KEY);
  savedLayoutState = null;
  exitEditorMode({ revert: false });
  clearAbsoluteLayout();
}

function captureCurrentLayout({ fallbackToFlow = false } = {}) {
  if (!layoutSurface) return null;
  const cards = {};
  const hidden = [];
  const surfaceRect = layoutSurface.getBoundingClientRect();

  layoutCards().forEach((card) => {
    const id = card.dataset.cardId;
    if (card.classList.contains("card-hidden")) {
      hidden.push(id);
      return;
    }
    const rect = card.getBoundingClientRect();
    cards[id] = {
      top: rect.top - surfaceRect.top,
      left: rect.left - surfaceRect.left,
      width: rect.width,
    };
  });

  if (!Object.keys(cards).length && fallbackToFlow) {
    layoutCards().forEach((card) => {
      const id = card.dataset.cardId;
      const rect = card.getBoundingClientRect();
      cards[id] = {
        top: rect.top - surfaceRect.top,
        left: rect.left - surfaceRect.left,
        width: rect.width,
      };
    });
  }

  return {
    cards,
    hidden,
    surfaceHeight: layoutSurface.offsetHeight || layoutSurface.scrollHeight,
  };
}

function prepareCardsForAbsolute(state, { fallbackToFlow = false } = {}) {
  if (!layoutSurface) return;
  const positions = state?.cards || {};
  const hiddenSet = new Set(state?.hidden || []);
  const surfaceRect = layoutSurface.getBoundingClientRect();

  layoutCards().forEach((card) => {
    const id = card.dataset.cardId;
    const rect = positions[id];
    let coords = rect;
    if (!coords && fallbackToFlow) {
      const liveRect = card.getBoundingClientRect();
      coords = {
        top: liveRect.top - surfaceRect.top,
        left: liveRect.left - surfaceRect.left,
        width: liveRect.width,
      };
    }
    if (coords) {
      setCardAbsolute(card, coords);
    }
    card.classList.toggle("card-hidden", hiddenSet.has(id));
  });

  refreshSurfaceHeight(state?.surfaceHeight);
}

function applyLayoutState(state, { activateCustom = false } = {}) {
  if (!state || !layoutSurface) return;
  prepareCardsForAbsolute(state, { fallbackToFlow: true });
  if (activateCustom) {
    document.body.classList.add("layout-custom-active");
  } else if (!editorActive) {
    document.body.classList.remove("layout-custom-active");
    clearAbsoluteLayout();
  }
}

function setCardAbsolute(card, coords) {
  card.style.position = "absolute";
  card.style.top = `${coords.top}px`;
  card.style.left = `${coords.left}px`;
  if (coords.width) {
    card.style.width = `${coords.width}px`;
  }
  card.style.margin = "0";
  card.style.zIndex = card.style.zIndex || "1";
}

function clearAbsoluteLayout() {
  if (!layoutSurface) return;
  layoutSurface.style.height = "";
  document.body.classList.remove("layout-custom-active");
  layoutCards().forEach((card) => {
    if (dragPlaceholder && dragPlaceholder.parentNode) {
      dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    }
    card.style.position = "";
    card.style.top = "";
    card.style.left = "";
    card.style.width = "";
    card.style.margin = "";
    card.style.zIndex = "";
    card.classList.remove("card-hidden");
  });
}

function enableCardDragging() {
  layoutCards().forEach((card) => {
    card.addEventListener("pointerdown", handleCardPointerDown);
  });
}

function disableCardDragging() {
  layoutCards().forEach((card) => {
    card.removeEventListener("pointerdown", handleCardPointerDown);
    card.classList.remove("dragging");
  });
  draggingCard = null;
  dragPointerId = null;
}

function handleCardPointerDown(event) {
  if (!editorActive || event.button !== 0) return;
  event.preventDefault();
  const blocked = event.target.closest(
    ".card-remove, .assign-hotkey, .remove-hotkey, button, input, select, textarea"
  );
  if (blocked) {
    return;
  }

  const card = event.currentTarget;
  const cards = layoutCards();
  const cardIndex = cards.indexOf(card);
  if (cardIndex === -1) return;

  const previousCard = cards
    .slice(0, cardIndex)
    .reverse()
    .find((c) => !c.classList.contains("card-hidden"));

  const surfaceRectOnStart = layoutSurface.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  const offsetX = event.clientX - cardRect.left;
  const offsetY = event.clientY - cardRect.top;

  const placeholder = document.createElement("div");
  placeholder.className = "drag-placeholder";
  placeholder.style.width = `${cardRect.width}px`;
  placeholder.style.height = `${cardRect.height}px`;

  if (previousCard && previousCard.nextElementSibling) {
    previousCard.parentNode.insertBefore(placeholder, previousCard.nextElementSibling);
  } else {
    card.parentNode.insertBefore(placeholder, card.nextElementSibling);
  }
  dragPlaceholder = placeholder;

  const placeholderRect = placeholder.getBoundingClientRect();
  let maxBottomDuringDrag = cardRect.bottom - surfaceRectOnStart.top;

  draggingCard = card;
  dragPointerId = event.pointerId;
  card.classList.add("dragging");
  card.style.position = "absolute";
  card.style.left = `${cardRect.left - surfaceRectOnStart.left}px`;
  card.style.top = `${cardRect.top - surfaceRectOnStart.top}px`;
  card.style.width = `${cardRect.width}px`;
  card.style.zIndex = "1000";
  card.dataset.prevZ = card.dataset.prevZ || "";
  card.setPointerCapture(event.pointerId);

  const moveHandler = (moveEvent) => {
    if (moveEvent.pointerId !== dragPointerId) return;
    moveEvent.preventDefault();
    const newLeft = moveEvent.clientX - surfaceRectOnStart.left - offsetX;
    const newTop = moveEvent.clientY - surfaceRectOnStart.top - offsetY;
    card.style.left = `${newLeft}px`;
    card.style.top = `${newTop}px`;
    maxBottomDuringDrag = Math.max(maxBottomDuringDrag, newTop + cardRect.height);
  };

  const upHandler = (upEvent) => {
    if (upEvent.pointerId !== dragPointerId) return;
    card.classList.remove("dragging");
    card.releasePointerCapture(upEvent.pointerId);
    card.removeEventListener("pointermove", moveHandler);
    card.removeEventListener("pointerup", upHandler);
    card.removeEventListener("pointercancel", upHandler);
    draggingCard = null;
    dragPointerId = null;
    card.style.zIndex = card.dataset.prevZ || "";
    delete card.dataset.prevZ;
    card.style.position = "absolute";
    if (dragPlaceholder && dragPlaceholder.parentNode) {
      dragPlaceholder.parentNode.removeChild(dragPlaceholder);
    }
    dragPlaceholder = null;
    refreshSurfaceHeight(maxBottomDuringDrag + 60);
  };

  card.addEventListener("pointermove", moveHandler);
  card.addEventListener("pointerup", upHandler);
  card.addEventListener("pointercancel", upHandler);
}

function toggleCardHidden(cardId, hidden) {
  const card = layoutCards().find((c) => c.dataset.cardId === cardId);
  if (!card) return;
  card.classList.toggle("card-hidden", hidden);
  refreshSurfaceHeight();
}

function refreshSurfaceHeight(fallbackHeight) {
  if (!layoutSurface) return;
  const cards = layoutCards().filter((card) => !card.classList.contains("card-hidden"));
  let maxBottom = 0;
  cards.forEach((card) => {
    const bottom = card.offsetTop + card.offsetHeight;
    if (bottom > maxBottom) {
      maxBottom = bottom;
    }
  });
  const computed = Math.max(maxBottom + 60, fallbackHeight || 0);
  layoutSurface.style.height = `${Math.max(computed, 600)}px`;
}

function saveLayoutState(state) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to save layout", error);
  }
}

function loadLayoutState() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn("Unable to load saved layout", error);
    return null;
  }
}

function isValidLayoutState(state) {
  if (!state || typeof state !== "object") return false;
  const cards = state.cards;
  if (!cards || typeof cards !== "object") return false;
  const ids = Object.keys(cards);
  if (!ids.length) return false;
  return ids.every((id) => {
    const coords = cards[id];
    return (
      coords &&
      Number.isFinite(coords.top) &&
      Number.isFinite(coords.left)
    );
  });
}

