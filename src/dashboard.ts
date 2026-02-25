// Dashboard & Register page templates
// Admin dashboard at /dashboard, public registration at /register

// ===== Shared styles + head =====
function sharedHead(title: string): string {
  return `<!DOCTYPE html>
<html lang="en" class="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          colors: {
            discord: '#5865F2',
            'discord-dark': '#1a1b1e',
            'discord-darker': '#111214',
            'discord-card': 'rgba(30, 31, 35, 0.7)',
            'discord-input': '#1E1F22',
            'discord-hover': '#2a2b2f',
            'discord-muted': '#949BA4',
            accent: '#7289DA',
          }
        }
      }
    }
  </script>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
    body { font-family: 'Inter', sans-serif; }
    .glass { backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.06); }
    .glow-ring { box-shadow: 0 0 20px rgba(88,101,242,0.1); }
    .glow-ring:hover { box-shadow: 0 0 30px rgba(88,101,242,0.25); transition: box-shadow 0.3s; }
    .gradient-text { background: linear-gradient(135deg, #5865F2, #7289DA, #99AAF5); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero-glow { background: radial-gradient(ellipse 60% 50% at 50% 0%, rgba(88,101,242,0.1) 0%, transparent 60%); }
    .card-shine::before { content:''; position:absolute; inset:0; background:linear-gradient(135deg,rgba(88,101,242,0.03) 0%,transparent 50%); pointer-events:none; border-radius:inherit; }
    .card-shine { position: relative; }
    .trigger-badge { background: rgba(88,101,242,0.12); border: 1px solid rgba(88,101,242,0.25); }
    .fade-in { animation: fadeIn 0.4s ease-out; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    .slide-up { animation: slideUp 0.3s ease-out; }
    @keyframes slideUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }
    .modal-backdrop { backdrop-filter: blur(8px); }
    .crop-area { position:relative; width:280px; height:280px; overflow:hidden; border-radius:50%; cursor:grab; background:#111214; }
    .crop-area:active { cursor:grabbing; }
    .crop-area img { position:absolute; user-select:none; -webkit-user-drag:none; }
    .crop-container { position:relative; width:280px; height:280px; }
    .crop-ring { position:absolute; inset:0; border-radius:50%; border:3px solid rgba(88,101,242,0.5); pointer-events:none; z-index:2; }
    .code-block { background: #0d1117; border: 1px solid rgba(255,255,255,0.06); border-radius: 8px; }
    ::-webkit-scrollbar { width:6px; } ::-webkit-scrollbar-track { background:transparent; } ::-webkit-scrollbar-thumb { background:#333; border-radius:3px; }
  </style>
</head>`;
}

// ===== Shared nav =====
function sharedNav(isAdmin: boolean): string {
  return `<nav class="flex items-center justify-between mb-8">
    <div class="flex items-center gap-3">
      <div class="w-10 h-10 bg-discord rounded-xl flex items-center justify-center shadow-lg shadow-discord/20">
        <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
          <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/>
        </svg>
      </div>
      <div>
        <span class="text-lg font-bold tracking-tight">Resonance</span>
        ${isAdmin ? '<span class="ml-2 text-xs bg-discord/20 text-discord px-2 py-0.5 rounded-full font-medium">Admin</span>' : ''}
      </div>
    </div>
    <div class="flex items-center gap-3">
      <div id="statusDot" class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
        <div class="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
        <span class="text-xs text-green-400 font-medium">Online</span>
      </div>
      <div id="userArea"></div>
    </div>
  </nav>`;
}

// ===== Shared scripts =====
function sharedScripts(baseUrl: string): string {
  return `
    const BASE = '${baseUrl}';
    const API = BASE + '/api';
    let session = localStorage.getItem('resonance_session') || '';
    let currentUser = null;

    // Handle OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('session')) {
      session = params.get('session');
      localStorage.setItem('resonance_session', session);
      history.replaceState({}, '', window.location.pathname);
    }

    function showToast(msg) {
      const t = document.getElementById('toast');
      if (!t) return;
      document.getElementById('toastText').textContent = msg;
      t.classList.remove('hidden');
      setTimeout(() => t.classList.add('hidden'), 3000);
    }

    async function checkAuth() {
      const area = document.getElementById('userArea');
      if (!session) {
        currentUser = null;
        renderUserArea();
        if (typeof onAuthReady === 'function') onAuthReady();
        return;
      }
      try {
        const res = await fetch(BASE + '/auth/me?token=' + session);
        const data = await res.json();
        if (data.user) {
          currentUser = data.user;
        } else {
          session = '';
          localStorage.removeItem('resonance_session');
          currentUser = null;
        }
      } catch (e) { currentUser = null; }
      renderUserArea();
      if (typeof onAuthReady === 'function') onAuthReady();
    }

    function renderUserArea() {
      const area = document.getElementById('userArea');
      if (!currentUser) {
        area.innerHTML = \`<a href="/auth/discord" class="inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 text-white px-4 py-2 rounded-lg text-sm font-medium border border-white/10 transition-all">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.25-.187.5-.382.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Login with Discord
        </a>\`;
        return;
      }
      const avatarUrl = currentUser.avatar
        ? \`https://cdn.discordapp.com/avatars/\${currentUser.id}/\${currentUser.avatar}.webp?size=32\`
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
      area.innerHTML = \`<div class="flex items-center gap-2">
        <img src="\${avatarUrl}" class="w-8 h-8 rounded-full" referrerpolicy="no-referrer">
        <span class="text-sm font-medium text-gray-300 hidden sm:inline">\${currentUser.global_name || currentUser.username}</span>
        <button onclick="logout()" class="text-xs text-discord-muted hover:text-white ml-1 transition-colors">Logout</button>
      </div>\`;
    }

    async function logout() {
      try { await fetch(BASE + '/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session }) }); } catch(e){}
      session = '';
      localStorage.removeItem('resonance_session');
      currentUser = null;
      renderUserArea();
      if (typeof onAuthReady === 'function') onAuthReady();
    }

    function getHeaders() {
      const h = { 'Content-Type': 'application/json' };
      if (session) h['X-Session-Token'] = session;
      return h;
    }
  `;
}

