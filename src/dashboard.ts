// Dashboard HTML template — served at /dashboard
// Tailwind CSS via CDN, dark theme, vanilla JS

export function renderDashboard(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discord Resonance</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            discord: '#5865F2',
            'discord-dark': '#23272A',
            'discord-darker': '#1E1F22',
            'discord-card': '#2B2D31',
            'discord-input': '#1E1F22',
            'discord-hover': '#36393F',
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .trigger-badge {
      background: rgba(88, 101, 242, 0.2);
      border: 1px solid rgba(88, 101, 242, 0.4);
    }
    .avatar-preview {
      transition: transform 0.2s;
    }
    .avatar-preview:hover {
      transform: scale(1.1);
    }
    .modal-backdrop {
      backdrop-filter: blur(4px);
    }
    /* Cropper styles */
    .crop-area {
      position: relative;
      width: 280px;
      height: 280px;
      overflow: hidden;
      border-radius: 50%;
      cursor: grab;
      background: #1E1F22;
    }
    .crop-area:active { cursor: grabbing; }
    .crop-area img {
      position: absolute;
      user-select: none;
      -webkit-user-drag: none;
    }
    .crop-container {
      position: relative;
      width: 280px;
      height: 280px;
    }
    .crop-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 3px solid rgba(88, 101, 242, 0.6);
      pointer-events: none;
      z-index: 2;
    }
  </style>
