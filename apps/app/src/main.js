// BumpSnap - Pregnancy Photo Tracker for R1 Device

// ============================================
// State Management
// ============================================
const STATE_KEY = 'bumpsnap_state';

const defaultState = {
  dueDate: null,
  currentWeek: 1,
  photos: [],       // { week, date, label, imageData }
  babyBorn: false,
  bornDate: null,
  reminderDismissed: {},
  setupComplete: false
};

let state = { ...defaultState };
let currentScreen = 'setup';
let slideshowTimer = null;
let slideshowIndex = 0;
let slideshowPlaying = false;
let reminderInterval = null;
let setupActionLocked = false;
let lastHomeSideClickAt = 0;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MIN_PREGNANCY_WEEK = 1;
const MAX_PREGNANCY_WEEK = 42;
const setupFlow = {
  step: 'date', // "date" -> "week"
  part: 0, // 0=day, 1=month, 2=year
  draftDate: null,
  draftWeek: MIN_PREGNANCY_WEEK
};

// ============================================
// Storage Helpers
// ============================================
function getCreationPlainStorage() {
  if (!window.creationStorage || !window.creationStorage.plain) return null;
  const plain = window.creationStorage.plain;
  if (typeof plain.getItem !== 'function' || typeof plain.setItem !== 'function') return null;
  return plain;
}

function parseStoredState(rawValue) {
  if (!rawValue || typeof rawValue !== 'string') return null;

  // New format: plain JSON string.
  try {
    return JSON.parse(rawValue);
  } catch (_e) {}

  // Legacy format: base64-encoded JSON.
  try {
    return JSON.parse(atob(rawValue));
  } catch (_e) {}

  // Legacy unicode-safe encoding that used escape/unescape.
  try {
    return JSON.parse(decodeURIComponent(escape(atob(rawValue))));
  } catch (_e) {}

  return null;
}

async function saveState() {
  const json = JSON.stringify(state);
  const plain = getCreationPlainStorage();

  try {
    if (plain) {
      await plain.setItem(STATE_KEY, json);
    }
  } catch (e) {
    console.error('Error saving state to creationStorage:', e);
  }

  try {
    localStorage.setItem(STATE_KEY, json);
  } catch (e) {
    console.error('Error saving state to localStorage:', e);
  }
}

async function loadState() {
  const candidates = [];
  const plain = getCreationPlainStorage();

  try {
    if (plain) {
      const creationStored = await plain.getItem(STATE_KEY);
      if (creationStored) candidates.push(creationStored);
    }
  } catch (e) {
    console.error('Error loading state from creationStorage:', e);
  }

  try {
    const localStored = localStorage.getItem(STATE_KEY);
    if (localStored) candidates.push(localStored);
  } catch (e) {
    console.error('Error loading state from localStorage:', e);
  }

  for (const candidate of candidates) {
    const parsed = parseStoredState(candidate);
    if (!parsed || typeof parsed !== 'object') continue;

    state = { ...defaultState, ...parsed };

    // Keep both stores in sync using the normalized JSON format.
    saveState();
    return true;
  }

  return false;
}

// ============================================
// Pregnancy Calculations
// ============================================
function getPregnancyWeek() {
  return clampWeek(state.currentWeek || MIN_PREGNANCY_WEEK);
}

function getTrimester(week) {
  if (week <= 13) return '1st Trimester';
  if (week <= 26) return '2nd Trimester';
  return '3rd Trimester';
}

function hasPhotoForWeek(week) {
  return state.photos.some(p => p.week === week);
}