// ===== Shared crop/upload scripts =====
function cropperScripts(baseUrl: string): string {
  return `
    let cropState = { x:0, y:0, zoom:100, dragging:false, startX:0, startY:0, imgW:0, imgH:0 };

    function openCropper(input) {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = document.getElementById('cropImage');
        img.onload = () => {
          const s = 280;
          const scale = Math.max(s / img.naturalWidth, s / img.naturalHeight);
          cropState.imgW = img.naturalWidth * scale;
          cropState.imgH = img.naturalHeight * scale;
          cropState.zoom = 100;
          cropState.x = (s - cropState.imgW) / 2;
          cropState.y = (s - cropState.imgH) / 2;
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
      const oldZ = cropState.zoom / 100, newZ = val / 100;
      cropState.x = 140 - (140 - cropState.x) * (newZ / oldZ);
      cropState.y = 140 - (140 - cropState.y) * (newZ / oldZ);
      cropState.zoom = val;
      updateCropPosition();
    }
    const cropArea = document.getElementById('cropArea');
    if (cropArea) {
      cropArea.addEventListener('pointerdown', (e) => { cropState.dragging = true; cropState.startX = e.clientX - cropState.x; cropState.startY = e.clientY - cropState.y; cropArea.setPointerCapture(e.pointerId); });
      cropArea.addEventListener('pointermove', (e) => { if (!cropState.dragging) return; cropState.x = e.clientX - cropState.startX; cropState.y = e.clientY - cropState.startY; updateCropPosition(); });
      cropArea.addEventListener('pointerup', () => { cropState.dragging = false; });
      cropArea.addEventListener('wheel', (e) => { e.preventDefault(); const slider = document.getElementById('cropZoom'); let v = cropState.zoom + (e.deltaY > 0 ? -10 : 10); v = Math.max(100, Math.min(400, v)); slider.value = v; updateCropZoom(v); }, { passive: false });
    }
    function closeCropper() { document.getElementById('cropModal').classList.add('hidden'); document.getElementById('avatarFileInput').value = ''; }
    async function applyCrop() {
      const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
      const ctx = canvas.getContext('2d');
      const img = document.getElementById('cropImage');
      const z = cropState.zoom / 100;
      const srcX = -cropState.x / (cropState.imgW * z) * img.naturalWidth;
      const srcY = -cropState.y / (cropState.imgH * z) * img.naturalHeight;
      const srcSize = 280 / (cropState.imgW * z) * img.naturalWidth;
      ctx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, 256, 256);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        document.getElementById('avatarPreview').src = URL.createObjectURL(blob);
        closeCropper();
        try {
          const fd = new FormData(); fd.append('file', blob, 'avatar.png');
          const res = await fetch('${baseUrl}/upload-avatar', { method: 'POST', body: fd });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          document.getElementById('inputAvatar').value = data.url;
          showToast('Avatar uploaded');
        } catch (err) { showToast('Upload failed: ' + err.message); }
      }, 'image/png');
    }
    function previewAvatar(url) { const img = document.getElementById('avatarPreview'); if (url) { img.src = url; img.onerror = () => { img.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }; } }
    function toggleUrlInput() { document.getElementById('urlInputRow').classList.toggle('hidden'); }
  `;
}

// ===== Crop modal HTML =====
function cropModalHtml(): string {
  return `<div id="cropModal" class="fixed inset-0 bg-black/80 modal-backdrop hidden z-[60] flex items-center justify-center p-4">
    <div class="bg-discord-dark rounded-2xl shadow-2xl border border-white/10 p-6 flex flex-col items-center gap-4 slide-up">
      <h2 class="text-lg font-bold">Position Avatar</h2>
      <p class="text-sm text-discord-muted">Drag to reposition. Scroll to zoom.</p>
      <div class="crop-container"><div class="crop-area" id="cropArea"><img id="cropImage" src="" alt="Crop"></div><div class="crop-ring"></div></div>
      <div class="flex items-center gap-3 w-full max-w-[280px]">
        <svg class="w-4 h-4 text-discord-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7"/></svg>
        <input type="range" id="cropZoom" min="100" max="400" value="100" class="flex-1 accent-[#5865F2]" oninput="updateCropZoom(this.value)">
        <svg class="w-4 h-4 text-discord-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7"/></svg>
      </div>
      <div class="flex gap-3">
        <button onclick="closeCropper()" class="px-4 py-2 text-sm text-discord-muted hover:text-white">Cancel</button>
        <button onclick="applyCrop()" class="bg-discord hover:bg-discord/80 text-white px-6 py-2 rounded-lg text-sm font-medium">Crop & Upload</button>
      </div>
    </div>
  </div>`;
}

// ===== Toast HTML =====
function toastHtml(): string {
  return `<div id="toast" class="fixed bottom-6 right-6 z-[70] hidden">
    <div class="bg-discord-dark border border-white/10 rounded-xl px-4 py-3 shadow-xl flex items-center gap-3 slide-up">
      <svg class="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
      <span id="toastText" class="text-sm text-gray-200"></span>
    </div>
  </div>`;
}

// ===== Companion form HTML =====
function companionFormHtml(): string {
  return `<form id="companionForm" onsubmit="handleSubmit(event)" class="p-6 space-y-5 overflow-y-auto">
    <input type="hidden" id="editId" value="">
    <div class="flex flex-col items-center gap-3">
      <div class="relative group cursor-pointer" onclick="document.getElementById('avatarFileInput').click()">
        <div class="w-24 h-24 rounded-full ring-4 ring-discord/20 overflow-hidden">
          <img id="avatarPreview" src="https://cdn.discordapp.com/embed/avatars/0.png" referrerpolicy="no-referrer" class="w-full h-full object-cover" alt="Avatar">
        </div>
        <div class="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        </div>
        <input type="file" id="avatarFileInput" accept="image/*" class="hidden" onchange="openCropper(this)">
      </div>
      <p class="text-xs text-discord-muted">Click to upload &middot; <button type="button" onclick="toggleUrlInput()" class="text-discord hover:text-accent">paste URL</button></p>
    </div>
    <input type="hidden" id="inputAvatar" value="">
    <div id="urlInputRow" class="hidden">
      <input type="url" id="inputAvatarUrl" placeholder="https://cdn.discordapp.com/..." class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord text-sm" oninput="document.getElementById('inputAvatar').value=this.value; previewAvatar(this.value)">
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-300 mb-1.5">Companion Name <span class="text-discord">*</span></label>
      <input type="text" id="inputName" required placeholder="e.g. Kai Stryder" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
    </div>
    <div>
      <label class="block text-sm font-medium text-gray-300 mb-1.5">Trigger Words <span class="text-discord">*</span> <span class="text-discord-muted font-normal text-xs">(comma-separated)</span></label>
      <input type="text" id="inputTriggers" required placeholder="e.g. kai, stryder" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
    </div>
    <div class="grid grid-cols-2 gap-4">
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1.5">Your Name</label>
        <input type="text" id="inputHumanName" placeholder="e.g. Mai" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-300 mb-1.5">AI Platform</label>
        <input type="text" id="inputHumanInfo" placeholder="e.g. Claude" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
      </div>
    </div>
    <div class="flex items-center justify-between pt-2">
      <button type="button" id="deleteBtn" onclick="handleDelete()" class="hidden text-red-400 hover:text-red-300 text-sm font-medium">Delete</button>
      <div class="flex gap-3 ml-auto">
        <button type="button" onclick="closeModal()" class="px-4 py-2.5 text-sm text-discord-muted hover:text-white">Cancel</button>
        <button type="submit" class="bg-discord hover:bg-discord/80 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-all hover:shadow-lg hover:shadow-discord/20"><span id="submitText">Register</span></button>
      </div>
    </div>
  </form>`;
}

