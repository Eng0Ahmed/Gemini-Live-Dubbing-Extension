/**
 * Popup Script for Gemini Live Audio Dubber
 * Pro Audio Studio Suite: Master Dubbed Volume Control & Automatic Speaker Voice Matching
 */

document.addEventListener('DOMContentLoaded', async () => {
  // UI Element References
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleApiKeyVisibility = document.getElementById('toggleApiKeyVisibility');
  const getApiKeyLink = document.getElementById('getApiKeyLink');
  const dubbedVolumeSlider = document.getElementById('dubbedVolumeSlider');
  const volumeValueText = document.getElementById('volumeValueText');
  const duckingSelect = document.getElementById('duckingSelect');
  const toggleDubbingBtn = document.getElementById('toggleDubbingBtn');
  const btnIcon = document.getElementById('btnIcon');
  const btnText = document.getElementById('btnText');
  const statusBadge = document.getElementById('statusBadge');
  const statusDetails = document.getElementById('statusDetails');
  const visualizerContainer = document.querySelector('.visualizer-container');
  const timerBadge = document.getElementById('timerBadge');
  const presetBtns = document.querySelectorAll('.preset-btn');

  let isDubbingActive = false;
  let timerInterval = null;
  let secondsElapsed = 0;

  const FIXED_MODEL = 'models/gemini-3.5-live-translate-preview';

  // Open Google AI Studio API Keys page in new tab
  if (getApiKeyLink) {
    getApiKeyLink.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: 'https://aistudio.google.com/api-keys' });
    });
  }

  // 1. Load Saved Settings & State from Local Storage
  const storage = await chrome.storage.local.get([
    'apiKey',
    'dubbedVolume',
    'duckingMode',
    'activePreset',
    'isDubbing',
    'dubbingStartTime'
  ]);

  if (storage.apiKey) apiKeyInput.value = storage.apiKey;
  if (storage.duckingMode) duckingSelect.value = storage.duckingMode;
  
  if (storage.dubbedVolume !== undefined) {
    dubbedVolumeSlider.value = storage.dubbedVolume;
    volumeValueText.textContent = `${storage.dubbedVolume}%`;
  }

  if (storage.activePreset) {
    presetBtns.forEach(b => {
      if (b.dataset.preset === storage.activePreset) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  }

  if (storage.isDubbing) {
    setUiDubbingState('live', 'الاتصال نشط - جاري الدبلجة التلقائية المباشرة');
    if (storage.dubbingStartTime) {
      secondsElapsed = Math.floor((Date.now() - storage.dubbingStartTime) / 1000);
      startTimer();
    }
  } else {
    setUiDubbingState('disconnected', 'جاهز للبدء');
  }

  // 2. Master Dubbed Volume Slider Change Event
  dubbedVolumeSlider.addEventListener('input', () => {
    const vol = dubbedVolumeSlider.value;
    volumeValueText.textContent = `${vol}%`;
    chrome.storage.local.set({ dubbedVolume: vol });

    if (isDubbingActive) {
      chrome.runtime.sendMessage({ action: 'REQUEST_UPDATE_DUBBED_VOLUME', volume: vol / 100 });
    }
  });

  // Preset Buttons Click Event
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const preset = btn.dataset.preset;
      chrome.storage.local.set({ activePreset: preset });
    });
  });

  // Ducking Control Change Event
  duckingSelect.addEventListener('change', () => {
    const duckingMode = duckingSelect.value;
    chrome.storage.local.set({ duckingMode });
    if (isDubbingActive) {
      chrome.runtime.sendMessage({ action: 'REQUEST_UPDATE_DUCKING', duckingMode });
    }
  });

  apiKeyInput.addEventListener('change', () => {
    chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() });
  });

  toggleApiKeyVisibility.addEventListener('click', () => {
    if (apiKeyInput.type === 'password') {
      apiKeyInput.type = 'text';
      toggleApiKeyVisibility.textContent = '🔒';
    } else {
      apiKeyInput.type = 'password';
      toggleApiKeyVisibility.textContent = '👁️';
    }
  });

  // 3. Start / Stop Action Button Click
  toggleDubbingBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!isDubbingActive) {
      if (!apiKey) {
        alert('يرجى إدخال مفتاح API الخاص بـ Google Gemini أولاً.');
        apiKeyInput.focus();
        return;
      }

      setUiDubbingState('connecting', 'جاري الاتصال وسحب صوت التبويبة...');

      const config = {
        apiKey: apiKey,
        selectedModel: FIXED_MODEL,
        duckingMode: duckingSelect.value,
        dubbedVolume: dubbedVolumeSlider.value / 100,
        targetLanguage: 'ar'
      };

      const now = Date.now();
      chrome.storage.local.set({ dubbingStartTime: now });

      chrome.runtime.sendMessage({ action: 'REQUEST_START_DUBBING', config }, (response) => {
        if (chrome.runtime.lastError || (response && !response.success)) {
          const errMsg = (response && response.error) || chrome.runtime.lastError?.message || 'تعذر بدء الدبلجة';
          setUiDubbingState('error', errMsg);
        }
      });
    } else {
      setUiDubbingState('connecting', 'جاري إيقاف الخدمة...');
      chrome.runtime.sendMessage({ action: 'REQUEST_STOP_DUBBING' }, () => {
        setUiDubbingState('disconnected', 'تم الإيقاف');
      });
    }
  });

  // 4. Listen for Background / Offscreen Runtime Messages
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'DUBLING_STATUS_CHANGED') {
      setUiDubbingState(message.state, message.details);
    }
  });

  /**
   * UI State & Timer Controls
   */
  function setUiDubbingState(state, detailsText) {
    statusBadge.className = `status-badge status-${state}`;
    statusDetails.textContent = detailsText || '';

    if (state === 'live') {
      isDubbingActive = true;
      btnIcon.textContent = '⏹';
      btnText.textContent = 'إيقاف الدبلجة المباشرة';
      toggleDubbingBtn.classList.add('active-stop');
      statusBadge.textContent = 'مباشر (Live)';
      visualizerContainer.classList.add('active');
      startTimer();
    } else if (state === 'connecting') {
      isDubbingActive = false;
      btnIcon.textContent = '⏳';
      btnText.textContent = 'جاري الاتصال...';
      toggleDubbingBtn.classList.remove('active-stop');
      statusBadge.textContent = 'جاري الاتصال';
      visualizerContainer.classList.remove('active');
    } else if (state === 'error') {
      isDubbingActive = false;
      btnIcon.textContent = '▶';
      btnText.textContent = 'إعادة المحاولة';
      toggleDubbingBtn.classList.remove('active-stop');
      statusBadge.textContent = 'خطأ';
      visualizerContainer.classList.remove('active');
      stopTimer();
    } else {
      isDubbingActive = false;
      btnIcon.textContent = '▶';
      btnText.textContent = 'بدء الدبلجة التلقائية المباشرة';
      toggleDubbingBtn.classList.remove('active-stop');
      statusBadge.textContent = 'غير متصل';
      visualizerContainer.classList.remove('active');
      stopTimer();
    }
  }

  function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      secondsElapsed++;
      const hrs = String(Math.floor(secondsElapsed / 3600)).padStart(2, '0');
      const mins = String(Math.floor((secondsElapsed % 3600) / 60)).padStart(2, '0');
      const secs = String(secondsElapsed % 60).padStart(2, '0');
      timerBadge.textContent = `${hrs}:${mins}:${secs}`;
    }, 1000);
  }

  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    secondsElapsed = 0;
    timerBadge.textContent = '00:00:00';
  }
});