function getPhotoForWeek(week) {
  return state.photos.find(p => p.week === week);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function clampWeek(week) {
  return Math.min(MAX_PREGNANCY_WEEK, Math.max(MIN_PREGNANCY_WEEK, Number(week) || MIN_PREGNANCY_WEEK));
}

function startOfDay(dateLike) {
  const d = new Date(dateLike);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getDaysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function parseISODate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;

  const candidate = startOfDay(new Date(year, month - 1, day));
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return candidate;
}

function toISODateString(dateObj) {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildSafeDate(year, monthIndex, day) {
  const safeDay = Math.min(day, getDaysInMonth(year, monthIndex));
  return startOfDay(new Date(year, monthIndex, safeDay));
}

function getDefaultDueDateDraft() {
  const saved = parseISODate(state.dueDate);
  if (saved) return saved;
  const fallback = startOfDay(new Date());
  fallback.setDate(fallback.getDate() + 1);
  return fallback;
}

function renderSetupFlow() {
  const dateStep = document.getElementById('setup-step-date');
  const weekStep = document.getElementById('setup-step-week');
  const isDateStep = setupFlow.step === 'date';

  dateStep.classList.toggle('hidden', !isDateStep);
  weekStep.classList.toggle('hidden', isDateStep);

  if (setupFlow.draftDate) {
    document.getElementById('setup-date-day').textContent = String(setupFlow.draftDate.getDate()).padStart(2, '0');
    document.getElementById('setup-date-month').textContent = MONTH_NAMES[setupFlow.draftDate.getMonth()];
    document.getElementById('setup-date-year').textContent = String(setupFlow.draftDate.getFullYear());
  }

  document.querySelectorAll('.date-slot[data-picker="setup"]').forEach((slot) => {
    const active = isDateStep && Number(slot.dataset.part) === setupFlow.part;
    slot.classList.toggle('active', active);
  });

  document.getElementById('setup-week-value').textContent = String(setupFlow.draftWeek);
}

function syncSetupFlowFromState() {
  setupActionLocked = false;
  setupFlow.step = 'date';
  setupFlow.part = 0;
  setupFlow.draftDate = getDefaultDueDateDraft();
  setupFlow.draftWeek = clampWeek(state.currentWeek || MIN_PREGNANCY_WEEK);
  renderSetupFlow();
}

function changeSetupDatePartValue(delta) {
  if (currentScreen !== 'setup' || setupFlow.step !== 'date' || !setupFlow.draftDate) return false;

  const current = setupFlow.draftDate;
  let next = startOfDay(current);

  if (setupFlow.part === 0) {
    next.setDate(next.getDate() + delta);
  } else if (setupFlow.part === 1) {
    next = buildSafeDate(current.getFullYear(), current.getMonth() + delta, current.getDate());
  } else {
    next = buildSafeDate(current.getFullYear() + delta, current.getMonth(), current.getDate());
  }

  setupFlow.draftDate = startOfDay(next);
  renderSetupFlow();
  return true;
}

function changeSetupWeekValue(delta) {
  if (currentScreen !== 'setup' || setupFlow.step !== 'week') return false;
  setupFlow.draftWeek = clampWeek(setupFlow.draftWeek + delta);
  renderSetupFlow();
  return true;
}

async function confirmSetupFlowStep() {
  if (currentScreen !== 'setup' || setupActionLocked) return false;

  if (setupFlow.step === 'date') {
    if (setupFlow.part < 2) {
      setupFlow.part += 1;
      renderSetupFlow();
      return true;
    }

    setupActionLocked = true;
    try {
      state.dueDate = toISODateString(setupFlow.draftDate);
      await saveState();
      setupFlow.step = 'week';
      renderSetupFlow();
    } finally {
      setupActionLocked = false;
    }
    return true;
  }

  if (setupFlow.step === 'week') {
    setupActionLocked = true;
    try {
      state.currentWeek = clampWeek(setupFlow.draftWeek);
      state.setupComplete = true;
      await saveState();
      showScreen('home');
      updateHome();
      startReminderCheck();
    } finally {
      setupActionLocked = false;
    }
    return true;
  }

  return false;
}

function bindDatePickerClicks() {
  document.querySelectorAll('.date-slot[data-picker="setup"]').forEach((slot) => {
    slot.addEventListener('click', () => {
      if (setupFlow.step !== 'date') return;
      const part = Number(slot.dataset.part);
      if (Number.isNaN(part)) return;
      setupFlow.part = Math.max(0, Math.min(2, part));
      renderSetupFlow();
    });
  });
}

function changeHomeWeek(delta) {
  if (currentScreen !== 'home') return false;
  const nextWeek = clampWeek((state.currentWeek || MIN_PREGNANCY_WEEK) + delta);
  if (nextWeek !== state.currentWeek) {
    state.currentWeek = nextWeek;
    updateHome();
    saveState();
  }
  return true;
}

// ============================================
// Screen Navigation
// ============================================
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(`screen-${screenId}`);
  if (target) {
    target.classList.add('active');
    currentScreen = screenId;
  }
}

// ============================================
// Setup Screen
// ============================================
function initSetup() {
  bindDatePickerClicks();
  syncSetupFlowFromState();
}

// ============================================
// Home Screen
// ============================================
function updateHome() {
  const week = getPregnancyWeek();
  const dueText = state.dueDate ? formatDate(state.dueDate) : '--';
  const bornText = state.bornDate ? formatDate(state.bornDate) : '--';

  document.getElementById('home-week-num').textContent = state.babyBorn ? '🎉' : week;
  document.getElementById('home-trimester').textContent = state.babyBorn ? 'Baby is here!' : `Week ${week}`;
  document.getElementById('home-days-left').textContent = state.babyBorn
    ? `Born ${bornText}`
    : `Due: ${dueText}`;

  updateReminderBanner();
}

function updateReminderBanner() {
  const banner = document.getElementById('reminder-banner');
  const week = getPregnancyWeek();

  if (!state.babyBorn && !hasPhotoForWeek(week) && state.setupComplete) {
    banner.classList.remove('hidden');
    document.getElementById('reminder-week').textContent = week;
  } else {
    banner.classList.add('hidden');
  }
}

// ============================================
// Camera / Capture
// ============================================
let pendingImageData = null;
let cameraStream = null;

function setCaptureError(message) {
  const captureError = document.getElementById('capture-error');
  if (!captureError) return;

  if (message) {
    captureError.textContent = message;
    captureError.classList.remove('hidden');
  } else {
    captureError.textContent = '';
    captureError.classList.add('hidden');
  }
}

function showCapturedImage(imageData) {
  const captureImg = document.getElementById('capture-img');
  const captureVideo = document.getElementById('capture-video');
  const captureControls = document.getElementById('capture-controls');
  const captureHint = document.querySelector('.capture-hint');

  pendingImageData = imageData;
  captureImg.src = pendingImageData;
  captureImg.classList.remove('hidden');
  captureVideo.classList.add('hidden');
  captureControls.classList.remove('hidden');
  if (captureHint) captureHint.classList.add('hidden');
}

function stopCameraStream() {
  const captureVideo = document.getElementById('capture-video');
  const btnTakePhoto = document.getElementById('btn-take-photo');

  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }

  if (captureVideo && captureVideo.srcObject) {
    captureVideo.srcObject = null;
  }

  if (captureVideo) {
    captureVideo.classList.add('hidden');
  }

  if (btnTakePhoto) {
    btnTakePhoto.classList.add('hidden');
  }
}

