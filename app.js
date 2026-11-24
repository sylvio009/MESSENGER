// ==========================================
// CONFIGURATION SUPABASE (À REMPLIR)
// ==========================================
const SUPABASE_URL = 'VOTRE_URL_SUPABASE';
const SUPABASE_ANON_KEY = 'VOTRE_CLE_ANON_SUPABASE';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ==========================================
// ÉTAT GLOBAL DE L'APPLICATION
// ==========================================
let authMode = 'login'; // 'login' ou 'register'
let currentUser = null;
let selectedContact = null;
let allUsersCache = [];

// ==========================================
// GESTION DE L'AUTHENTIFICATION
// ==========================================
function switchAuthTab(mode) {
    authMode = mode;
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const submitBtn = document.getElementById('auth-submit-btn');
    hideAlert();

    if (mode === 'login') {
        tabLogin.className = 'flex-1 py-2 font-semibold text-indigo-600 border-b-2 border-indigo-600';
        tabRegister.className = 'flex-1 py-2 font-semibold text-slate-400 hover:text-slate-600';
        submitBtn.textContent = 'Se connecter';
    } else {
        tabRegister.className = 'flex-1 py-2 font-semibold text-indigo-600 border-b-2 border-indigo-600';
        tabLogin.className = 'flex-1 py-2 font-semibold text-slate-400 hover:text-slate-600';
        submitBtn.textContent = 'Créer mon compte';
    }
}

function showAlert(message, isError = true) {
    const alertBox = document.getElementById('auth-alert');
    alertBox.textContent = message;
    alertBox.className = `p-3 rounded-lg text-sm ${isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`;
    alertBox.classList.remove('hidden');
}

function hideAlert() {
    document.getElementById('auth-alert').classList.add('hidden');
}

async function handleAuth(e) {
    e.preventDefault();
    hideAlert();
    const username = document.getElementById('auth-username').value.trim().toLowerCase();
    const password = document.getElementById('auth-password').value;

    if (authMode === 'register') {
        // Vérifier si l'utilisateur existe déjà
        const { data: existing } = await db.from('users').select('id').eq('username', username).maybeSingle();
        if (existing) {
            return showAlert("Ce nom d'utilisateur est déjà pris.");
        }

        // Créer le compte (is_approved = false par défaut)
        const { error } = await db.from('users').insert([{ username, password, role: 'user', is_approved: false }]);
        if (error) return showAlert("Erreur lors de la création du compte.");

        showAlert("Compte créé avec succès ! En attente de validation par l'administrateur.", false);
        document.getElementById('auth-form').reset();
        switchAuthTab('login');
    } else {
        // Connexion
        const { data: user, error } = await db.from('users')
            .select('*')
            .eq('username', username)
            .eq('password', password)
            .maybeSingle();

        if (error || !user) {
            return showAlert("Identifiants incorrects.");
        }

        if (!user.is_approved) {
            return showAlert("Votre compte n'a pas encore été autorisé par l'administrateur.");
        }

        // Connexion réussie
        currentUser = user;
        localStorage.setItem('chat_session', JSON.stringify(user));
        initApp();
    }
}

function logout() {
    currentUser = null;
    selectedContact = null;
    localStorage.removeItem('chat_session');
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('auth-form').reset();
}

// ==========================================
// INITIALISATION DE L'ESPACE DE TRAVAIL
// ==========================================
async function initApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-screen').classList.remove('hidden');
    document.getElementById('current-user-badge').textContent = `@${currentUser.username} (${currentUser.role})`;

    if (currentUser.role === 'admin') {
        document.getElementById('btn-admin-panel').classList.remove('hidden');
    } else {
        document.getElementById('btn-admin-panel').classList.add('hidden');
    }

    await loadUsers();
    setupRealtime();
}

async function loadUsers() {
    const { data: users } = await db.from('users').select('*').order('username', { ascending: true });
    allUsersCache = users || [];

    const usersListEl = document.getElementById('users-list');
    usersListEl.innerHTML = '';

    // Afficher uniquement les utilisateurs autorisés (hors soi-même)
    const approvedContacts = allUsersCache.filter(u => u.is_approved && u.id !== currentUser.id);

    if (approvedContacts.length === 0) {
        usersListEl.innerHTML = `<p class="p-4 text-sm text-slate-400">Aucun autre utilisateur autorisé pour le moment.</p>`;
    } else {
        approvedContacts.forEach(user => {
            const isSelected = selectedContact && selectedContact.id === user.id;
            const btn = document.createElement('button');
            btn.className = `w-full text-left px-4 py-3 flex items-center justify-between hover:bg-slate-50 transition ${isSelected ? 'bg-indigo-50 border-r-4 border-indigo-600' : ''}`;
            btn.onclick = () => selectContact(user);
            btn.innerHTML = `
                <span class="font-medium text-slate-700">@${user.username}</span>
                ${user.role === 'admin' ? '<span class="text-[10px] bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold">ADMIN</span>' : ''}
            `;
            usersListEl.appendChild(btn);
        });
    }

    if (currentUser.role === 'admin') {
        renderAdminUsers();
    }
}

// ==========================================
// MESSAGERIE INSTANTANÉE
// ==========================================
async function selectContact(user) {
    selectedContact = user;
    document.getElementById('chat-header').textContent = `Discussion avec @${user.username}`;
    document.getElementById('message-form').classList.remove('hidden');
    loadUsers(); // Mettre à jour la surbrillance
    await loadMessages();
}

