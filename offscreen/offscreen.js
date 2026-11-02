/**
 * Offscreen Document Script
 * Captures tab media stream, sets up AudioWorklet, opens bidirectional WebSocket
 * connection to Google Gemini Live API, streams audio input, and plays back dubbed audio output.
 */

let audioContext = null;
let mediaStream = null;
let tabGainNode = null;
let dubbedGainNode = null;
let workletNode = null;
let webSocket = null;
let nextAudioStartTime = 0;
let isDubbingActive = false;
let startTimeSeconds = 0;
let currentApiKey = '';
let currentDubbedVolume = 1.0;
const FIXED_MODEL = 'models/gemini-3.5-live-translate-preview';

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.action) {
    case 'START_DUBBING':
      startDubbing(message.payload);
      sendResponse({ status: 'starting' });
      break;
    case 'STOP_DUBBING':
      stopDubbing();
      sendResponse({ status: 'stopped' });
      break;
    case 'UPDATE_DUCKING':
      updateDuckingMode(message.duckingMode);
      sendResponse({ status: 'ducking_updated' });
      break;
    case 'UPDATE_DUBBED_VOLUME':
      updateDubbedVolume(message.volume);
      sendResponse({ status: 'volume_updated' });
      break;
  }
  return true;
});

/**
 * Start tab audio capture & Gemini WebSocket session
 */
async function startDubbing(config) {
  const {
    streamId,
    apiKey,
    duckingMode = 'duck',
    dubbedVolume = 1.0
  } = config;

  currentApiKey = apiKey;
  currentDubbedVolume = dubbedVolume;
  
  if (isDubbingActive) {
    await stopDubbing();
  }

  try {
    broadcastStatus('connecting', 'جاري بدء الاتصال والتقاط الصوت...');
    startTimeSeconds = Math.floor(Date.now() / 1000);

    // 1. Capture Active Tab Stream
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: streamId
        }
      },
      video: false
    });

    // 2. Initialize Web Audio API Context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const mediaSource = audioContext.createMediaStreamSource(mediaStream);

    // 3. Tab Audio Ducking / Muting Node (Control Original Audio Volume)
    tabGainNode = audioContext.createGain();
    setGainMode(tabGainNode, duckingMode);
    mediaSource.connect(tabGainNode);
    tabGainNode.connect(audioContext.destination);

    // 4. Dubbed Audio Master Gain Node
    dubbedGainNode = audioContext.createGain();
    dubbedGainNode.gain.setValueAtTime(currentDubbedVolume, audioContext.currentTime);
    dubbedGainNode.connect(audioContext.destination);

    // 5. Load AudioWorklet for PCM 16kHz conversion
    await audioContext.audioWorklet.addModule('audio-processor.js');
    workletNode = new AudioWorkletNode(audioContext, 'audio-processor');
    mediaSource.connect(workletNode);

    // 6. Connect WebSocket to Gemini Multimodal Live API
    connectGeminiWebSocket(apiKey);

    // 7. Handle Incoming PCM Chunks from Worklet & Stream via WebSocket
    workletNode.port.onmessage = (event) => {
      if (!isDubbingActive || !webSocket || webSocket.readyState !== WebSocket.OPEN) return;

      const pcmArrayBuffer = event.data;
      const base64Audio = arrayBufferToBase64(pcmArrayBuffer);

      const realtimeInputMessage = {
        realtimeInput: {
          mediaChunks: [
            {
              mimeType: "audio/pcm;rate=16000",
              data: base64Audio
            }
          ]
        }
      };

      webSocket.send(JSON.stringify(realtimeInputMessage));
    };

  } catch (err) {
    console.error("Failed to start dubbing in offscreen:", err);
    broadcastStatus('error', 'تعذر الوصول إلى صوت التبويبة: ' + err.message);
    await stopDubbing();
  }
}

/**
 * Open WebSocket connection to Gemini Multimodal Live API
 */