async function startLiveCamera() {
  const captureImg = document.getElementById('capture-img');
  const captureVideo = document.getElementById('capture-video');
  const captureControls = document.getElementById('capture-controls');
  const cameraInput = document.getElementById('camera-input');
  const captureHint = document.querySelector('.capture-hint');
  const btnTakePhoto = document.getElementById('btn-take-photo');

  stopCameraStream();
  pendingImageData = null;
  setCaptureError('');
  captureImg.classList.add('hidden');
  captureImg.src = '';
  captureControls.classList.add('hidden');
  if (captureHint) captureHint.classList.add('hidden');

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setCaptureError('Live camera unavailable. Falling back to image picker.');
    cameraInput.click();
    return;
  }

  const constraintsToTry = [
    {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    },
    {
      video: true,
      audio: false
    }
  ];

  let stream = null;
  let lastError = null;

  for (const constraints of constraintsToTry) {
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!stream) {
    console.error('Failed to start live camera:', lastError);
    setCaptureError('Could not open camera. Check camera permissions.');
    cameraInput.click();
    return;
  }

  cameraStream = stream;
  captureVideo.srcObject = stream;
  captureVideo.classList.remove('hidden');
  btnTakePhoto.classList.remove('hidden');

  try {
    await captureVideo.play();
  } catch (error) {
    console.warn('Video play() failed:', error);
  }
}

