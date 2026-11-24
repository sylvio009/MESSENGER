// --- CONFIGURATION SUPABASE ---
const SUPABASE_URL = 'https://wdcokszrkkppgyubmchd.supabase.co/rest/v1/';
const SUPABASE_KEY = 'sb_publishable_v6JCYag-YsJGjQuZwaRWIg_43-qK38D';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// --- ÉTAT GLOBAL ---
let authMode = 'login'; // 'login' ou 'register'
let currentUser = null;
let selectedContact = null;


// --- GESTION DE L'AUTHENTIFICATION ---
function switchAuthTab(mode) {
  authMode = mode;
  const tabLogin = document.getElementById('tab-login');
  const tabRegister = document.getElementById('tab-register');
  const submitBtn = document.getElementById('auth-submit-btn');
  hideAuthMessage();

  if (mode === 'login') {
    tabLogin.className = 'w-1/2 pb-3 font-semibold border-b-2 border-indigo-600 text-indigo-600';
    tabRegister.className = 'w-1/2 pb-3 font-semibold text-slate-400';
    submitBtn.textContent = 'Se connecter';
  } else {
    tabRegister.className = 'w-1/2 pb-3 font-semibold border-b-2 border-indigo-600 text-indigo-600';
    tabLogin.className = 'w-1/2 pb-3 font-semibold text-slate-400';
    submitBtn.textContent = 'Créer le compte';
  }
}

function showAuthMessage(text, isError = true) {
  const msgBox = document.getElementById('auth-message');
  msgBox.textContent = text;
  msgBox.className = `text-sm font-medium p-3 rounded ${isError ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`;
  msgBox.classList.remove('hidden');
}

function hideAuthMessage() {
  document.getElementById('auth-message').classList.add('hidden');
}

async function handleAuth(e) {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim().toLowerCase();
  const password = document.getElementById('auth-password').value.trim();

  if (authMode === 'register') {
    const { data: existing } = await supabaseClient
      .from('users')
      .select('id')
      .eq('username', username)
      .single();

    if (existing) {
      return showAuthMessage("Ce nom d'utilisateur est déjà pris.");
    }

    const { error } = await supabaseClient
      .from('users')
      .insert([{ username, password, role: 'user', is_approved: false }]);

    if (error) return showAuthMessage("Erreur lors de la création du compte.");

    showAuthMessage("Compte créé ! En attente d'autorisation par l'administrateur.", false);
    document.getElementById('auth-form').reset();
  } else {
    const { data: user, error } = await supabaseClient
      .from('users')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (error || !user) {
      return showAuthMessage("Identifiants incorrects.");
    }

    if (!user.is_approved && user.role !== 'admin') {
      return showAuthMessage("Votre compte n'a pas encore été autorisé par l'administrateur.");
    }

    currentUser = user;
    initSession();
  }
}

function logout() {
  currentUser = null;
  selectedContact = null;
  document.getElementById('nav-user-info').classList.add('hidden');
  document.getElementById('user-dashboard').classList.add('hidden');
  document.getElementById('admin-dashboard').classList.add('hidden');
  document.getElementById('auth-section').classList.remove('hidden');
  document.getElementById('auth-form').reset();
  hideAuthMessage();
}

// --- INITIALISATION DES SESSIONS ---
function initSession() {
  document.getElementById('auth-section').classList.add('hidden');
  document.getElementById('nav-user-info').classList.remove('hidden');
  document.getElementById('current-user-badge').textContent = `${currentUser.username} (${currentUser.role})`;

  if (currentUser.role === 'admin') {
    document.getElementById('admin-dashboard').classList.remove('hidden');
    loadAdminData();
    subscribeRealtimeAdmin();
  } else {
    document.getElementById('user-dashboard').classList.remove('hidden');
    loadContacts();
    subscribeRealtimeUser();
  }
}

// --- LOGIQUE UTILISATEUR ---
async function loadContacts() {
  const { data: users } = await supabaseClient
    .from('users')
    .select('username')
    .eq('is_approved', true)
    .neq('username', currentUser.username)
    .neq('role', 'admin');

  const list = document.getElementById('contacts-list');
  list.innerHTML = '';

  if (!users || users.length === 0) {
    list.innerHTML = `<li class="p-4 text-sm text-slate-400">Aucun autre utilisateur autorisé.</li>`;
    return;
  }

  users.forEach(u => {
    const li = document.createElement('li');
    li.className = `p-4 cursor-pointer hover:bg-indigo-50 transition font-medium ${selectedContact === u.username ? 'bg-indigo-100 text-indigo-700' : ''}`;
    li.textContent = u.username;
    li.onclick = () => selectContact(u.username);
    list.appendChild(li);
  });
}