async function loadMessages() {
    if (!selectedContact) return;

    const { data: messages } = await db.from('messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedContact.id}),and(sender_id.eq.${selectedContact.id},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    const container = document.getElementById('messages-container');
    container.innerHTML = '';

    (messages || []).forEach(msg => {
        const isMine = msg.sender_id === currentUser.id;
        const div = document.createElement('div');
        div.className = `flex ${isMine ? 'justify-end' : 'justify-start'}`;
        div.innerHTML = `
            <div class="max-w-md px-4 py-2.5 rounded-2xl shadow-sm text-sm ${isMine ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-white text-slate-800 border border-slate-200 rounded-bl-none'}">
                <p>${escapeHTML(msg.content)}</p>
                <span class="block text-[10px] mt-1 opacity-70 text-right">
                    ${new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
            </div>
        `;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

async function sendMessage(e) {
    e.preventDefault();
    if (!selectedContact) return;

    const input = document.getElementById('message-input');
    const content = input.value.trim();
    if (!content) return;

    input.value = '';
    await db.from('messages').insert([{
        sender_id: currentUser.id,
        receiver_id: selectedContact.id,
        content: content
    }]);

    await loadMessages();
}

// ==========================================
// SUPERVISION ADMINISTRATEUR
// ==========================================
function toggleAdminModal(show) {
    const modal = document.getElementById('admin-modal');
    if (show) {
        modal.classList.remove('hidden');
        renderAdminUsers();
        loadAllMessagesForAdmin();
    } else {
        modal.classList.add('hidden');
    }
}

function renderAdminUsers() {
    const tbody = document.getElementById('admin-users-table');
    tbody.innerHTML = '';

    allUsersCache.forEach(user => {
        if (user.username === 'admin') return; // Protéger le compte admin principal

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-3 font-medium">@${user.username}</td>
            <td class="p-3">
                ${user.is_approved 
                    ? '<span class="bg-emerald-100 text-emerald-700 px-2 py-1 rounded text-xs font-semibold">Autorisé</span>' 
                    : '<span class="bg-amber-100 text-amber-700 px-2 py-1 rounded text-xs font-semibold">En attente / Bloqué</span>'}
            </td>
            <td class="p-3 text-right space-x-2">
                <button onclick="toggleUserApproval('${user.id}', ${!user.is_approved})" class="px-3 py-1 rounded text-xs font-semibold text-white ${user.is_approved ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'}">
                    ${user.is_approved ? 'Bloquer' : 'Autoriser'}
                </button>
                <button onclick="deleteUser('${user.id}')" class="px-3 py-1 rounded text-xs font-semibold bg-red-600 hover:bg-red-700 text-white">
                    Supprimer
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleUserApproval(userId, newStatus) {
    await db.from('users').update({ is_approved: newStatus }).eq('id', userId);
    await loadUsers();
}

async function deleteUser(userId) {
    if (!confirm("Supprimer définitivement cet utilisateur et tous ses messages ?")) return;
    await db.from('users').delete().eq('id', userId);
    if (selectedContact && selectedContact.id === userId) {
        selectedContact = null;
        document.getElementById('chat-header').textContent = 'Sélectionnez un utilisateur';
        document.getElementById('message-form').classList.add('hidden');
        document.getElementById('messages-container').innerHTML = '';
    }
    await loadUsers();
    await loadAllMessagesForAdmin();
}

async function loadAllMessagesForAdmin() {
    const { data: messages } = await db.from('messages').select('*').order('created_at', { ascending: false }).limit(100);
    const tbody = document.getElementById('admin-messages-table');
    tbody.innerHTML = '';

    const getUsername = (id) => {
        const u = allUsersCache.find(user => user.id === id);
        return u ? `@${u.username}` : 'Inconnu';
    };

    (messages || []).forEach(msg => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td class="p-3 font-medium text-indigo-600">${getUsername(msg.sender_id)}</td>
            <td class="p-3 font-medium text-slate-700">${getUsername(msg.receiver_id)}</td>
            <td class="p-3 text-slate-600">${escapeHTML(msg.content)}</td>
            <td class="p-3 text-xs text-slate-400">${new Date(msg.created_at).toLocaleString()}</td>
        `;
        tbody.appendChild(tr);
    });
}

// ==========================================
// TEMPS RÉEL & UTILITAIRES
// ==========================================
function setupRealtime() {
    db.channel('public-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
            if (selectedContact) loadMessages();
            if (currentUser && currentUser.role === 'admin') loadAllMessagesForAdmin();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, async () => {
            await loadUsers();
            // Vérifier si l'utilisateur courant a été bloqué ou supprimé en direct
            const me = allUsersCache.find(u => u.id === currentUser.id);
            if (!me || !me.is_approved) {
                alert("Votre accès a été révoqué par l'administrateur.");
                logout();
            }
        })
        .subscribe();
}

function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&', '<': '<', '>': '>', "'": ''', '"': '"'
    }[tag]));
}

// Restauration de session au rechargement de la page
window.onload = async () => {
    const saved = localStorage.getItem('chat_session');
    if (saved) {
        const parsed = JSON.parse(saved);
        const { data: freshUser } = await db.from('users').select('*').eq('id', parsed.id).maybeSingle();
        if (freshUser && freshUser.is_approved) {
            currentUser = freshUser;
            initApp();
        } else {
            localStorage.removeItem('chat_session');
        }
    }
};
