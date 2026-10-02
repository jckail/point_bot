let reviewQueue: Promise<unknown> = Promise.resolve();

/** Both review surfaces share one extension-owned tab and one creation queue. */
export function openOwnedReviewTab(url: string): Promise<void> {
  const result = reviewQueue.then(async () => {
    const stored = await chrome.storage.session.get("assistantReviewTabId");
    const id = stored.assistantReviewTabId;
    let exists = false;
    if (typeof id === "number") {
      try { await chrome.tabs.get(id); exists = true; } catch { /* Closed. */ }
    }
    if (exists) await chrome.tabs.update(id as number, { url, active: true });
    else {
      const tab = await chrome.tabs.create({ url, active: true });
      if (tab.id !== undefined) await chrome.storage.session.set({ assistantReviewTabId: tab.id });
    }
  });
  reviewQueue = result.catch(() => undefined);
  return result;
}
