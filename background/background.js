/**
 * Background Service Worker (Manifest V3)
 * Manages Offscreen Document lifecycle and Tab Capture Stream IDs
 */

const OFFSCREEN_DOCUMENT_PATH = 'offscreen/offscreen.html';

// Listen for messages from popup or offscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'REQUEST_START_DUBBING') {
    handleStartDubbing(message.config)
      .then((res) => sendResponse({ success: true, ...res }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === 'REQUEST_STOP_DUBBING') {
    handleStopDubbing()
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === 'REQUEST_UPDATE_DUCKING') {
    chrome.runtime.sendMessage({
      action: 'UPDATE_DUCKING',
      duckingMode: message.duckingMode
    }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'REQUEST_UPDATE_DUBBED_VOLUME') {
    chrome.runtime.sendMessage({
      action: 'UPDATE_DUBBED_VOLUME',
      volume: message.volume
    }).catch(() => {});
    sendResponse({ success: true });
    return true;
  }
});

/**
 * Handle Start Dubbing
 */
async function handleStartDubbing(config) {
  // 1. Get active tab
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!activeTab || !activeTab.id) {
    throw new Error('لم يتم العثور على تبويبة نشطة لالتقاط الصوت.');
  }

  // 2. Get Tab Capture Stream ID
  const streamId = await new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: activeTab.id }, (id) => {
      if (chrome.runtime.lastError) {
        return reject(new Error(chrome.runtime.lastError.message));
      }
      resolve(id);
    });
  });

  // 3. Ensure Offscreen Document Exists
  await ensureOffscreenDocument();

  // 4. Send start command to offscreen (Fixed model: models/gemini-3.5-live-translate-preview)
  const response = await chrome.runtime.sendMessage({
    action: 'START_DUBBING',
    payload: {
      streamId: streamId,
      apiKey: config.apiKey,
      selectedModel: 'models/gemini-3.5-live-translate-preview',
      targetLanguage: config.targetLanguage || 'ar',
      duckingMode: config.duckingMode || 'duck',
      dubbedVolume: config.dubbedVolume !== undefined ? config.dubbedVolume : 1.0
    }
  });

  // Save active state to storage
  await chrome.storage.local.set({ isDubbing: true, activeTabId: activeTab.id });

  return response;
}

/**
 * Handle Stop Dubbing
 */
async function handleStopDubbing() {
  try {
    await chrome.runtime.sendMessage({ action: 'STOP_DUBBING' });
  } catch (e) {}

  await closeOffscreenDocument();
  await chrome.storage.local.set({ isDubbing: false });
}

/**
 * Ensure Offscreen Document is created
 */
async function ensureOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    return;
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'التقاط ومعالجة صوت التبويبة لدبلجته في الوقت الفعلي عبر Gemini Live API'
  });
}

/**
 * Close Offscreen Document
 */
async function closeOffscreenDocument() {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}
