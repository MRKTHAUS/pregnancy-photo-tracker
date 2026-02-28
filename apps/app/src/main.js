// BumpSnap - Pregnancy Photo Tracker for R1 Device

// ============================================
// State Management
// ============================================
const STATE_KEY = 'bumpsnap_state';

const defaultState = {
  dueDate: null,
  startDate: null,
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

// ============================================
// Storage Helpers
// ============================================
async function saveState() {
  try {
    if (window.creationStorage) {
      const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
      await window.creationStorage.plain.setItem(STATE_KEY, encoded);
    } else {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
    }
  } catch (e) {
    console.error('Error saving state:', e);
  }
}

async function loadState() {
  try {
    if (window.creationStorage) {
      const stored = await window.creationStorage.plain.getItem(STATE_KEY);
      if (stored) {
        state = JSON.parse(decodeURIComponent(escape(atob(stored))));
        return true;
      }
    } else {
      const stored = localStorage.getItem(STATE_KEY);
      if (stored) {
        state = JSON.parse(stored);
        return true;
      }
    }
  } catch (e) {
    console.error('Error loading state:', e);
  }
  return false;
}

// ============================================
// Pregnancy Calculations
// ============================================
function getPregnancyWeek() {
  if (!state.startDate) return 0;
  const start = new Date(state.startDate);
  const now = new Date();
  const diffMs = now - start;
  const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(diffWeeks, 1), 42);
}

function getTrimester(week) {
  if (week <= 13) return '1st Trimester';
  if (week <= 26) return '2nd Trimester';
  return '3rd Trimester';
}

function getDaysLeft() {
  if (!state.dueDate) return 0;
  const due = new Date(state.dueDate);
  const now = new Date();
  const diff = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
  return Math.max(diff, 0);
}

function getStartDateFromDue(dueDateStr) {
  const due = new Date(dueDateStr);
  const start = new Date(due);
  start.setDate(start.getDate() - 280);
  return start.toISOString().split('T')[0];
}

function hasPhotoForWeek(week) {
  return state.photos.some(p => p.week === week);
}

function getPhotoForWeek(week) {
  return state.photos.find(p => p.week === week);
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
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
  const dueDateInput = document.getElementById('due-date');
  const btnStart = document.getElementById('btn-start');

  const today = new Date();
  const minDate = new Date(today);
  minDate.setDate(minDate.getDate() + 1);
  const maxDate = new Date(today);
  maxDate.setMonth(maxDate.getMonth() + 10);

  dueDateInput.min = minDate.toISOString().split('T')[0];
  dueDateInput.max = maxDate.toISOString().split('T')[0];

  dueDateInput.addEventListener('change', () => {
    btnStart.disabled = !dueDateInput.value;
  });

  btnStart.addEventListener('click', () => {
    if (!dueDateInput.value) return;
    state.dueDate = dueDateInput.value;
    state.startDate = getStartDateFromDue(dueDateInput.value);
    state.setupComplete = true;
    saveState();
    showScreen('home');
    updateHome();
    startReminderCheck();
  });
}

// ============================================
// Home Screen
// ============================================
function updateHome() {
  const week = getPregnancyWeek();
  const trimester = getTrimester(week);
  const daysLeft = getDaysLeft();

  document.getElementById('home-week-num').textContent = state.babyBorn ? '🎉' : week;
  document.getElementById('home-trimester').textContent = state.babyBorn ? 'Baby is here!' : trimester;
  document.getElementById('home-days-left').textContent = state.babyBorn
    ? `Born ${formatDate(state.bornDate)}`
    : `${daysLeft} days to go`;

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

  document.getElementById('btn-save-photo').addEventListener('click', () => {
    if (!pendingImageData) return;

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

    saveState();
    resetCapture();
    showScreen('home');
    updateHome();
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

  const currentWeek = getPregnancyWeek();
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
function initSettings() {
  document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-due-date').value = state.dueDate || '';
    showScreen('settings');
  });

  document.getElementById('btn-settings-back').addEventListener('click', () => {
    showScreen('home');
    updateHome();
  });

  document.getElementById('btn-save-settings').addEventListener('click', () => {
    const newDue = document.getElementById('settings-due-date').value;
    if (newDue) {
      state.dueDate = newDue;
      state.startDate = getStartDateFromDue(newDue);
      saveState();
    }
    showScreen('home');
    updateHome();
  });

  document.getElementById('btn-baby-born').addEventListener('click', () => {
    if (confirm('Mark baby as born? This will enable the final photo.')) {
      state.babyBorn = true;
      state.bornDate = new Date().toISOString();
      saveState();
      showScreen('home');
      updateHome();
    }
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (confirm('Delete ALL data and photos? This cannot be undone.')) {
      state = { ...defaultState };
      saveState();
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
  showReminderOverlay(week);
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
  const scrollable = getActiveScrollable();
  if (scrollable) {
    scrollable.scrollBy({ top: -80, behavior: 'smooth' });
  }
});

window.addEventListener('scrollDown', () => {
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
  switch (currentScreen) {
    case 'home':
      openCapture();
      break;
    case 'gallery':
      showScreen('home');
      break;
    case 'detail':
      showScreen('gallery');
      break;
    case 'capture':
      resetCapture();
      showScreen('home');
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
  document.getElementById('btn-gallery').addEventListener('click', () => {
    updateGallery();
    showScreen('gallery');
  });

  // Load saved state
  const hasState = await loadState();
  if (hasState && state.setupComplete) {
    showScreen('home');
    updateHome();
    startReminderCheck();
  } else {
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