function captureFrameFromVideo() {
  const captureVideo = document.getElementById('capture-video');

  if (!cameraStream || captureVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    setCaptureError('Camera is still loading. Try again.');
    return;
  }

  const width = captureVideo.videoWidth || 960;
  const height = captureVideo.videoHeight || 720;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    setCaptureError('Capture failed. Please try again.');
    return;
  }

  context.drawImage(captureVideo, 0, 0, width, height);
  const capturedDataUrl = canvas.toDataURL('image/jpeg', 0.92);

  stopCameraStream();
  showCapturedImage(capturedDataUrl);
}

async function savePendingPhoto() {
  if (!pendingImageData) return false;

  const week = getPregnancyWeek();
  const label = document.getElementById('photo-label').value.trim();
  const existing = state.photos.findIndex(p => p.week === week);

  const photoEntry = {
    week,
    date: new Date().toISOString(),
    label: label || `Week ${week}`,
    imageData: pendingImageData
  };

  if (existing >= 0) {
    state.photos[existing] = photoEntry;
  } else {
    state.photos.push(photoEntry);
    state.photos.sort((a, b) => a.week - b.week);
  }

  await saveState();
  resetCapture();
  showScreen('home');
  updateHome();
  return true;
}

function initCapture() {
  const cameraInput = document.getElementById('camera-input');
  const btnOpenCamera = document.getElementById('btn-open-camera');
  const btnTakePhoto = document.getElementById('btn-take-photo');

  btnOpenCamera.addEventListener('click', () => {
    startLiveCamera();
  });

  btnTakePhoto.addEventListener('click', () => {
    captureFrameFromVideo();
  });

  cameraInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setCaptureError('');
      stopCameraStream();
      showCapturedImage(ev.target.result);
    };
    reader.onerror = () => {
      setCaptureError('Could not read selected image.');
    };
    reader.readAsDataURL(file);
  });

  document.getElementById('btn-save-photo').addEventListener('click', async () => {
    await savePendingPhoto();
  });

  document.getElementById('btn-capture-back').addEventListener('click', () => {
    resetCapture();
    showScreen('home');
  });
}

function resetCapture() {
  stopCameraStream();
  pendingImageData = null;
  setCaptureError('');
  document.getElementById('capture-video').classList.add('hidden');
  document.getElementById('capture-img').classList.add('hidden');
  document.getElementById('capture-img').src = '';
  document.getElementById('capture-controls').classList.add('hidden');
  document.getElementById('photo-label').value = '';
  document.getElementById('camera-input').value = '';
  const hint = document.querySelector('.capture-hint');
  if (hint) hint.classList.remove('hidden');
}

function openCapture() {
  const week = getPregnancyWeek();
  document.getElementById('capture-week').textContent = state.babyBorn ? 'Born!' : week;
  resetCapture();
  showScreen('capture');
  startLiveCamera();
}

// ============================================
// Gallery
// ============================================
function openGallery() {
  updateGallery();
  showScreen('gallery');
}

