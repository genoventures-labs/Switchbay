const SERVER = "http://localhost:7842";

const $ = (id) => document.getElementById(id);

const statusDot = $("statusDot");
const pageTitle = $("pageTitle");
const selectionBanner = $("selectionBanner");
const selectionText = $("selectionText");
const clearSelection = $("clearSelection");
const questionInput = $("questionInput");
const sendBtn = $("sendBtn");
const responseArea = $("responseArea");
const divider = $("divider");

let pageContent = "";
let pageUrl = "";
let activeSelection = "";

// ── Startup ───────────────────────────────────────────────────────────────────

async function init() {
  await Promise.all([checkServer(), loadPageContext()]);
}

async function checkServer() {
  try {
    const res = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      statusDot.className = "status-dot ok";
      statusDot.title = "Switchbay server running";
      return;
    }
  } catch {}
  statusDot.className = "status-dot err";
  statusDot.title = "Server offline — run: switchbay extension serve";
}

async function loadPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    pageTitle.textContent = tab.title ?? tab.url ?? "Unknown page";

    const result = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTENT" });
    pageContent = result.content ?? "";
    pageUrl = result.url ?? tab.url ?? "";

    // Check if a selection was triggered via context menu
    const stored = await chrome.storage.session.get("pendingSelection");
    if (stored.pendingSelection) {
      setSelection(stored.pendingSelection);
      await chrome.storage.session.remove("pendingSelection");
    } else if (result.selection) {
      setSelection(result.selection);
    }
  } catch {
    pageTitle.textContent = tab?.title ?? "Unknown page";
  }
}

function setSelection(text) {
  activeSelection = text;
  selectionText.textContent = text;
  selectionBanner.classList.add("visible");
}

clearSelection.addEventListener("click", () => {
  activeSelection = "";
  selectionBanner.classList.remove("visible");
});

// ── Quick action buttons ──────────────────────────────────────────────────────

document.querySelectorAll(".btn[data-action]").forEach((btn) => {
  btn.addEventListener("click", () => ask(btn.dataset.action));
});

// ── Ask input ────────────────────────────────────────────────────────────────

sendBtn.addEventListener("click", () => {
  const q = questionInput.value.trim();
  if (q) ask("ask", q);
});

questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const q = questionInput.value.trim();
    if (q) ask("ask", q);
  }
});

// ── Core ask function ─────────────────────────────────────────────────────────

async function ask(action, question = "") {
  if (statusDot.classList.contains("err")) {
    showError("Switchbay server is not running.\n\nStart it with:\n  switchbay extension serve");
    return;
  }

  setLoading(true);
  questionInput.value = "";

  try {
    const body = {
      action,
      question,
      content: pageContent,
      selection: activeSelection,
      url: pageUrl,
      title: pageTitle.textContent,
    };

    const res = await fetch(`${SERVER}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
    showResponse(data.response);
  } catch (err) {
    if (err.name === "TimeoutError") {
      showError("Request timed out. The AI is taking too long — try a shorter question.");
    } else {
      showError(err.message ?? "Something went wrong.");
    }
  } finally {
    setLoading(false);
  }
}

// ── UI state helpers ──────────────────────────────────────────────────────────

function setLoading(on) {
  const btns = document.querySelectorAll(".btn, #sendBtn");
  btns.forEach((b) => (b.disabled = on));

  if (on) {
    divider.classList.remove("hidden");
    responseArea.innerHTML = `<div class="loading"><div class="spinner"></div>Thinking…</div>`;
  }
}

function showResponse(text) {
  divider.classList.remove("hidden");
  responseArea.innerHTML = "";

  const pre = document.createElement("div");
  pre.className = "response-text";
  pre.innerHTML = renderMarkdown(text);
  responseArea.appendChild(pre);

  const copy = document.createElement("button");
  copy.className = "copy-btn";
  copy.textContent = "Copy";
  copy.addEventListener("click", () => {
    navigator.clipboard.writeText(text);
    copy.textContent = "Copied!";
    setTimeout(() => (copy.textContent = "Copy"), 1500);
  });
  responseArea.appendChild(copy);
}

function showError(msg) {
  divider.classList.remove("hidden");
  const pre = document.createElement("div");

  if (msg.includes("switchbay extension serve")) {
    pre.className = "server-hint";
    pre.textContent = msg;
  } else {
    pre.className = "error-text";
    pre.textContent = msg;
  }

  responseArea.innerHTML = "";
  responseArea.appendChild(pre);
}

// Very minimal markdown renderer — handles bold, bullets, code
function renderMarkdown(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^[\-\*] (.+)/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/\n/g, "<br>");
}

init();
