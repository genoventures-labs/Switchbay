// Injected into every page — collects page text and selection on request

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_PAGE_CONTENT") {
    const selection = window.getSelection()?.toString().trim() ?? "";
    const content = extractPageText();
    sendResponse({ content, selection, url: location.href, title: document.title });
  }
  return true; // keep channel open for async
});

function extractPageText() {
  // Prefer article / main content zones; fall back to body
  const zones = [
    document.querySelector("article"),
    document.querySelector("main"),
    document.querySelector('[role="main"]'),
    document.querySelector(".content"),
    document.querySelector("#content"),
    document.body,
  ];
  const node = zones.find(Boolean) ?? document.body;

  // Strip script/style/nav/header/footer noise
  const clone = node.cloneNode(true);
  for (const tag of ["script", "style", "nav", "header", "footer", "aside", "noscript", "iframe"]) {
    for (const el of clone.querySelectorAll(tag)) el.remove();
  }
  return clone.innerText.replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
}