function updateGallery() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('gallery-empty');
  grid.innerHTML = '';

  if (state.photos.length === 0) {
    empty.classList.remove('hidden');
    grid.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  grid.classList.remove('hidden');

  let lastMonth = '';

  state.photos.forEach((photo, index) => {
    const photoDate = new Date(photo.date);
    const monthLabel = photoDate.toLocaleString('default', { month: 'long', year: 'numeric' });

    if (monthLabel !== lastMonth) {
      const separator = document.createElement('div');
      separator.className = 'gallery-month-separator';
      separator.textContent = monthLabel;
      grid.appendChild(separator);
      lastMonth = monthLabel;
    }

    const cell = document.createElement('div');
    cell.className = 'gallery-cell';
    cell.innerHTML = `
      <img src="${photo.imageData}" class="gallery-thumb" alt="Week ${photo.week}" />
      <div class="gallery-cell-label">W${photo.week}</div>
    `;
    cell.addEventListener('click', () => openDetail(index));
    grid.appendChild(cell);
  });
}

function initGallery() {
  document.getElementById('btn-gallery-back').addEventListener('click', () => {
    showScreen('home');
  });

  document.getElementById('btn-slideshow').addEventListener('click', () => {
    if (state.photos.length > 0) {
      startSlideshow();
    }
  });
}

// ============================================
// Photo Detail
// ============================================
function openDetail(photoIndex) {
  const photo = state.photos[photoIndex];
  if (!photo) return;

  document.getElementById('detail-img').src = photo.imageData;
  document.getElementById('detail-title').textContent = `Week ${photo.week}`;
  document.getElementById('detail-label').textContent = photo.label || '';
  document.getElementById('detail-date').textContent = formatDate(photo.date);
  document.getElementById('detail-week-info').textContent = `${getTrimester(photo.week)} · Week ${photo.week} of 40`;

  document.getElementById('btn-delete-photo').onclick = () => {
    if (confirm('Delete this photo?')) {
      state.photos.splice(photoIndex, 1);
      saveState();
      showScreen('gallery');
      updateGallery();
    }
  };

  showScreen('detail');
}

function initDetail() {
  document.getElementById('btn-detail-back').addEventListener('click', () => {
    showScreen('gallery');
  });
}

// ============================================
// Slideshow
// ============================================
function startSlideshow() {
  if (state.photos.length === 0) return;
  slideshowIndex = 0;
  slideshowPlaying = true;
  showScreen('slideshow');
  updateSlideshowFrame();
  scheduleSlideshowNext();
}

function updateSlideshowFrame() {
  const photo = state.photos[slideshowIndex];
  if (!photo) return;

  const img = document.getElementById('slideshow-img');
  img.style.opacity = '0';

  setTimeout(() => {
    img.src = photo.imageData;
    document.getElementById('slideshow-week').textContent = `Week ${photo.week}`;
    document.getElementById('slideshow-label').textContent = photo.label || '';
    document.getElementById('slideshow-counter').textContent = `${slideshowIndex + 1}/${state.photos.length}`;

    const progress = ((slideshowIndex + 1) / state.photos.length) * 100;
    document.getElementById('slideshow-progress-bar').style.width = `${progress}%`;

    img.style.opacity = '1';
  }, 300);
}

function scheduleSlideshowNext() {
  clearTimeout(slideshowTimer);
  if (!slideshowPlaying) return;

  slideshowTimer = setTimeout(() => {
    if (slideshowIndex < state.photos.length - 1) {
      slideshowIndex++;
      updateSlideshowFrame();
      scheduleSlideshowNext();
    } else {
      slideshowPlaying = false;
      document.getElementById('btn-ss-play').textContent = '▶';
    }
  }, 3000);
}

