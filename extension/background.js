// Service worker — sets up context menu for selection summarize

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "switchbay-selection",
    title: 'Ask Switchbay about "%s"',
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "switchbay-selection" && tab?.id) {
    chrome.storage.session.set({ pendingSelection: info.selectionText });
    chrome.action.openPopup();
  }
});