function selectContact(username) {
  selectedContact = username;
  document.getElementById('chat-header').textContent = `Discussion avec ${username}`;
  document.getElementById('message-form').classList.remove('hidden');
  loadContacts();
  loadMessages();
}

async function loadMessages() {
  if (!selectedContact) return;

  const { data: messages } = await supabaseClient
    .from('messages')
    .select('*')
    .or(`and(sender.eq.${currentUser.username},receiver.eq.${selectedContact}),and(sender.eq.${selectedContact},receiver.eq.${currentUser.username})`)
    .order('created_at', { ascending: true });

  const container = document.getElementById('messages-container');
  container.innerHTML = '';

  messages.forEach(msg => {
    const isMe = msg.sender === currentUser.username;
    const div = document.createElement('div');
    div.className = `flex flex-col max-w-xs md:max-w-md p-3 rounded-lg text-sm ${isMe ? 'bg-indigo-600 text-white self-end ml-auto' : 'bg-white border text-slate-800 self-start'}`;
    div.innerHTML = `
      <span>${msg.content}</span>
      <span class="text-[10px] mt-1 opacity-75 text-right">${new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
    `;
    container.appendChild(div);
  });

  container.scrollTop = container.scrollHeight;
}

async function sendMessage(e) {
  e.preventDefault();
  const input = document.getElementById('message-input');
  const content = input.value.trim();
  if (!content || !selectedContact) return;

  input.value = '';
  await supabaseClient.from('messages').insert([{
    sender: currentUser.username,
    receiver: selectedContact,
    content
  }]);
}

function subscribeRealtimeUser() {
  supabaseClient
    .channel('user-updates')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => {
      if (selectedContact) loadMessages();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, (payload) => {
      // Déconnecte immédiatement l'utilisateur si l'admin révoque son accès
      if (payload.new && payload.new.id === currentUser.id && !payload.new.is_approved) {
        alert("Votre accès a été révoqué par l'administrateur.");
        logout();
      } else {
        loadContacts();
      }
    })
    .subscribe();
}

// --- LOGIQUE ADMINISTRATEUR ---
async function loadAdminData() {
  // Charger tous les utilisateurs (sauf admin)
  const { data: users } = await supabaseClient
    .from('users')
    .select('*')
    .neq('role', 'admin')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('admin-users-table');
  tbody.innerHTML = '';

  users.forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="p-3 font-medium">${u.username}</td>
      <td class="p-3 text-slate-500">${u.password}</td>
      <td class="p-3">
        <span class="px-2 py-1 rounded-full text-xs font-semibold ${u.is_approved ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}">
          ${u.is_approved ? 'Autorisé' : 'En attente'}
        </span>
      </td>
      <td class="p-3 space-x-2">
        <button onclick="toggleUserApproval('${u.id}', ${!u.is_approved})" class="px-3 py-1 rounded text-white text-xs font-medium ${u.is_approved ? 'bg-amber-500 hover:bg-amber-600' : 'bg-green-600 hover:bg-green-700'}">
          ${u.is_approved ? 'Bloquer' : 'Autoriser'}
        </button>
        <button onclick="deleteUser('${u.id}', '${u.username}')" class="px-3 py-1 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-medium">
          Supprimer
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // Charger tous les messages
  const { data: messages } = await supabaseClient
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  const feed = document.getElementById('admin-messages-feed');
  feed.innerHTML = '';

  if (!messages || messages.length === 0) {
    feed.innerHTML = `<p class="text-slate-400">Aucun message échangé pour le moment.</p>`;
    return;
  }

  messages.forEach(m => {
    const div = document.createElement('div');
    div.className = 'p-2 bg-white rounded border flex justify-between items-center';
    div.innerHTML = `
      <div>
        <span class="font-bold text-indigo-600">${m.sender}</span> 
        <span class="text-slate-400">→</span> 
        <span class="font-bold text-emerald-600">${m.receiver}</span> : 
        <span class="text-slate-700">${m.content}</span>
      </div>
      <span class="text-xs text-slate-400">${new Date(m.created_at).toLocaleString()}</span>
    `;
    feed.appendChild(div);
  });
}

async function toggleUserApproval(userId, status) {
  await supabaseClient.from('users').update({ is_approved: status }).eq('id', userId);
  loadAdminData();
}

async function deleteUser(userId, username) {
  if (!confirm(`Supprimer définitivement ${username} et ses messages ?`)) return;
  await supabaseClient.from('messages').delete().or(`sender.eq.${username},receiver.eq.${username}`);
  await supabaseClient.from('users').delete().eq('id', userId);
  loadAdminData();
}

function subscribeRealtimeAdmin() {
  supabaseClient
    .channel('admin-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => loadAdminData())
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => loadAdminData())
    .subscribe();
}