function initSlideshow() {
  document.getElementById('btn-slideshow-back').addEventListener('click', () => {
    stopSlideshow();
    showScreen('gallery');
  });

  document.getElementById('btn-ss-play').addEventListener('click', () => {
    if (slideshowPlaying) {
      slideshowPlaying = false;
      clearTimeout(slideshowTimer);
      document.getElementById('btn-ss-play').textContent = '▶';
    } else {
      slideshowPlaying = true;
      document.getElementById('btn-ss-play').textContent = '⏸';
      if (slideshowIndex >= state.photos.length - 1) {
        slideshowIndex = 0;
        updateSlideshowFrame();
      }
      scheduleSlideshowNext();
    }
  });

  document.getElementById('btn-ss-prev').addEventListener('click', () => {
    if (slideshowIndex > 0) {
      slideshowIndex--;
      updateSlideshowFrame();
      if (slideshowPlaying) scheduleSlideshowNext();
    }
  });

  document.getElementById('btn-ss-next').addEventListener('click', () => {
    if (slideshowIndex < state.photos.length - 1) {
      slideshowIndex++;
      updateSlideshowFrame();
      if (slideshowPlaying) scheduleSlideshowNext();
    }
  });
}

function stopSlideshow() {
  slideshowPlaying = false;
  clearTimeout(slideshowTimer);
}

// ============================================
// Settings
// ============================================
function updateSettingsSummary() {
  document.getElementById('settings-week-value').textContent = `Week ${getPregnancyWeek()}`;
  document.getElementById('settings-due-date-text').textContent = state.dueDate
    ? formatDate(state.dueDate)
    : '--';
}

function initSettings() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    updateSettingsSummary();
    showScreen('settings');
  });

  document.getElementById('btn-settings-back').addEventListener('click', () => {
    showScreen('home');
    updateHome();
  });

  document.getElementById('btn-baby-born').addEventListener('click', async () => {
    if (confirm('Mark baby as born? This will enable the final photo.')) {
      state.babyBorn = true;
      state.bornDate = new Date().toISOString();
      await saveState();
      showScreen('home');
      updateHome();
    }
  });

  document.getElementById('btn-reset').addEventListener('click', async () => {
    if (confirm('Delete ALL data and photos? This cannot be undone.')) {
      state = { ...defaultState };
      await saveState();
      syncSetupFlowFromState();
      showScreen('setup');
    }
  });
}

// ============================================
// Reminders (Visual + Sound + Vibration)
// ============================================
let reminderFired = false;

function startReminderCheck() {
  if (reminderInterval) clearInterval(reminderInterval);

  reminderInterval = setInterval(() => {
    checkReminder();
  }, 60000); // Check every minute

  checkReminder();
}

function checkReminder() {
  if (!state.setupComplete || state.babyBorn) return;

  const week = getPregnancyWeek();
  if (!hasPhotoForWeek(week) && !reminderFired) {
    fireReminder(week);
    reminderFired = true;
  }

  if (hasPhotoForWeek(week)) {
    reminderFired = false;
  }

  updateReminderBanner();
}

function fireReminder(week) {
  playReminderSound();
  triggerVibration();
  // Keep reminder non-blocking for hardware-only navigation on r1.
  updateReminderBanner();
}

function playReminderSound() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.5);

    setTimeout(() => {
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.frequency.value = 1100;
      osc2.type = 'sine';
      gain2.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain2.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
      osc2.start(audioCtx.currentTime);
      osc2.stop(audioCtx.currentTime + 0.5);
    }, 300);
  } catch (e) {
    console.warn('Audio not supported:', e);
  }
}

function triggerVibration() {
  try {
    if (navigator.vibrate) {
      navigator.vibrate([200, 100, 200]);
    }
  } catch (e) {
    console.warn('Vibration not supported:', e);
  }
}

