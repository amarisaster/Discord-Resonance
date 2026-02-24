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
  <div class="bg-discord-dark/50 border-b border-gray-700/30 px-6 py-2">
    <div class="max-w-6xl mx-auto flex items-center gap-6 text-sm text-gray-400">
      <span id="companionCount">-- companions</span>
      <span id="pendingCount">-- pending</span>
      <span id="channelCount">-- channels watched</span>
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
  <div id="modal" class="fixed inset-0 bg-black/60 modal-backdrop hidden z-50 flex items-center justify-center p-4">
    <div class="bg-discord-card rounded-xl shadow-2xl w-full max-w-lg border border-gray-700/50">
      <div class="flex items-center justify-between px-6 py-4 border-b border-gray-700/50">
        <h2 id="modalTitle" class="text-lg font-semibold">Register Companion</h2>
        <button onclick="closeModal()" class="text-gray-400 hover:text-white transition-colors">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>

      <form id="companionForm" onsubmit="handleSubmit(event)" class="p-6 space-y-4">
        <input type="hidden" id="editId" value="">

        <!-- Avatar Preview -->
        <div class="flex justify-center">
          <div class="relative">
            <img id="avatarPreview" src="https://cdn.discordapp.com/embed/avatars/0.png" class="w-20 h-20 rounded-full object-cover border-2 border-gray-600 avatar-preview" alt="Avatar preview">
          </div>
        </div>

        <!-- Name -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Companion Name *</label>
          <input type="text" id="inputName" required placeholder="e.g. Kai Stryder"
            class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord">
        </div>

        <!-- Avatar URL -->
        <div>
          <label class="block text-sm font-medium text-gray-300 mb-1">Avatar URL *</label>
          <input type="url" id="inputAvatar" required placeholder="https://..."
            class="w-full bg-discord-input border border-gray-600 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-discord"
            oninput="previewAvatar(this.value)">
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
        document.getElementById('channelCount').textContent = status.watch_channels.length + ' channels watched';
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
            <img src="\${c.avatar_url}" alt="\${c.name}" class="w-14 h-14 rounded-full object-cover border-2 border-gray-600 flex-shrink-0"
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
      document.getElementById('avatarPreview').src = 'https://cdn.discordapp.com/embed/avatars/0.png';
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

    function previewAvatar(url) {
      const img = document.getElementById('avatarPreview');
      if (url) {
        img.src = url;
        img.onerror = () => { img.src = 'https://cdn.discordapp.com/embed/avatars/0.png'; };
      }
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
      const data = {
        name: document.getElementById('inputName').value.trim(),
        avatar_url: document.getElementById('inputAvatar').value.trim(),
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