function connectGeminiWebSocket(apiKey) {
  const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${apiKey}`;
  webSocket = new WebSocket(wsUrl);

  webSocket.onopen = () => {
    broadcastStatus('live', 'الاتصال نشط - الدبلجة الفورية إلى اللغة العربية مفعلة');
    sendSetupPayload(FIXED_MODEL);
    isDubbingActive = true;
  };

  webSocket.onmessage = async (event) => {
    try {
      let messageData;
      if (event.data instanceof Blob) {
        messageData = JSON.parse(await event.data.text());
      } else {
        messageData = JSON.parse(event.data);
      }

      handleServerMessage(messageData);
    } catch (err) {
      console.error("Error parsing Gemini WebSocket message:", err);
    }
  };

  webSocket.onerror = (error) => {
    console.error("Gemini WebSocket Error:", error);
    broadcastStatus('error', 'خطأ في اتصال WebSocket مع Gemini API.');
  };

  webSocket.onclose = (event) => {
    console.log("Gemini WebSocket Closed:", event.code, event.reason);
    if (isDubbingActive) {
      let reasonMsg = 'تم قطع الاتصال بالخدمة';
      if (event.reason) {
        reasonMsg = `تم قطع الاتصال: ${event.reason}`;
      }
      broadcastStatus('error', reasonMsg);
    }
  };
}

/**
 * Send Setup Message to Gemini WebSocket with Strict Arabic Dubbing Instructions for ALL Source Languages
 */
function sendSetupPayload(modelName) {
  if (!webSocket || webSocket.readyState !== WebSocket.OPEN) return;

  const strictArabicInstruction = `
CRITICAL DIRECTIVE FOR UNIVERSAL MULTILINGUAL SPEECH DUBBING:
YOUR MANDATORY TARGET OUTPUT LANGUAGE IS STRICTLY ARABIC (اللغة العربية الفصيحة).

You are an expert real-time simultaneous audio interpreter and speech-to-speech dubber.
Your ONLY objective is to continuously listen to the incoming tab audio stream—regadless of whether the original language is French (Français), English, Spanish, German, Italian, Russian, Turkish, Japanese, or any other language—and INSTANTLY TRANSLATE AND DUB IT INTO ARABIC (اللغة العربية الفصيحة) in real-time.

STRICT OPERATIONAL RULES:
1. ALWAYS SPEAK ONLY IN ARABIC (اللغة العربية الفصيحة). Never output French, English, or any original non-Arabic speech.
2. If the audio is in French, immediately translate French speech into fluent spoken Arabic.
3. Automatically match the emotional tone, pitch dynamics, and natural voice style of the original speaker, but speak strictly in Arabic.
4. Do not converse, do not answer questions, and do not repeat foreign words. Output ONLY the real-time dubbed Arabic voice stream.
`;

  const setupMessage = {
    setup: {
      model: modelName,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Puck"
            }
          }
        }
      },
      systemInstruction: {
        parts: [
          {
            text: strictArabicInstruction
          }
        ]
      }
    }
  };
  webSocket.send(JSON.stringify(setupMessage));
}

/**
 * Update Dubbed Master Volume Dynamically
 */
function updateDubbedVolume(vol) {
  currentDubbedVolume = vol;
  if (dubbedGainNode && audioContext) {
    dubbedGainNode.gain.setValueAtTime(vol, audioContext.currentTime);
  }
}

/**
 * Handle server messages from Gemini Live API
 */
function handleServerMessage(data) {
  if (!data.serverContent) return;

  const { modelTurn, turnComplete, interrupted } = data.serverContent;

  if (interrupted) {
    // Reset output audio play queue if interrupted
    nextAudioStartTime = audioContext ? audioContext.currentTime : 0;
  }

  if (modelTurn && modelTurn.parts) {
    for (const part of modelTurn.parts) {
      // Playback incoming audio chunk
      const audioData = (part.inlineData && part.inlineData.data) || part.data;
      if (audioData) {
        const mimeType = (part.inlineData && part.inlineData.mimeType) || "audio/pcm;rate=24000";
        const sampleRate = extractSampleRate(mimeType) || 24000;
        
        playPcmAudioChunk(audioData, sampleRate);
      }
    }
  }
}

/**
 * Playback PCM Audio Chunk received from Gemini Live API
 */
async function playPcmAudioChunk(base64Data, sampleRate = 24000) {
  if (!audioContext) return;

  // Ensure AudioContext is active (resumed)
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Convert 16-bit PCM (Little Endian) to Float32 [-1.0, 1.0]
  const int16Array = new Int16Array(bytes.buffer);
  if (int16Array.length === 0) return;

  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768.0;
  }

  // Create AudioBuffer
  const audioBuffer = audioContext.createBuffer(1, float32Array.length, sampleRate);
  audioBuffer.getChannelData(0).set(float32Array);

  // Play using AudioBufferSourceNode connected to dubbedGainNode
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  const destinationNode = dubbedGainNode || audioContext.destination;
  source.connect(destinationNode);

  const currentTime = audioContext.currentTime;
  if (nextAudioStartTime < currentTime) {
    nextAudioStartTime = currentTime;
  }

  source.start(nextAudioStartTime);
  nextAudioStartTime += audioBuffer.duration;
}

/**
 * Update GainNode according to selected ducking mode
 */
function setGainMode(gainNode, mode) {
  if (!gainNode) return;
  const now = audioContext ? audioContext.currentTime : 0;
  
  if (mode === 'mute') {
    gainNode.gain.setValueAtTime(0.0, now);
  } else if (mode === 'duck') {
    gainNode.gain.setValueAtTime(0.15, now); // Lower to 15%
  } else {
    gainNode.gain.setValueAtTime(1.0, now);  // 100% full volume
  }
}

function updateDuckingMode(mode) {
  if (tabGainNode) {
    setGainMode(tabGainNode, mode);
  }
}

/**
 * Stop Dubbing & cleanup streams
 */
async function stopDubbing() {
  isDubbingActive = false;

  if (webSocket) {
    try {
      webSocket.onclose = null;
      webSocket.onerror = null;
      webSocket.close();
    } catch (e) {}
    webSocket = null;
  }

  if (workletNode) {
    try {
      workletNode.disconnect();
    } catch (e) {}
    workletNode = null;
  }

  if (tabGainNode) {
    try {
      tabGainNode.disconnect();
    } catch (e) {}
    tabGainNode = null;
  }

  if (dubbedGainNode) {
    try {
      dubbedGainNode.disconnect();
    } catch (e) {}
    dubbedGainNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    try {
      await audioContext.close();
    } catch (e) {}
    audioContext = null;
  }

  nextAudioStartTime = 0;
  broadcastStatus('disconnected', 'متوقف');
}

/**
 * Helpers
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function extractSampleRate(mimeType) {
  const match = mimeType.match(/rate=(\d+)/);
  return match ? parseInt(match[1], 10) : 24000;
}

function broadcastStatus(state, details) {
  chrome.runtime.sendMessage({
    action: 'DUBLING_STATUS_CHANGED',
    state: state,
    details: details
  }).catch(() => {});
}