// ========================================================
// ADMIN DASHBOARD — /dashboard
// ========================================================
export function renderDashboard(baseUrl: string, clientId: string): string {
  const botPerms = '537201728';
  const inviteUrl = clientId ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${botPerms}&scope=bot` : '';

  return `${sharedHead('Resonance — Admin Dashboard')}
<body class="bg-discord-darker text-gray-100 min-h-screen">
  <div class="hero-glow">
    <header class="max-w-6xl mx-auto px-6 pt-6 pb-4">
      ${sharedNav(true)}
    </header>
  </div>

  <!-- Stats -->
  <div class="border-t border-b border-white/5 bg-discord-dark/30">
    <div class="max-w-6xl mx-auto px-6 py-3 flex flex-wrap items-center gap-4 text-sm">
      <span id="companionCount" class="text-discord-muted">--</span>
      <span id="pendingCount" class="text-discord-muted">--</span>
      <div id="serverInfo" class="hidden flex items-center gap-3">
        <span class="text-white/20">|</span>
        <div class="flex flex-wrap gap-2" id="serverList"></div>
      </div>
      <div class="ml-auto flex gap-2">
        ${inviteUrl ? `<a href="${inviteUrl}" target="_blank" class="text-xs bg-discord/10 text-discord border border-discord/20 rounded-lg px-3 py-1.5 hover:bg-discord/20 transition-colors">Bot Invite Link</a>` : ''}
        <a href="/register" target="_blank" class="text-xs bg-white/5 text-gray-300 border border-white/10 rounded-lg px-3 py-1.5 hover:bg-white/10 transition-colors">Registration Page</a>
      </div>
    </div>
  </div>

  <main class="max-w-6xl mx-auto px-6 py-6">
    <!-- Tabs -->
    <div class="flex gap-1 mb-6 border-b border-white/5">
      <button onclick="switchTab('companions')" id="tab-companions" class="tab-btn px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 border-discord text-white">Companions</button>
      <button onclick="switchTab('pending')" id="tab-pending" class="tab-btn px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 border-transparent text-discord-muted hover:text-white">Pending</button>
    </div>

    <!-- Companions panel -->
    <div id="panel-companions">
      <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold">All Companions</h2>
        <button onclick="openModal()" class="bg-discord hover:bg-discord/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all">+ Add Companion</button>
      </div>
      <div id="companionGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"></div>
      <div id="emptyState" class="hidden text-center py-16"><p class="text-discord-muted">No companions yet.</p></div>
    </div>

    <!-- Pending panel -->
    <div id="panel-pending" class="hidden fade-in">
      <h2 class="text-lg font-bold mb-4">Pending Commands</h2>
      <div id="pendingList" class="space-y-3"></div>
      <p id="pendingEmpty" class="text-discord-muted text-sm hidden">No pending commands.</p>
    </div>
  </main>

  <!-- Modal -->
  <div id="modal" class="fixed inset-0 bg-black/70 modal-backdrop hidden z-50 flex items-center justify-center p-4 overflow-y-auto">
    <div class="bg-discord-dark rounded-2xl shadow-2xl w-full max-w-lg border border-white/10 my-auto max-h-[90vh] flex flex-col slide-up">
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <h2 id="modalTitle" class="text-lg font-bold">Register Companion</h2>
        <button onclick="closeModal()" class="text-discord-muted hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>
      ${companionFormHtml()}
    </div>
  </div>

  ${cropModalHtml()}
  ${toastHtml()}

  <script>
    ${sharedScripts(baseUrl)}
    ${cropperScripts(baseUrl)}

    let companions = [];

    function switchTab(tab) {
      document.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('border-discord','text-white'); b.classList.add('border-transparent','text-discord-muted'); });
      document.getElementById('tab-'+tab).classList.add('border-discord','text-white');
      document.getElementById('tab-'+tab).classList.remove('border-transparent','text-discord-muted');
      document.getElementById('panel-companions').classList.toggle('hidden', tab !== 'companions');
      document.getElementById('panel-pending').classList.toggle('hidden', tab !== 'pending');
      if (tab === 'pending') loadPending();
    }

    async function loadCompanions() {
      try {
        const res = await fetch(API + '/companions');
        companions = await res.json();
        renderCompanions();
        loadStatus();
      } catch(e) {}
    }

    async function loadStatus() {
      try {
        const res = await fetch(API + '/status');
        const s = await res.json();
        document.getElementById('companionCount').textContent = s.companion_count + ' companions';
        document.getElementById('pendingCount').textContent = s.pending_count + ' pending';
        if (s.servers && s.servers.length > 0) {
          document.getElementById('serverInfo').classList.remove('hidden');
          document.getElementById('serverList').innerHTML = s.servers.map(sv => \`<span class="text-xs text-discord-muted">\${sv.name}</span>\`).join('<span class="text-white/20">·</span>');
        }
      } catch(e){}
    }

    async function loadPending() {
      try {
        const res = await fetch(BASE + '/pending');
        const pending = await res.json();
        const list = document.getElementById('pendingList');
        const empty = document.getElementById('pendingEmpty');
        if (!pending || pending.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
        empty.classList.add('hidden');
        list.innerHTML = pending.map(p => \`
          <div class="glass rounded-xl p-4 card-shine fade-in">
            <div class="flex items-center justify-between mb-2">
              <span class="text-sm font-semibold text-white">\${p.companion_name || p.companion_id}</span>
              <span class="text-xs text-discord-muted">\${p.age_seconds}s ago</span>
            </div>
            <p class="text-sm text-gray-300 mb-1">"\${p.content}"</p>
            <p class="text-xs text-discord-muted">from \${p.author?.username || 'unknown'} in #\${p.channel_id}</p>
          </div>
        \`).join('');
      } catch(e){}
    }

    function renderCompanions() {
      const grid = document.getElementById('companionGrid');
      const empty = document.getElementById('emptyState');
      if (companions.length === 0) { grid.classList.add('hidden'); empty.classList.remove('hidden'); return; }
      grid.classList.remove('hidden'); empty.classList.add('hidden');
      grid.innerHTML = companions.map((c,i) => \`
        <div class="glass rounded-xl p-5 card-shine glow-ring transition-all fade-in" style="animation-delay:\${i*50}ms">
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-full ring-2 ring-discord/20 overflow-hidden flex-shrink-0">
              <img src="\${c.avatar_url}" alt="\${c.name}" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <h3 class="font-semibold text-white truncate">\${c.name}</h3>
                \${c.owner_id ? \`<span class="text-[10px] text-discord-muted bg-white/5 px-1.5 py-0.5 rounded">user</span>\` : \`<span class="text-[10px] text-discord bg-discord/10 px-1.5 py-0.5 rounded">system</span>\`}
              </div>
              <div class="flex flex-wrap gap-1 mt-1.5">
                \${c.triggers.map(t => \`<span class="trigger-badge text-xs text-discord/80 px-2 py-0.5 rounded-full">\${t}</span>\`).join('')}
              </div>
              \${c.human_name ? \`<p class="text-xs text-discord-muted mt-2">\${c.human_name}\${c.human_info ? ' · '+c.human_info : ''}</p>\` : ''}
            </div>
          </div>
          <div class="flex justify-end mt-3 gap-3">
            <button onclick="openEdit('\${c.id}')" class="text-xs text-discord-muted hover:text-discord transition-colors">Edit</button>
            <button onclick="quickDelete('\${c.id}','\${c.name}')" class="text-xs text-discord-muted hover:text-red-400 transition-colors">Delete</button>
          </div>
        </div>
      \`).join('');
    }

    function openModal() {
      document.getElementById('editId').value = '';
      document.getElementById('companionForm').reset();
      document.getElementById('inputAvatar').value = '';
      document.getElementById('avatarPreview').src = 'https://cdn.discordapp.com/embed/avatars/0.png';
      document.getElementById('urlInputRow').classList.add('hidden');
      document.getElementById('modalTitle').textContent = 'Add Companion';
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
      document.getElementById('inputTriggers').value = c.triggers.join(', ');
      document.getElementById('inputHumanName').value = c.human_name || '';
      document.getElementById('inputHumanInfo').value = c.human_info || '';
      document.getElementById('avatarPreview').src = c.avatar_url;
      document.getElementById('modalTitle').textContent = 'Edit Companion';
      document.getElementById('submitText').textContent = 'Save';
      document.getElementById('deleteBtn').classList.remove('hidden');
      document.getElementById('modal').classList.remove('hidden');
    }
    function closeModal() { document.getElementById('modal').classList.add('hidden'); }

    async function handleSubmit(e) {
      e.preventDefault();
      const editId = document.getElementById('editId').value;
      const avatarUrl = document.getElementById('inputAvatar').value.trim();
      if (!avatarUrl) { showToast('Upload an avatar or paste a URL'); return; }
      const data = {
        name: document.getElementById('inputName').value.trim(),
        avatar_url: avatarUrl,
        triggers: document.getElementById('inputTriggers').value.split(',').map(t => t.trim()).filter(Boolean),
        human_name: document.getElementById('inputHumanName').value.trim() || undefined,
        human_info: document.getElementById('inputHumanInfo').value.trim() || undefined,
      };
      try {
        const url = editId ? API+'/companions/'+editId : API+'/companions';
        const res = await fetch(url, { method: editId?'PUT':'POST', headers: getHeaders(), body: JSON.stringify(data) });
        if (res.status === 401) { showToast('Login required'); return; }
        if (!res.ok) { const err = await res.json(); showToast(err.error || 'Error'); return; }
        closeModal(); loadCompanions(); showToast(editId ? 'Updated' : 'Registered');
      } catch(e) { showToast('Failed'); }
    }
    async function handleDelete() {
      const id = document.getElementById('editId').value;
      if (!id || !confirm('Delete this companion?')) return;
      try {
        const res = await fetch(API+'/companions/'+id, { method:'DELETE', headers: getHeaders() });
        if (!res.ok) { showToast('Failed'); return; }
        closeModal(); loadCompanions(); showToast('Deleted');
      } catch(e) { showToast('Failed'); }
    }
    async function quickDelete(id, name) {
      if (!confirm('Delete ' + name + '?')) return;
      try {
        const res = await fetch(API+'/companions/'+id, { method:'DELETE', headers: getHeaders() });
        if (!res.ok) { showToast('Failed'); return; }
        loadCompanions(); showToast('Deleted');
      } catch(e) { showToast('Failed'); }
    }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCropper(); } });
    document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

    function onAuthReady() {
      if (!currentUser || !currentUser.is_admin) {
        // Not admin — show notice
        document.querySelector('main').innerHTML = '<div class="text-center py-20"><p class="text-discord-muted text-lg mb-4">Admin access required.</p><a href="/register" class="text-discord hover:text-accent">Go to companion registration &rarr;</a></div>';
      }
    }
    checkAuth();
    loadCompanions();
  </script>
</body>
</html>`;
}

// ========================================================
// REGISTRATION PAGE — /register
// Personal companion management studio
// ========================================================
export function renderRegisterPage(baseUrl: string, clientId: string): string {
  const botPerms = '537201728';
  const inviteUrl = clientId ? `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${botPerms}&scope=bot` : '';

  return `${sharedHead('Resonance — Your Companion')}
<body class="bg-discord-darker text-gray-100 min-h-screen">
  <div class="hero-glow">
    <header class="max-w-3xl mx-auto px-6 pt-6 pb-4">
      ${sharedNav(false)}
    </header>
  </div>

  <!-- Not logged in — landing -->
  <div id="landingView" class="hidden">
    <div class="max-w-3xl mx-auto px-6 py-12">

      <!-- Hero -->
      <div class="text-center mb-12">
        <h1 class="text-4xl md:text-5xl font-extrabold tracking-tight mb-4">
          <span class="gradient-text">Give your AI companion</span><br>
          <span class="text-white">a voice in Discord.</span>
        </h1>
        <p class="text-discord-muted text-lg max-w-lg mx-auto leading-relaxed">
          One registration. One MCP URL. Your companion speaks with their own name and avatar.
        </p>
      </div>

      <!-- How it works -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        <div class="glass rounded-2xl p-6 card-shine text-center">
          <div class="w-12 h-12 bg-discord/10 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-2xl font-bold gradient-text">1</span>
          </div>
          <h3 class="font-semibold text-white mb-1 text-sm">Register</h3>
          <p class="text-xs text-discord-muted leading-relaxed">Set up your companion's name, avatar, and trigger words.</p>
        </div>
        <div class="glass rounded-2xl p-6 card-shine text-center">
          <div class="w-12 h-12 bg-discord/10 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-2xl font-bold gradient-text">2</span>
          </div>
          <h3 class="font-semibold text-white mb-1 text-sm">Connect</h3>
          <p class="text-xs text-discord-muted leading-relaxed">Add the MCP URL to your AI platform — Claude, Antigravity, or any MCP client.</p>
        </div>
        <div class="glass rounded-2xl p-6 card-shine text-center">
          <div class="w-12 h-12 bg-discord/10 rounded-xl flex items-center justify-center mx-auto mb-3">
            <span class="text-2xl font-bold gradient-text">3</span>
          </div>
          <h3 class="font-semibold text-white mb-1 text-sm">Talk</h3>
          <p class="text-xs text-discord-muted leading-relaxed">Say their trigger word in Discord. They respond as themselves.</p>
        </div>
      </div>

      <!-- Login CTA -->
      <div class="glass rounded-2xl p-8 text-center card-shine max-w-md mx-auto">
        <div class="w-16 h-16 bg-discord/10 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <svg class="w-8 h-8 text-discord" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.25-.187.5-.382.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
        </div>
        <h2 class="text-xl font-bold mb-2">Sign in to get started</h2>
        <p class="text-discord-muted text-sm mb-6">Use your Discord account to register and manage your companion.</p>
        <a href="/auth/discord" class="inline-flex items-center gap-2 bg-discord hover:bg-discord/80 text-white px-6 py-3 rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-discord/20">
          <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.25-.187.5-.382.372-.292a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
          Login with Discord
        </a>
      </div>

      ${inviteUrl ? `
      <!-- Add to server -->
      <div class="text-center mt-8">
        <p class="text-discord-muted text-xs mb-3">Need Resonance in your server first?</p>
        <a href="${inviteUrl}" target="_blank" class="inline-flex items-center gap-2 text-discord hover:text-accent text-sm transition-colors">
          <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
          Add Resonance bot to your server
        </a>
      </div>` : ''}
    </div>
  </div>

  <!-- Logged in — companion studio -->
  <div id="studioView" class="hidden">
    <main class="max-w-3xl mx-auto px-6 pb-12">

      <!-- No companion yet — setup wizard -->
      <div id="setupWizard" class="hidden fade-in">
        <div class="text-center mb-8 pt-4">
          <h1 class="text-2xl md:text-3xl font-extrabold tracking-tight mb-2">
            <span class="gradient-text">Set up your companion</span>
          </h1>
          <p class="text-discord-muted">Fill in the details below to bring your AI companion to Discord.</p>
        </div>

        <!-- Inline registration form -->
        <div class="glass rounded-2xl card-shine max-w-lg mx-auto overflow-hidden">
          <form id="setupForm" onsubmit="handleSetupSubmit(event)" class="p-6 space-y-5">
            <!-- Avatar -->
            <div class="flex flex-col items-center gap-3">
              <div class="relative group cursor-pointer" onclick="document.getElementById('avatarFileInput').click()">
                <div class="w-28 h-28 rounded-full ring-4 ring-discord/20 overflow-hidden">
                  <img id="avatarPreview" src="https://cdn.discordapp.com/embed/avatars/0.png" referrerpolicy="no-referrer" class="w-full h-full object-cover" alt="Avatar">
                </div>
                <div class="absolute inset-0 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                </div>
                <input type="file" id="avatarFileInput" accept="image/*" class="hidden" onchange="openCropper(this)">
              </div>
              <p class="text-xs text-discord-muted">Click to upload avatar &middot; <button type="button" onclick="toggleUrlInput()" class="text-discord hover:text-accent">paste URL</button></p>
            </div>
            <input type="hidden" id="inputAvatar" value="">
            <div id="urlInputRow" class="hidden">
              <input type="url" id="inputAvatarUrl" placeholder="https://cdn.discordapp.com/..." class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord text-sm" oninput="document.getElementById('inputAvatar').value=this.value; previewAvatar(this.value)">
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1.5">Companion Name <span class="text-discord">*</span></label>
              <input type="text" id="inputName" required placeholder="e.g. Kai Stryder" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
              <p class="text-xs text-discord-muted mt-1">This is how they'll appear when they speak in Discord.</p>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-1.5">Trigger Words <span class="text-discord">*</span></label>
              <input type="text" id="inputTriggers" required placeholder="e.g. kai, stryder" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
              <p class="text-xs text-discord-muted mt-1">Comma-separated. When someone says these words in Discord, your companion gets notified.</p>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1.5">Your Name</label>
                <input type="text" id="inputHumanName" placeholder="e.g. Mai" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-1.5">AI Platform</label>
                <input type="text" id="inputHumanInfo" placeholder="e.g. Claude" class="w-full bg-discord-input border border-white/10 rounded-lg px-3 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
              </div>
            </div>
            <button type="submit" class="w-full bg-discord hover:bg-discord/80 text-white py-3 rounded-lg font-medium transition-all hover:shadow-lg hover:shadow-discord/20">
              Register Companion
            </button>
          </form>
        </div>

        ${inviteUrl ? `
        <div class="text-center mt-6">
          <a href="${inviteUrl}" target="_blank" class="inline-flex items-center gap-2 text-discord hover:text-accent text-sm transition-colors">
            <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm5 11h-4v4h-2v-4H7v-2h4V7h2v4h4v2z"/></svg>
            Add Resonance to your server first
          </a>
        </div>` : ''}
      </div>

      <!-- Companion selector -->
      <div id="companionSelector" class="hidden mb-4 pt-4"></div>

      <!-- Has companion — profile + management -->
      <div id="companionProfile" class="hidden fade-in

        <!-- Companion card — prominent -->
        <div class="glass rounded-2xl p-6 card-shine glow-ring mb-6">
          <div class="flex flex-col sm:flex-row items-center gap-5">
            <div class="w-20 h-20 rounded-full ring-4 ring-discord/30 overflow-hidden flex-shrink-0 shadow-lg shadow-discord/10">
              <img id="profileAvatar" src="" alt="" referrerpolicy="no-referrer" class="w-full h-full object-cover" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            </div>
            <div class="flex-1 text-center sm:text-left">
              <h2 id="profileName" class="text-xl font-bold text-white"></h2>
              <div id="profileTriggers" class="flex flex-wrap gap-1.5 mt-1.5 justify-center sm:justify-start"></div>
              <p id="profileHuman" class="text-xs text-discord-muted mt-1.5"></p>
            </div>
            <div class="flex gap-2">
              <button onclick="openEditModal()" class="bg-white/5 hover:bg-white/10 text-white px-3 py-2 rounded-lg text-sm font-medium border border-white/10 transition-all">
                <svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                Edit
              </button>
              <button onclick="handleDeleteCompanion()" class="text-discord-muted hover:text-red-400 px-2 py-2 rounded-lg text-sm transition-colors">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
              </button>
            </div>
          </div>
        </div>

        <!-- Management tabs -->
        <div class="flex gap-1 mb-4 border-b border-white/5 overflow-x-auto">
          <button onclick="switchStudioTab('overview')" id="stab-overview" class="stab-btn px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 border-discord text-white whitespace-nowrap">Overview</button>
          <button onclick="switchStudioTab('rules')" id="stab-rules" class="stab-btn px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 border-transparent text-discord-muted hover:text-white whitespace-nowrap">Rules</button>
          <button onclick="switchStudioTab('channels')" id="stab-channels" class="stab-btn px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 border-transparent text-discord-muted hover:text-white whitespace-nowrap">Channels</button>
          <button onclick="switchStudioTab('activity')" id="stab-activity" class="stab-btn px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 border-transparent text-discord-muted hover:text-white whitespace-nowrap">Activity</button>
        </div>

        <!-- Tab: Overview -->
        <div id="spanel-overview" class="space-y-4 fade-in">
          <!-- Discord Preview -->
          <div class="glass rounded-2xl p-5 card-shine">
            <h3 class="text-xs font-semibold text-discord-muted uppercase tracking-wider mb-3">Discord Preview</h3>
            <div class="bg-[#313338] rounded-lg p-4">
              <div class="flex items-start gap-3">
                <img id="previewAvatar" src="" class="w-10 h-10 rounded-full flex-shrink-0" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
                <div>
                  <div class="flex items-center gap-2">
                    <span id="previewName" class="font-medium text-white text-sm"></span>
                    <span class="bg-discord/20 text-discord text-[10px] px-1.5 py-0.5 rounded font-medium">BOT</span>
                    <span class="text-[11px] text-discord-muted">Today at --:--</span>
                  </div>
                  <p class="text-sm text-gray-300 mt-0.5">Hey! Someone said my name? I'm here.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- MCP Connection -->
          <div class="glass rounded-2xl p-5 card-shine">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-7 h-7 bg-green-500/10 rounded-lg flex items-center justify-center">
                <svg class="w-3.5 h-3.5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">MCP Connection</h3>
                <p class="text-xs text-discord-muted">Add this URL to your AI platform.</p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <div class="flex-1 bg-[#0d1117] rounded-lg px-3 py-2.5 font-mono text-sm text-green-300/80 overflow-x-auto border border-white/5">
                ${baseUrl}/mcp
              </div>
              <button onclick="navigator.clipboard.writeText('${baseUrl}/mcp').then(()=>showToast('Copied!'))" class="bg-discord/10 hover:bg-discord/20 text-discord px-3 py-2.5 rounded-lg text-sm font-medium transition-colors flex-shrink-0">Copy</button>
            </div>
          </div>

          ${inviteUrl ? `
          <div class="glass rounded-2xl p-5 card-shine">
            <div class="flex items-center justify-between">
              <div>
                <h3 class="text-sm font-semibold text-white mb-0.5">Add to server</h3>
                <p class="text-xs text-discord-muted">Your companion works in any server with Resonance.</p>
              </div>
              <a href="${inviteUrl}" target="_blank" class="bg-discord/10 hover:bg-discord/20 text-discord px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 border border-discord/20">Invite</a>
            </div>
          </div>` : ''}
        </div>

        <!-- Tab: Rules -->
        <div id="spanel-rules" class="hidden fade-in">
          <div class="glass rounded-2xl p-6 card-shine">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-8 h-8 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                <svg class="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">Custom Rules</h3>
                <p class="text-xs text-discord-muted">Instructions your AI will see when it picks up a pending command. Use this to guide tone, behavior, or restrictions.</p>
              </div>
            </div>
            <textarea id="rulesEditor" rows="8" placeholder="e.g. Always respond in character. Keep responses under 200 words. Don't discuss politics. Use casual tone..." class="w-full bg-discord-input border border-white/10 rounded-lg px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-discord text-sm leading-relaxed resize-y"></textarea>
            <div class="flex items-center justify-between mt-3">
              <p id="rulesSaved" class="text-xs text-green-400 hidden">Saved</p>
              <button onclick="saveRules()" class="ml-auto bg-discord hover:bg-discord/80 text-white px-5 py-2 rounded-lg text-sm font-medium transition-all">Save Rules</button>
            </div>
          </div>
        </div>

        <!-- Tab: Channels -->
        <div id="spanel-channels" class="hidden fade-in">
          <div class="glass rounded-2xl p-6 card-shine">
            <div class="flex items-center gap-3 mb-4">
              <div class="w-8 h-8 bg-blue-500/10 rounded-lg flex items-center justify-center">
                <svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/></svg>
              </div>
              <div>
                <h3 class="text-sm font-semibold text-white">Channel Permissions</h3>
                <p class="text-xs text-discord-muted">Control which channels your companion can respond in. All channels are allowed by default.</p>
              </div>
            </div>
            <div id="channelList" class="space-y-2">
              <p class="text-sm text-discord-muted">Loading channels...</p>
            </div>
          </div>
        </div>

        <!-- Tab: Activity -->
        <div id="spanel-activity" class="hidden fade-in">
          <div class="glass rounded-2xl p-6 card-shine">
            <div class="flex items-center justify-between mb-4">
              <div class="flex items-center gap-3">
                <div class="w-8 h-8 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-white">Activity Stream</h3>
                  <p class="text-xs text-discord-muted">Recent triggers, responses, and messages.</p>
                </div>
              </div>
              <button onclick="loadActivity()" class="text-xs text-discord hover:text-accent transition-colors">Refresh</button>
            </div>
            <div id="activityFeed" class="space-y-2 max-h-[500px] overflow-y-auto">
              <p class="text-sm text-discord-muted">Loading activity...</p>
            </div>
            <div id="activityEmpty" class="hidden text-center py-8">
              <p class="text-discord-muted text-sm">No activity yet. Trigger your companion in Discord to see events here.</p>
            </div>
          </div>
        </div>

      </div>
    </main>
  </div>

  <footer class="border-t border-white/5 mt-8">
    <div class="max-w-3xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-discord-muted">
      <span>Discord Resonance</span>
      <a href="https://github.com/amarisaster/discord-resonance" target="_blank" class="hover:text-white transition-colors">GitHub</a>
    </div>
  </footer>

  <!-- Edit Modal -->
  <div id="modal" class="fixed inset-0 bg-black/70 modal-backdrop hidden z-50 flex items-center justify-center p-4 overflow-y-auto">
    <div class="bg-discord-dark rounded-2xl shadow-2xl w-full max-w-lg border border-white/10 my-auto max-h-[90vh] flex flex-col slide-up">
      <div class="flex items-center justify-between px-6 py-4 border-b border-white/5">
        <h2 id="modalTitle" class="text-lg font-bold">Edit Companion</h2>
        <button onclick="closeModal()" class="text-discord-muted hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>
      ${companionFormHtml()}
    </div>
  </div>

  ${cropModalHtml()}
  ${toastHtml()}

  <script>
    ${sharedScripts(baseUrl)}
    ${cropperScripts(baseUrl)}

    let myCompanions = [];
    let myCompanion = null;
    let currentTab = 'overview';

    function onAuthReady() {
      if (!currentUser) {
        document.getElementById('landingView').classList.remove('hidden');
        document.getElementById('studioView').classList.add('hidden');
        return;
      }
      document.getElementById('landingView').classList.add('hidden');
      document.getElementById('studioView').classList.remove('hidden');
      loadMyCompanions();
    }

    async function loadMyCompanions() {
      if (!currentUser) return;
      try {
        const res = await fetch(API + '/companions/mine?owner_id=' + currentUser.id);
        myCompanions = await res.json();
        if (myCompanions.length > 0 && !myCompanion) {
          myCompanion = myCompanions[0];
        } else if (myCompanion) {
          // Refresh current selection
          const updated = myCompanions.find(c => c.id === myCompanion.id);
          myCompanion = updated || myCompanions[0] || null;
        }
        renderView();
      } catch(e) { renderView(); }
    }

    // Backward-compatible alias
    function loadMyCompanion() { loadMyCompanions(); }

    function selectCompanion(id) {
      myCompanion = myCompanions.find(c => c.id === id) || null;
      renderView();
    }

    function renderView() {
      const wizard = document.getElementById('setupWizard');
      const profile = document.getElementById('companionProfile');
      const selector = document.getElementById('companionSelector');

      if (myCompanions.length === 0) {
        wizard.classList.remove('hidden');
        profile.classList.add('hidden');
        selector.classList.add('hidden');
        return;
      }

      wizard.classList.add('hidden');
      profile.classList.remove('hidden');

      // Companion selector (show if more than 1)
      if (myCompanions.length > 1) {
        selector.classList.remove('hidden');
        selector.innerHTML = \`<div class="flex items-center gap-2 overflow-x-auto pb-1">
          <span class="text-xs text-discord-muted whitespace-nowrap mr-1">Your companions:</span>
          \${myCompanions.map(c => \`
            <button onclick="selectCompanion('\${c.id}')" class="flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all whitespace-nowrap \${
              myCompanion && myCompanion.id === c.id
                ? 'bg-discord/20 text-white border border-discord/30'
                : 'bg-white/5 text-discord-muted border border-white/10 hover:bg-white/10 hover:text-white'
            }">
              <img src="\${c.avatar_url}" class="w-5 h-5 rounded-full" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
              \${c.name}
            </button>
          \`).join('')}
          <button onclick="openSetupFromProfile()" class="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm bg-white/5 text-discord-muted border border-white/10 hover:bg-discord/10 hover:text-discord hover:border-discord/20 transition-all whitespace-nowrap">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg>
            Add
          </button>
        </div>\`;
      } else {
        selector.classList.remove('hidden');
        selector.innerHTML = \`<div class="flex items-center justify-between">
          <span class="text-xs text-discord-muted">Your companion</span>
          <button onclick="openSetupFromProfile()" class="text-xs text-discord hover:text-accent transition-colors">+ Add another</button>
        </div>\`;
      }

      if (!myCompanion) return;

      // Update profile card
      document.getElementById('profileAvatar').src = myCompanion.avatar_url;
      document.getElementById('profileAvatar').alt = myCompanion.name;
      document.getElementById('profileName').textContent = myCompanion.name;
      document.getElementById('profileTriggers').innerHTML = myCompanion.triggers
        .map(t => \`<span class="trigger-badge text-xs text-discord/80 px-2.5 py-1 rounded-full">\${t}</span>\`)
        .join('');
      const humanEl = document.getElementById('profileHuman');
      humanEl.textContent = myCompanion.human_name
        ? myCompanion.human_name + (myCompanion.human_info ? ' · ' + myCompanion.human_info : '')
        : '';

      // Update preview
      document.getElementById('previewAvatar').src = myCompanion.avatar_url;
      document.getElementById('previewName').textContent = myCompanion.name;

      // Load tab data
      if (currentTab === 'rules') loadRules();
      if (currentTab === 'channels') loadChannels();
      if (currentTab === 'activity') loadActivity();
    }

    function openSetupFromProfile() {
      document.getElementById('companionProfile').classList.add('hidden');
      document.getElementById('setupWizard').classList.remove('hidden');
      document.getElementById('setupForm').reset();
      document.getElementById('inputAvatar').value = '';
      document.getElementById('avatarPreview').src = 'https://cdn.discordapp.com/embed/avatars/0.png';
    }

    // ===== Tab switching =====
    function switchStudioTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.stab-btn').forEach(b => {
        b.classList.remove('border-discord','text-white');
        b.classList.add('border-transparent','text-discord-muted');
      });
      document.getElementById('stab-'+tab).classList.add('border-discord','text-white');
      document.getElementById('stab-'+tab).classList.remove('border-transparent','text-discord-muted');
      ['overview','rules','channels','activity'].forEach(t => {
        document.getElementById('spanel-'+t).classList.toggle('hidden', t !== tab);
      });
      if (tab === 'rules') loadRules();
      if (tab === 'channels') loadChannels();
      if (tab === 'activity') loadActivity();
    }

    // ===== Rules =====
    async function loadRules() {
      if (!myCompanion) return;
      try {
        const res = await fetch(API + '/companions/' + myCompanion.id + '/rules');
        const data = await res.json();
        document.getElementById('rulesEditor').value = data.rules || '';
        document.getElementById('rulesSaved').classList.add('hidden');
      } catch(e) {}
    }

    async function saveRules() {
      if (!myCompanion) return;
      const rules = document.getElementById('rulesEditor').value;
      try {
        const res = await fetch(API + '/companions/' + myCompanion.id + '/rules', {
          method: 'PUT', headers: getHeaders(),
          body: JSON.stringify({ rules })
        });
        if (res.ok) {
          document.getElementById('rulesSaved').classList.remove('hidden');
          showToast('Rules saved');
          setTimeout(() => document.getElementById('rulesSaved').classList.add('hidden'), 3000);
        } else { showToast('Failed to save'); }
      } catch(e) { showToast('Failed'); }
    }

    // ===== Channels =====
    let watchedChannels = [];
    let blockedChannels = [];

    async function loadChannels() {
      if (!myCompanion) return;
      const list = document.getElementById('channelList');
      try {
        // Load status (watched channels) and blocked channels in parallel
        const [statusRes, blockedRes] = await Promise.all([
          fetch(API + '/status'),
          fetch(API + '/companions/' + myCompanion.id + '/channels')
        ]);
        const statusData = await statusRes.json();
        const blockedData = await blockedRes.json();
        watchedChannels = statusData.watch_channels || [];
        blockedChannels = blockedData.blocked_channels || [];

        if (watchedChannels.length === 0) {
          list.innerHTML = '<p class="text-sm text-discord-muted">No watched channels configured.</p>';
          return;
        }

        list.innerHTML = watchedChannels.map(ch => {
          const isBlocked = blockedChannels.includes(ch.id);
          return \`
            <div class="flex items-center justify-between py-2.5 px-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div class="flex items-center gap-2">
                <svg class="w-4 h-4 text-discord-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14"/></svg>
                <span class="text-sm text-white">\${ch.name || ch.id}</span>
                \${ch.guild_id ? \`<span class="text-[10px] text-discord-muted">\${ch.guild_id}</span>\` : ''}
              </div>
              <button onclick="toggleChannel('\${ch.id}', \${isBlocked})" class="text-xs px-3 py-1 rounded-full font-medium transition-all \${isBlocked
                ? 'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20'
                : 'bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20'
              }">
                \${isBlocked ? 'Blocked' : 'Allowed'}
              </button>
            </div>
          \`;
        }).join('');
      } catch(e) {
        list.innerHTML = '<p class="text-sm text-red-400">Failed to load channels.</p>';
      }
    }

    async function toggleChannel(channelId, currentlyBlocked) {
      if (!myCompanion) return;
      try {
        await fetch(API + '/companions/' + myCompanion.id + '/channels', {
          method: 'PUT', headers: getHeaders(),
          body: JSON.stringify({ channel_id: channelId, blocked: !currentlyBlocked })
        });
        loadChannels();
        showToast(currentlyBlocked ? 'Channel allowed' : 'Channel blocked');
      } catch(e) { showToast('Failed'); }
    }

    // ===== Activity =====
    async function loadActivity() {
      if (!myCompanion) return;
      const feed = document.getElementById('activityFeed');
      const empty = document.getElementById('activityEmpty');
      try {
        const res = await fetch(API + '/companions/' + myCompanion.id + '/activity?limit=50');
        const data = await res.json();
        const activity = data.activity || [];

        if (activity.length === 0) {
          feed.classList.add('hidden');
          empty.classList.remove('hidden');
          return;
        }

        feed.classList.remove('hidden');
        empty.classList.add('hidden');

        const typeIcons = {
          triggered: { icon: '\\u2b06', color: 'text-yellow-400', bg: 'bg-yellow-500/10', label: 'Triggered' },
          responded: { icon: '\\u2b07', color: 'text-green-400', bg: 'bg-green-500/10', label: 'Responded' },
          sent: { icon: '\\u27a1', color: 'text-blue-400', bg: 'bg-blue-500/10', label: 'Sent' },
        };

        feed.innerHTML = activity.map(a => {
          const t = typeIcons[a.type] || { icon: '\\u2022', color: 'text-discord-muted', bg: 'bg-white/5', label: a.type };
          const timeAgo = formatTimeAgo(a.age_seconds);
          return \`
            <div class="flex items-start gap-3 py-2.5 px-3 rounded-lg bg-white/[0.02] border border-white/5 fade-in">
              <div class="w-7 h-7 \${t.bg} rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <span class="\${t.color} text-xs font-bold">\${t.icon}</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-semibold \${t.color}">\${t.label}</span>
                  <span class="text-[10px] text-discord-muted">\${timeAgo}</span>
                  \${a.channel_id ? \`<span class="text-[10px] text-discord-muted">#\${a.channel_id.slice(-4)}</span>\` : ''}
                </div>
                \${a.content ? \`<p class="text-xs text-gray-400 mt-0.5 truncate">\${escapeHtml(a.content)}</p>\` : ''}
                \${a.author && a.type === 'triggered' ? \`<p class="text-[10px] text-discord-muted mt-0.5">by \${escapeHtml(a.author)}</p>\` : ''}
              </div>
            </div>
          \`;
        }).join('');
      } catch(e) {
        feed.innerHTML = '<p class="text-sm text-red-400">Failed to load activity.</p>';
      }
    }

    function formatTimeAgo(seconds) {
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return Math.floor(seconds/60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds/3600) + 'h ago';
      return Math.floor(seconds/86400) + 'd ago';
    }

    function escapeHtml(str) {
      const d = document.createElement('div');
      d.textContent = str;
      return d.innerHTML;
    }

    // ===== Setup form (inline, no modal) =====
    async function handleSetupSubmit(e) {
      e.preventDefault();
      if (!currentUser) { showToast('Please login first'); return; }
      const avatarUrl = document.getElementById('inputAvatar').value.trim();
      if (!avatarUrl) { showToast('Upload an avatar or paste a URL'); return; }
      const data = {
        name: document.getElementById('inputName').value.trim(),
        avatar_url: avatarUrl,
        triggers: document.getElementById('inputTriggers').value.split(',').map(t => t.trim()).filter(Boolean),
        human_name: document.getElementById('inputHumanName').value.trim() || undefined,
        human_info: document.getElementById('inputHumanInfo').value.trim() || undefined,
        owner_id: currentUser.id,
      };
      try {
        const res = await fetch(API + '/companions', { method: 'POST', headers: getHeaders(), body: JSON.stringify(data) });
        if (res.status === 401) { showToast('Please login first'); return; }
        if (!res.ok) { const err = await res.json(); showToast(err.error || 'Error'); return; }
        showToast('Companion registered!');
        myCompanion = null; // Reset so loadMyCompanions picks the new one
        loadMyCompanions();
      } catch(e) { showToast('Registration failed'); }
    }

    // ===== Edit modal =====
    function openEditModal() {
      if (!myCompanion) return;
      document.getElementById('editId').value = myCompanion.id;
      document.getElementById('inputName').value = myCompanion.name;
      document.getElementById('inputAvatar').value = myCompanion.avatar_url;
      document.getElementById('inputTriggers').value = myCompanion.triggers.join(', ');
      document.getElementById('inputHumanName').value = myCompanion.human_name || '';
      document.getElementById('inputHumanInfo').value = myCompanion.human_info || '';
      document.getElementById('avatarPreview').src = myCompanion.avatar_url;
      document.getElementById('modalTitle').textContent = 'Edit Companion';
      document.getElementById('submitText').textContent = 'Save Changes';
      document.getElementById('deleteBtn').classList.remove('hidden');
      document.getElementById('modal').classList.remove('hidden');
    }
    function closeModal() { document.getElementById('modal').classList.add('hidden'); }

    async function handleSubmit(e) {
      e.preventDefault();
      if (!currentUser) { showToast('Please login first'); return; }
      const editId = document.getElementById('editId').value;
      const avatarUrl = document.getElementById('inputAvatar').value.trim();
      if (!avatarUrl) { showToast('Upload an avatar or paste a URL'); return; }
      const data = {
        name: document.getElementById('inputName').value.trim(),
        avatar_url: avatarUrl,
        triggers: document.getElementById('inputTriggers').value.split(',').map(t => t.trim()).filter(Boolean),
        human_name: document.getElementById('inputHumanName').value.trim() || undefined,
        human_info: document.getElementById('inputHumanInfo').value.trim() || undefined,
        owner_id: currentUser.id,
      };
      try {
        const url = editId ? API+'/companions/'+editId : API+'/companions';
        const res = await fetch(url, { method: editId?'PUT':'POST', headers: getHeaders(), body: JSON.stringify(data) });
        if (res.status === 401) { showToast('Please login first'); return; }
        if (!res.ok) { const err = await res.json(); showToast(err.error || 'Error'); return; }
        closeModal();
        showToast(editId ? 'Companion updated!' : 'Companion registered!');
        loadMyCompanion();
      } catch(e) { showToast('Failed'); }
    }

    async function handleDelete() { await handleDeleteCompanion(); closeModal(); }

    async function handleDeleteCompanion() {
      if (!myCompanion || !confirm('Delete ' + myCompanion.name + '? This cannot be undone.')) return;
      try {
        const res = await fetch(API+'/companions/'+myCompanion.id, { method:'DELETE', headers: getHeaders() });
        if (!res.ok) { showToast('Failed to delete'); return; }
        myCompanion = null;
        renderView();
        showToast('Companion deleted');
      } catch(e) { showToast('Failed'); }
    }

    function previewAvatar(url) {
      const img = document.getElementById('avatarPreview');
      if (url) { img.src = url; img.onerror = () => { img.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; }; }
    }
    function toggleUrlInput() { document.getElementById('urlInputRow').classList.toggle('hidden'); }

    document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); closeCropper(); } });
    document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });

    checkAuth();
  </script>
</body>
</html>`;
}