</head>
<body class="bg-discord-darker text-gray-100 min-h-screen">

  <!-- Header -->
  <header class="bg-discord-dark border-b border-gray-700/50 px-6 py-4">
    <div class="max-w-6xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 bg-discord rounded-full flex items-center justify-center">
          <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
          </svg>
        </div>
        <div>
          <h1 class="text-xl font-bold">Discord Resonance</h1>
          <p class="text-sm text-gray-400">Companion Registration Portal</p>
        </div>
      </div>
      <div class="flex items-center gap-4">
        <div id="statusDot" class="flex items-center gap-2">
          <div class="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
          <span class="text-sm text-gray-400">Online</span>
        </div>
        <button onclick="openModal()" class="bg-discord hover:bg-discord/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
          + Register Companion
        </button>
      </div>
    </div>
  </header>

  <!-- Status Bar -->
  <div class="bg-discord-dark/50 border-b border-gray-700/30 px-6 py-3">
    <div class="max-w-6xl mx-auto">
      <div class="flex items-center gap-6 text-sm text-gray-400">
        <span id="companionCount">-- companions</span>
        <span id="pendingCount">-- pending</span>
      </div>
      <!-- Servers & Channels -->
      <div id="serverInfo" class="mt-2 hidden">
        <div class="flex flex-wrap gap-3" id="serverList"></div>
        <div class="flex flex-wrap gap-2 mt-2" id="channelList"></div>
      </div>
    </div>
  </div>

  <!-- Main Content -->
  <main class="max-w-6xl mx-auto px-6 py-8">
    <!-- Companion Grid -->
    <div id="companionGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <!-- Cards injected by JS -->
    </div>

    <div id="emptyState" class="hidden text-center py-16">
      <p class="text-gray-500 text-lg">No companions registered yet.</p>
      <button onclick="openModal()" class="mt-4 text-discord hover:underline">Register your first companion</button>
    </div>
  </main>

  <!-- Register / Edit Modal -->
  <div id="modal" class="fixed inset-0 bg-black/60 modal-backdrop hidden z-50 flex items-center justify-center p-4 overflow-y-auto">
    <div class="bg-discord-card rounded-xl shadow-2xl w-full max-w-lg border border-gray-700/50 my-auto max-h-[90vh] flex flex-col">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
        <h2 id="modalTitle" class="text-lg font-semibold">Register Companion</h2>
        <button onclick="closeModal()" class="text-gray-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <form id="companionForm" onsubmit="handleSubmit(event)" class="p-6 space-y-4 overflow-y-auto">
        <input type="hidden" id="editId" value="">

        <!-- Avatar Preview + Upload -->
        <div class="flex flex-col items-center gap-2">
          <div class="relative group cursor-pointer" onclick="document.getElementById('avatarFileInput').click()">
            <img id="avatarPreview" src="https://cdn.discordapp.com/embed/avatars/0.png" referrerpolicy="no-referrer" class="w-20 h-20 rounded-full object-cover border-2 border-gray-600" alt="Avatar">
            <div class="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
            </div>
            <input type="file" id="avatarFileInput" accept="image/*" class="hidden" onchange="openCropper(this)">
          </div>
          <p class="text-xs text-gray-500">Click to upload</p>
        </div>

        <!-- Name -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Companion Name *</label>
          <input type="text" id="inputName" required placeholder="e.g. Companion One"
            class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
        </div>

        <!-- Avatar URL (hidden but still used) -->
        <input type="hidden" id="inputAvatar" value="">

        <!-- Avatar URL manual fallback -->
        <div>
          <button type="button" onclick="toggleUrlInput()" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">Or paste avatar URL manually</button>
          <div id="urlInputRow" class="hidden mt-2">
            <input type="url" id="inputAvatarUrl" placeholder="https://..."
              class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord text-sm"
              oninput="document.getElementById('inputAvatar').value = this.value; previewAvatar(this.value)">
          </div>
        </div>

        <!-- Trigger Words -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Trigger Words * <span class="text-gray-500 font-normal">(comma-separated)</span></label>
          <input type="text" id="inputTriggers" required placeholder="e.g. kai, stryder"
            class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
        </div>

        <!-- Human Name -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Human's Name</label>
          <input type="text" id="inputHumanName" placeholder="e.g. Mai"
            class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
        </div>

        <!-- Human Info -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">About the Human</label>
          <textarea id="inputHumanInfo" placeholder="Brief info — what AI platform they use, relationship to companion..."
            rows="2" class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord resize-none"></textarea>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between pt-2">
          <button type="button" id="deleteBtn" onclick="handleDelete()" class="hidden text-red-400 hover:text-red-300 text-sm transition-colors">
            Delete Companion
          </button>
          <div class="flex gap-3 ml-auto">
            <button type="button" onclick="closeModal()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
            <button type="submit" class="bg-discord hover:bg-discord/80 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">
              <span id="submitText">Register</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>

  <!-- Auth Token Modal -->
  <div id="authModal" class="fixed inset-0 bg-black/60 modal-backdrop hidden z-50 flex items-center justify-center p-4">
    <div class="bg-discord-card rounded-xl shadow-2xl w-full max-w-sm border border-gray-700/50 p-6">
      <h2 class="text-lg font-semibold mb-4">Enter Dashboard Token</h2>
      <input type="password" id="authTokenInput" placeholder="Dashboard token..."
        class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord mb-4">
      <div class="flex gap-3 justify-end">
        <button onclick="document.getElementById('authModal').classList.add('hidden')" class="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        <button onclick="saveToken()" class="bg-discord hover:bg-discord/80 text-white px-4 py-2 rounded-lg text-sm font-medium">Save</button>
      </div>
    </div>
  </div>

  <!-- Crop Modal -->
  <div id="cropModal" class="fixed inset-0 bg-black/80 modal-backdrop hidden z-[60] flex items-center justify-center p-4">
    <div class="bg-discord-card rounded-xl shadow-2xl border border-gray-700/50 p-6 flex flex-col items-center gap-4">
      <h2 class="text-lg font-semibold">Position Avatar</h2>
      <p class="text-sm text-gray-400">Drag to reposition. Scroll to zoom.</p>
      <div class="crop-container">
        <div class="crop-area" id="cropArea">
          <img id="cropImage" src="" alt="Crop">
        </div>
        <div class="crop-ring"></div>
      </div>
      <!-- Zoom slider -->
      <div class="flex items-center gap-3 w-full max-w-[280px]">
        <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"/></svg>
        <input type="range" id="cropZoom" min="100" max="400" value="100" class="flex-1 accent-[#5865F2]" oninput="updateCropZoom(this.value)">
        <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
      </div>
      <div class="flex gap-3">
        <button onclick="closeCropper()" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">Cancel</button>
        <button onclick="applyCrop()" class="bg-discord hover:bg-discord/80 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors">Crop & Upload</button>
      </div>
    </div>
  </div>

  <script>
    const API = '${baseUrl}/api';
    let companions = [];
    let token = localStorage.getItem('dashboard_token') || '';

    // Fetch and render companions
    async function loadCompanions() {
      try {
        const res = await fetch(API + '/companions');
        companions = await res.json();
        renderCompanions();
        loadStatus();
      } catch (err) {
        console.error('Failed to load companions:', err);
      }
    }

    async function loadStatus() {
      try {
        const res = await fetch(API + '/status');
        const status = await res.json();
        document.getElementById('companionCount').textContent = status.companion_count + ' companions';
        document.getElementById('pendingCount').textContent = status.pending_count + ' pending';

        // Render servers
        const serverInfo = document.getElementById('serverInfo');
        const serverList = document.getElementById('serverList');
        const channelList = document.getElementById('channelList');

        if (status.servers && status.servers.length > 0) {
          serverInfo.classList.remove('hidden');
          serverList.innerHTML = status.servers.map(s => \`
            <div class="flex items-center gap-2 bg-discord-card rounded-lg px-3 py-1.5 border border-gray-700/50">
              \${s.icon ? \`<img src="\${s.icon}" class="w-5 h-5 rounded-full" referrerpolicy="no-referrer">\` : \`<div class="w-5 h-5 rounded-full bg-discord-hover flex items-center justify-center text-xs">\${s.name[0]}</div>\`}
              <span class="text-sm text-gray-300">\${s.name}</span>
            </div>
          \`).join('');
        }

        if (status.watch_channels && status.watch_channels.length > 0) {
          channelList.innerHTML = '<span class="text-xs text-gray-500 mr-1">Watching:</span>' +
            status.watch_channels.map(ch => \`
              <span class="text-xs bg-discord/10 text-discord border border-discord/20 rounded-full px-2.5 py-0.5">#\${ch.name || ch.id}</span>
            \`).join('');
        }
      } catch (err) {}
    }

    function renderCompanions() {
      const grid = document.getElementById('companionGrid');
      const empty = document.getElementById('emptyState');

      if (companions.length === 0) {
        grid.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
      }

      grid.classList.remove('hidden');
      empty.classList.add('hidden');

      grid.innerHTML = companions.map(c => \`
        <div class="bg-discord-card rounded-xl border border-gray-700/50 p-5 hover:border-discord/30 transition-colors">
          <div class="flex items-start gap-4">
            <img src="\${c.avatar_url}" alt="\${c.name}" referrerpolicy="no-referrer" crossorigin="anonymous" class="w-14 h-14 rounded-full object-cover border-2 border-gray-600 flex-shrink-0"
              onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-white truncate">\${c.name}</h3>
              <div class="flex flex-wrap gap-1.5 mt-1.5">
                \${c.triggers.map(t => \`<span class="trigger-badge text-xs text-discord px-2 py-0.5 rounded-full">\${t}</span>\`).join('')}
              </div>
              \${c.human_name ? \`
                <div class="mt-3 pt-3 border-t border-gray-700/50">
                  <p class="text-sm text-gray-400">
                    <span class="text-gray-300 font-medium">\${c.human_name}</span>
                    \${c.human_info ? \`<span class="text-gray-500"> &mdash; \${c.human_info}</span>\` : ''}
                  </p>
                </div>
              \` : ''}
            </div>
          </div>
          <div class="flex justify-end mt-3 gap-2">
            <button onclick="openEdit('\${c.id}')" class="text-xs text-gray-500 hover:text-gray-300 transition-colors">Edit</button>
          </div>
        </div>
      \`).join('');
    }

    // Modal management
    function openModal() {
      document.getElementById('editId').value = '';
      document.getElementById('companionForm').reset();
      document.getElementById('inputAvatar').value = '';
      document.getElementById('inputAvatarUrl').value = '';
      document.getElementById('avatarPreview').src = 'https://cdn.discordapp.com/embed/avatars/0.png';
      document.getElementById('urlInputRow').classList.add('hidden');
      document.getElementById('modalTitle').textContent = 'Register Companion';
      document.getElementById('submitText').textContent = 'Register';
      document.getElementById('deleteBtn').classList.add('hidden');
      document.getElementById('modal').classList.remove('hidden');
    }

    function openEdit(id) {
      const c = companions.find(x => x.id === id);
      if (!c) return;

      document.getElementById('editId').value = c.id;
      document.getElementById('inputName').value = c.name;
      document.getElementById('inputAvatar').value = c.avatar_url;
      document.getElementById('inputAvatarUrl').value = c.avatar_url;
      document.getElementById('inputTriggers').value = c.triggers.join(', ');
      document.getElementById('inputHumanName').value = c.human_name || '';
      document.getElementById('inputHumanInfo').value = c.human_info || '';
      document.getElementById('avatarPreview').src = c.avatar_url;
      document.getElementById('modalTitle').textContent = 'Edit Companion';
      document.getElementById('submitText').textContent = 'Save Changes';
      document.getElementById('deleteBtn').classList.remove('hidden');
      document.getElementById('modal').classList.remove('hidden');
    }

    function closeModal() {
      document.getElementById('modal').classList.add('hidden');
    }

    // ===== Cropper State =====
    let cropState = { x: 0, y: 0, zoom: 100, dragging: false, startX: 0, startY: 0, imgW: 0, imgH: 0 };

    function openCropper(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('cropImage');
        img.onload = () => {
          // Fit image to cover the 280px circle
          const areaSize = 280;
          const scale = Math.max(areaSize / img.naturalWidth, areaSize / img.naturalHeight);
          cropState.imgW = img.naturalWidth * scale;
          cropState.imgH = img.naturalHeight * scale;
          cropState.zoom = 100;
          cropState.x = (areaSize - cropState.imgW) / 2;
          cropState.y = (areaSize - cropState.imgH) / 2;
          document.getElementById('cropZoom').value = 100;
          updateCropPosition();
          document.getElementById('cropModal').classList.remove('hidden');
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    }

    function updateCropPosition() {
      const img = document.getElementById('cropImage');
      const z = cropState.zoom / 100;
      img.style.width = (cropState.imgW * z) + 'px';
      img.style.height = (cropState.imgH * z) + 'px';
      img.style.left = cropState.x + 'px';
      img.style.top = cropState.y + 'px';
    }

    function updateCropZoom(val) {
      const oldZ = cropState.zoom / 100;
      const newZ = val / 100;
      // Zoom toward center
      const cx = 140, cy = 140;
      cropState.x = cx - (cx - cropState.x) * (newZ / oldZ);
      cropState.y = cy - (cy - cropState.y) * (newZ / oldZ);
      cropState.zoom = val;
      updateCropPosition();
    }

    // Drag handlers
    const cropArea = document.getElementById('cropArea');
    cropArea.addEventListener('pointerdown', (e) => {
      cropState.dragging = true;
      cropState.startX = e.clientX - cropState.x;
      cropState.startY = e.clientY - cropState.y;
      cropArea.setPointerCapture(e.pointerId);
    });
    cropArea.addEventListener('pointermove', (e) => {
      if (!cropState.dragging) return;
      cropState.x = e.clientX - cropState.startX;
      cropState.y = e.clientY - cropState.startY;
      updateCropPosition();
    });
    cropArea.addEventListener('pointerup', () => { cropState.dragging = false; });

    // Scroll to zoom
    cropArea.addEventListener('wheel', (e) => {
      e.preventDefault();
      const slider = document.getElementById('cropZoom');
      let newVal = cropState.zoom + (e.deltaY > 0 ? -10 : 10);
      newVal = Math.max(100, Math.min(400, newVal));
      slider.value = newVal;
      updateCropZoom(newVal);
    }, { passive: false });

    function closeCropper() {
      document.getElementById('cropModal').classList.add('hidden');
      document.getElementById('avatarFileInput').value = '';
    }

    async function applyCrop() {
      // Draw cropped area to canvas
      const canvas = document.createElement('canvas');
      const size = 256; // Output avatar size
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = document.getElementById('cropImage');
      const z = cropState.zoom / 100;
      const areaSize = 280;

      // Map crop area coordinates to source image coordinates
      const srcX = -cropState.x / (cropState.imgW * z) * img.naturalWidth;
      const srcY = -cropState.y / (cropState.imgH * z) * img.naturalHeight;
      const srcSize = areaSize / (cropState.imgW * z) * img.naturalWidth;

      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, size, size);

      // Convert to blob and upload
      canvas.toBlob(async (blob) => {
        if (!blob) return;

        // Show preview immediately
        const previewUrl = URL.createObjectURL(blob);
        document.getElementById('avatarPreview').src = previewUrl;
        closeCropper();

        // Upload
        try {
          const formData = new FormData();
          formData.append('file', blob, 'avatar.png');
          const res = await fetch(API.replace('/api', '') + '/upload-avatar', {
            method: 'POST',
            body: formData,
          });
          if (!res.ok) {
            const err = await res.text();
            throw new Error(err);
          }
          const data = await res.json();
          document.getElementById('inputAvatar').value = data.url;
        } catch (err) {
          alert('Upload failed: ' + err.message);
        }
      }, 'image/png');
    }

    function previewAvatar(url) {
      const img = document.getElementById('avatarPreview');
      if (url) {
        img.src = url;
        img.onerror = () => { img.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; };
      }
    }

    function toggleUrlInput() {
      const row = document.getElementById('urlInputRow');
      row.classList.toggle('hidden');
    }

    // Auth
    function getHeaders() {
      const h = { 'Content-Type': 'application/json' };
      if (token) h['Authorization'] = 'Bearer ' + token;
      return h;
    }

    function promptAuth() {
      document.getElementById('authTokenInput').value = token;
      document.getElementById('authModal').classList.remove('hidden');
    }

    function saveToken() {
      token = document.getElementById('authTokenInput').value;
      localStorage.setItem('dashboard_token', token);
      document.getElementById('authModal').classList.add('hidden');
    }

    // CRUD
    async function handleSubmit(e) {
      e.preventDefault();
      const editId = document.getElementById('editId').value;
      const avatarUrl = document.getElementById('inputAvatar').value.trim();
      if (!avatarUrl) {
        alert('Please upload an avatar image or paste a URL.');
        return;
      }
      const data = {
        name: document.getElementById('inputName').value.trim(),
        avatar_url: avatarUrl,
        triggers: document.getElementById('inputTriggers').value.split(',').map(t => t.trim()).filter(Boolean),
        human_name: document.getElementById('inputHumanName').value.trim() || undefined,
        human_info: document.getElementById('inputHumanInfo').value.trim() || undefined,
      };

      try {
        const url = editId ? API + '/companions/' + editId : API + '/companions';
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
          method,
          headers: getHeaders(),
          body: JSON.stringify(data),
        });

        if (res.status === 401) {
          promptAuth();
          return;
        }

        if (!res.ok) {
          const err = await res.json();
          alert('Error: ' + (err.error || 'Unknown error'));
          return;
        }

        closeModal();
        loadCompanions();
      } catch (err) {
        alert('Request failed: ' + err.message);
      }
    }

    async function handleDelete() {
      const editId = document.getElementById('editId').value;
      if (!editId) return;
      if (!confirm('Delete this companion? This cannot be undone.')) return;

      try {
        const res = await fetch(API + '/companions/' + editId, {
          method: 'DELETE',
          headers: getHeaders(),
        });

        if (res.status === 401) {
          promptAuth();
          return;
        }

        if (!res.ok) {
          const err = await res.json();
          alert('Error: ' + (err.error || 'Unknown error'));
          return;
        }

        closeModal();
        loadCompanions();
      } catch (err) {
        alert('Delete failed: ' + err.message);
      }
    }

    // Close modals on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeModal();
        document.getElementById('authModal').classList.add('hidden');
      }
    });

    // Close modal on backdrop click
    document.getElementById('modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) closeModal();
    });

    // Token setup link
    document.addEventListener('dblclick', (e) => {
      if (e.target.closest('header')) promptAuth();
    });

    // Init
    loadCompanions();
  </script>
</body>
</html>`;
}