function showReminderOverlay(week) {
  let overlay = document.getElementById('reminder-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'reminder-overlay';
    overlay.className = 'reminder-overlay';
    overlay.innerHTML = `
      <div class="reminder-content">
        <div class="reminder-icon">📸</div>
        <p class="reminder-title">Photo Time!</p>
        <p class="reminder-text">Week <span id="overlay-week"></span> bump photo</p>
        <button id="btn-overlay-capture" class="btn-primary">Take Photo</button>
        <button id="btn-overlay-dismiss" class="btn-dismiss">Later</button>
      </div>
    `;
    document.getElementById('app').appendChild(overlay);

    document.getElementById('btn-overlay-capture').addEventListener('click', () => {
      overlay.classList.add('hidden');
      openCapture();
    });

    document.getElementById('btn-overlay-dismiss').addEventListener('click', () => {
      overlay.classList.add('hidden');
    });
  }

  document.getElementById('overlay-week').textContent = week;
  overlay.classList.remove('hidden');
}

// ============================================
// R1 Hardware Events
// ============================================
window.addEventListener('scrollUp', () => {
  if (changeSetupDatePartValue(-1)) return;
  if (changeSetupWeekValue(-1)) return;
  if (changeHomeWeek(-1)) return;

  const scrollable = getActiveScrollable();
  if (scrollable) {
    scrollable.scrollBy({ top: -80, behavior: 'smooth' });
  }
});

window.addEventListener('scrollDown', () => {
  if (changeSetupDatePartValue(1)) return;
  if (changeSetupWeekValue(1)) return;
  if (changeHomeWeek(1)) return;

  const scrollable = getActiveScrollable();
  if (scrollable) {
    scrollable.scrollBy({ top: 80, behavior: 'smooth' });
  }
});

function getActiveScrollable() {
  if (currentScreen === 'gallery') return document.getElementById('gallery-grid');
  if (currentScreen === 'settings') return document.querySelector('.settings-body');
  if (currentScreen === 'capture') return document.querySelector('.capture-body');
  return null;
}

window.addEventListener('sideClick', () => {
  if (currentScreen === 'setup') {
    confirmSetupFlowStep();
    return;
  }

  switch (currentScreen) {
    case 'home':
      // Double-press side button quickly on Home to open Gallery.
      // Single press keeps quick camera access.
      if (Date.now() - lastHomeSideClickAt < 550) {
        lastHomeSideClickAt = 0;
        openGallery();
      } else {
        lastHomeSideClickAt = Date.now();
        openCapture();
      }
      break;
    case 'gallery':
      showScreen('home');
      break;
    case 'detail':
      showScreen('gallery');
      break;
    case 'capture':
      if (cameraStream) {
        captureFrameFromVideo();
        break;
      }
      if (pendingImageData) {
        savePendingPhoto();
        break;
      }
      startLiveCamera();
      break;
    case 'slideshow':
      stopSlideshow();
      showScreen('gallery');
      break;
    case 'settings':
      showScreen('home');
      updateHome();
      break;
  }
});

window.addEventListener('longPressStart', () => {
  if (currentScreen === 'home') {
    openGallery();
  }
});

// ============================================
// Plugin Message Handling
// ============================================
window.onPluginMessage = function(data) {
  console.log('Plugin message received:', data);
};

// ============================================
// Initialization
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  initSetup();
  initCapture();
  initGallery();
  initDetail();
  initSlideshow();
  initSettings();

  // Navigation buttons
  document.getElementById('btn-capture').addEventListener('click', openCapture);
  document.getElementById('btn-reminder-capture').addEventListener('click', openCapture);
  document.getElementById('btn-gallery').addEventListener('click', openGallery);

  // Load saved state
  const hasState = await loadState();
  state.currentWeek = clampWeek(state.currentWeek || MIN_PREGNANCY_WEEK);
  if (hasState && state.setupComplete) {
    showScreen('home');
    updateHome();
    startReminderCheck();
  } else {
    syncSetupFlowFromState();
    showScreen('setup');
  }

  // Keyboard fallback for dev
  if (typeof PluginMessageHandler === 'undefined') {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('sideClick'));
      }
    });
  }

  console.log('BumpSnap initialized');
});
