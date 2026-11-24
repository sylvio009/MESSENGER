// ============================================================================
// CONFIGURATION SUPABASE (À REMPLACER PAR VOS CLÉS DE PROJET SUPABASE)
// ============================================================================
const SUPABASE_URL = "https://wdcokszrkkppgyubmchd.supabase.co/rest/v1/";
const SUPABASE_ANON_KEY = "sb_publishable_v6JCYag-YsJGjQuZwaRWIg_43-qK38D";

let db = null;
if (SUPABASE_URL.startsWith("http") && SUPABASE_ANON_KEY.length > 20) {
    db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// État global
let currentUser = null;
let authMode = "login"; // "login" | "register"
let approvedUsers = [];
let selectedPartner = null;
let pollInterval = null;
let statusCheckInterval = null;
let realtimeChannel = null;

const el = (id) => document.getElementById(id);

// ============================================================================
// UTILITAIRES : PROTECTION XSS, HACHAGE SHA-256 & DATES
// ============================================================================
function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&")
        .replace(/</g, "<")
        .replace(/>/g, ">")
        .replace(/"/g, """)
        .replace(/'/g, "'");
}

async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function formatTime(isoString) {
    const d = new Date(isoString);
    return d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function showAuthFeedback(message, type = "error") {
    const box = el("auth-feedback");
    box.textContent = message;
    box.className = `alert alert-${type}`;
    box.classList.remove("hidden");
}

function hideAuthFeedback() {
    el("auth-feedback").classList.add("hidden");
}

// ============================================================================
// GESTION DES VUES & DE LA SESSION
// ============================================================================
function switchMainView(viewName) {
    el("auth-view").classList.add("hidden");
    el("status-view").classList.add("hidden");
    el("app-view").classList.add("hidden");
    el(viewName).classList.remove("hidden");
}

function saveSession(user) {
    currentUser = user;
    sessionStorage.setItem("msg_app_user", JSON.stringify(user));
}

function clearSession() {
    currentUser = null;
    selectedPartner = null;
    sessionStorage.removeItem("msg_app_user");
    if (pollInterval) clearInterval(pollInterval);
    if (statusCheckInterval) clearInterval(statusCheckInterval);
    if (realtimeChannel && db) {
        db.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
}

async function checkUserStatusFromDB() {
    if (!currentUser || !db) return;
    const { data, error } = await db
        .from("app_users")
        .select("id, username, role, status")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (error || !data) {
        clearSession();
        switchMainView("auth-view");
        showAuthFeedback("Ce compte n'existe plus.");
        return;
    }

    if (data.status !== currentUser.status || data.role !== currentUser.role) {
        await handleRouteByUserStatus(data);
    }
}

async function handleRouteByUserStatus(user) {
    saveSession(user);
    if (statusCheckInterval) clearInterval(statusCheckInterval);

    if (user.status === "pending") {
        el("status-badge").textContent = "En attente d'autorisation";
        el("status-badge").className = "badge badge-pending";
        el("status-title").textContent = `Bienvenue, ${user.username}`;
        el("status-desc").textContent =
            "Votre compte est créé mais doit encore être autorisé par l'administrateur avant d'accéder à la messagerie.";
        switchMainView("status-view");
        statusCheckInterval = setInterval(checkUserStatusFromDB, 3000);
        return;
    }

    if (user.status === "blocked") {
        el("status-badge").textContent = "Accès refusé / bloqué";
        el("status-badge").className = "badge badge-blocked";
        el("status-title").textContent = "Compte non autorisé";
        el("status-desc").textContent =
            "L'administrateur a refusé ou suspendu l'accès de ce compte.";
        switchMainView("status-view");
        return;
    }

    // Statut === 'approved'
    el("current-user-label").textContent =
        user.role === "admin" ? `@${user.username} (Admin)` : `@${user.username}`;

    if (user.role === "admin") {
        el("nav-admin-btn").classList.remove("hidden");
    } else {
        el("nav-admin-btn").classList.add("hidden");
    }

    switchMainView("app-view");
    showChatTab();
    await refreshAllData();
    setupRealtimeAndPolling();
}

// ============================================================================
// AUTHENTIFICATION (CONNEXION & CRÉATION DE COMPTE)
// ============================================================================
el("tab-login").addEventListener("click", () => {
    authMode = "login";
    el("tab-login").classList.add("active");
    el("tab-register").classList.remove("active");
    el("auth-submit-btn").textContent = "Se connecter";
    hideAuthFeedback();
});

el("tab-register").addEventListener("click", () => {
    authMode = "register";
    el("tab-register").classList.add("active");
    el("tab-login").classList.remove("active");
    el("auth-submit-btn").textContent = "Créer mon compte";
    hideAuthFeedback();
});

el("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    hideAuthFeedback();

    if (!db) {
        showAuthFeedback(
            "Configuration manquante : renseignez SUPABASE_URL et SUPABASE_ANON_KEY dans app.js.",
            "warning"
        );
        return;
    }

    const username = el("auth-username").value.trim().toLowerCase();
    const password = el("auth-password").value;

    if (!/^[a-z0-9_.-]{3,30}$/.test(username)) {
        showAuthFeedback(
            "Le nom d'utilisateur doit contenir 3 à 30 caractères (lettres, chiffres, _, ., -)."
        );
        return;
    }

    const submitBtn = el("auth-submit-btn");
    submitBtn.disabled = true;

    try {
        const passwordHash = await hashPassword(password);

        if (authMode === "register") {
            const { data: existing, error: checkErr } = await db
                .from("app_users")
                .select("id")
                .eq("username", username)
                .maybeSingle();

            if (checkErr) throw checkErr;
            if (existing) {
                showAuthFeedback("Ce nom d'utilisateur est déjà utilisé.");
                return;
            }

            const { data: created, error: insertErr } = await db
                .from("app_users")
                .insert([
                    {
                        username,
                        password_hash: passwordHash,
                        role: "user",
                        status: "pending"
                    }
                ])
                .select("id, username, role, status")
                .single();

            if (insertErr) throw insertErr;

            el("auth-form").reset();
            await handleRouteByUserStatus(created);
        } else {
            const { data: user, error: loginErr } = await db
                .from("app_users")
                .select("id, username, password_hash, role, status")
                .eq("username", username)
                .maybeSingle();

            if (loginErr) throw loginErr;

            if (!user || user.password_hash !== passwordHash) {
                showAuthFeedback("Nom d'utilisateur ou mot de passe incorrect.");
                return;
            }

            el("auth-form").reset();
            await handleRouteByUserStatus({
                id: user.id,
                username: user.username,
                role: user.role,
                status: user.status
            });
        }
    } catch (err) {
        console.error(err);
        showAuthFeedback("Erreur serveur : " + (err.message || "Veuillez réessayer."));
    } finally {
        submitBtn.disabled = false;
    }
});

el("btn-refresh-status").addEventListener("click", checkUserStatusFromDB);

el("btn-status-logout").addEventListener("click", () => {
    clearSession();
    switchMainView("auth-view");
});

el("btn-logout").addEventListener("click", () => {
    clearSession();
    switchMainView("auth-view");
});

// ============================================================================
// NAVIGATION INTERNE (DISCUSSIONS vs SUPERVISION ADMIN)
// ============================================================================
function showChatTab() {
    el("chat-section").classList.remove("hidden");
    el("admin-section").classList.add("hidden");
    el("nav-chat-btn").className = "btn btn-primary btn-sm";
    el("nav-admin-btn").className =
        "btn btn-secondary btn-sm" + (currentUser?.role === "admin" ? "" : " hidden");
}

function showAdminTab() {
    if (currentUser?.role !== "admin") return;
    el("chat-section").classList.add("hidden");
    el("admin-section").classList.remove("hidden");
    el("nav-admin-btn").className = "btn btn-primary btn-sm";
    el("nav-chat-btn").className = "btn btn-secondary btn-sm";
    loadAdminSupervision();
}

el("nav-chat-btn").addEventListener("click", showChatTab);
el("nav-admin-btn").addEventListener("click", showAdminTab);

// ============================================================================
// MESSAGERIE : UTILISATEURS AUTORISÉS & CONVERSATIONS
// ============================================================================
async function loadApprovedUsers() {
    if (!currentUser || !db) return;
    const { data, error } = await db
        .from("app_users")
        .select("id, username, role, status")
        .eq("status", "approved")
        .neq("id", currentUser.id)
        .order("username", { ascending: true });

    if (error) {
        console.error("Erreur chargement contacts:", error);
        return;
    }

    approvedUsers = data || [];
    renderUsersList();
}

function renderUsersList() {
    const query = el("search-users-input").value.trim().toLowerCase();
    const container = el("users-list");
    const filtered = approvedUsers.filter((u) => u.username.includes(query));

    if (filtered.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; padding: 1rem; text-align: center;">Aucun autre utilisateur autorisé pour le moment.</p>`;
        return;
    }

    container.innerHTML = filtered
        .map((u) => {
            const isActive = selectedPartner && selectedPartner.id === u.id;
            const initial = escapeHtml(u.username.charAt(0).toUpperCase());
            const roleTag = u.role === "admin" ? `<span class="badge badge-admin">Admin</span>` : "";
            return `
                <div class="user-item ${isActive ? "active" : ""}" data-uid="${escapeHtml(u.id)}">
                    <div class="user-meta">
                        <div class="user-avatar">${initial}</div>
                        <strong>@${escapeHtml(u.username)}</strong>
                    </div>
                    ${roleTag}
                </div>
            `;
        })
        .join("");

    container.querySelectorAll(".user-item").forEach((item) => {
        item.addEventListener("click", () => {
            const uid = item.getAttribute("data-uid");
            const partner = approvedUsers.find((u) => u.id === uid);
            if (partner) selectConversation(partner);
        });
    });
}

el("search-users-input").addEventListener("input", renderUsersList);

async function selectConversation(partner) {
    selectedPartner = partner;
    renderUsersList();

    el("chat-empty-state").classList.add("hidden");
    el("chat-active-area").classList.remove("hidden");
    el("chat-partner-name").textContent = `@${partner.username}`;

    if (partner.role === "admin") {
        el("chat-partner-role").textContent = "Administrateur";
        el("chat-partner-role").classList.remove("hidden");
    } else {
        el("chat-partner-role").classList.add("hidden");
    }

    await loadConversationMessages();
    el("message-input").focus();
}

async function loadConversationMessages() {
    if (!currentUser || !selectedPartner || !db) return;

    const myId = currentUser.id;
    const otherId = selectedPartner.id;

    const { data, error } = await db
        .from("app_messages")
        .select("id, sender_id, receiver_id, content, created_at")
        .or(`and(sender_id.eq.${myId},receiver_id.eq.${otherId}),and(sender_id.eq.${otherId},receiver_id.eq.${myId})`)
        .order("created_at", { ascending: true });

    if (error) {
        console.error("Erreur chargement messages:", error);
        return;
    }

    const box = el("messages-container");
    const wasAtBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;

    if (!data || data.length === 0) {
        box.innerHTML = `<p style="color: var(--text-muted); text-align: center; margin: auto;">Aucun message. Envoyez le premier !</p>`;
        return;
    }

    box.innerHTML = data
        .map((m) => {
            const isMine = m.sender_id === myId;
            return `
                <div class="msg-bubble ${isMine ? "msg-sent" : "msg-received"}">
                    <div>${escapeHtml(m.content)}</div>
                    <span class="msg-time">${formatTime(m.created_at)}</span>
                </div>
            `;
        })
        .join("");

    if (wasAtBottom) {
        box.scrollTop = box.scrollHeight;
    }
}

el("message-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!currentUser || !selectedPartner || !db) return;

    const input = el("message-input");
    const content = input.value.trim();
    if (!content) return;

    input.value = "";
    const { error } = await db.from("app_messages").insert([
        {
            sender_id: currentUser.id,
            receiver_id: selectedPartner.id,
            content
        }
    ]);

    if (error) {
        alert("Impossible d'envoyer le message : " + error.message);
        input.value = content;
        return;
    }

    await loadConversationMessages();
    const box = el("messages-container");
    box.scrollTop = box.scrollHeight;
});

// ============================================================================
// SUPERVISION ADMINISTRATEUR (COMPTES & TOUS LES MESSAGES DU SITE)
// ============================================================================
async function loadAdminSupervision() {
    if (!currentUser || currentUser.role !== "admin" || !db) return;

    const { data: users, error: usersErr } = await db
        .from("app_users")
        .select("id, username, role, status, created_at")
        .order("created_at", { ascending: false });

    const usersMap = new Map();

    if (!usersErr && users) {
        users.forEach((u) => usersMap.set(u.id, u.username));
        const pendingCount = users.filter((u) => u.status === "pending").length;

        el("stat-total-users").textContent = users.length;
        el("stat-pending-users").textContent = pendingCount;

        const badge = el("pending-count-badge");
        if (pendingCount > 0) {
            badge.textContent = pendingCount;
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }

        renderAdminUsersList(users);
    }

    const { data: messages, error: msgErr } = await db
        .from("app_messages")
        .select("id, sender_id, receiver_id, content, created_at")
        .order("created_at", { ascending: false })
        .limit(200);

    if (!msgErr && messages) {
        el("stat-total-messages").textContent = messages.length;
        renderAdminMessagesList(messages, usersMap);
    }
}

function renderAdminUsersList(users) {
    const container = el("admin-users-list");
    const nonAdminUsers = users.filter((u) => u.role !== "admin");

    if (nonAdminUsers.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Aucun utilisateur inscrit pour le moment.</p>`;
        return;
    }

    container.innerHTML = nonAdminUsers
        .map((u) => {
            let statusBadge = `<span class="badge badge-pending">En attente</span>`;
            if (u.status === "approved") statusBadge = `<span class="badge badge-approved">Autorisé</span>`;
            if (u.status === "blocked") statusBadge = `<span class="badge badge-blocked">Bloqué</span>`;

            return `
                <div class="admin-row">
                    <div>
                        <strong>@${escapeHtml(u.username)}</strong> ${statusBadge}
                        <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 0.25rem;">
                            Inscrit le ${formatTime(u.created_at)}
                        </div>
                    </div>
                    <div class="admin-actions">
                        ${u.status !== "approved" ? `<button class="btn btn-success btn-sm" onclick="adminSetUserStatus('${escapeHtml(u.id)}', 'approved')">Autoriser</button>` : ""}
                        ${u.status !== "blocked" ? `<button class="btn btn-warning btn-sm" onclick="adminSetUserStatus('${escapeHtml(u.id)}', 'blocked')">Bloquer</button>` : ""}
                        <button class="btn btn-danger btn-sm" onclick="adminDeleteUser('${escapeHtml(u.id)}', '${escapeHtml(u.username)}')">Supprimer</button>
                    </div>
                </div>
            `;
        })
        .join("");
}

function renderAdminMessagesList(messages, usersMap) {
    const container = el("admin-messages-list");
    if (messages.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem;">Aucun message sur la plateforme.</p>`;
        return;
    }

    container.innerHTML = messages
        .map((m) => {
            const fromName = usersMap.has(m.sender_id) ? `@${escapeHtml(usersMap.get(m.sender_id))}` : "Inconnu";
            const toName = usersMap.has(m.receiver_id) ? `@${escapeHtml(usersMap.get(m.receiver_id))}` : "Inconnu";
            return `
                <div class="admin-row">
                    <div style="flex: 1; min-width: 200px;">
                        <div style="font-size: 0.8rem; color: #93c5fd; margin-bottom: 0.25rem;">
                            <strong>${fromName}</strong> → <strong>${toName}</strong>
                            <span style="color: var(--text-muted); margin-left: 0.5rem;">${formatTime(m.created_at)}</span>
                        </div>
                        <div style="font-size: 0.92rem;">${escapeHtml(m.content)}</div>
                    </div>
                    <button class="btn btn-danger btn-sm" onclick="adminDeleteMessage('${escapeHtml(m.id)}')">Supprimer</button>
                </div>
            `;
        })
        .join("");
}

window.adminSetUserStatus = async function (userId, newStatus) {
    if (!db || currentUser?.role !== "admin") return;
    const { error } = await db
        .from("app_users")
        .update({ status: newStatus })
        .eq("id", userId);

    if (error) {
        alert("Erreur mise à jour statut : " + error.message);
        return;
    }
    await refreshAllData();
};

window.adminDeleteUser = async function (userId, username) {
    if (!db || currentUser?.role !== "admin") return;
    if (!confirm(`Supprimer définitivement le compte @${username} et tous ses messages ?`)) return;

    const { error } = await db.from("app_users").delete().eq("id", userId);
    if (error) {
        alert("Erreur suppression utilisateur : " + error.message);
        return;
    }
    if (selectedPartner?.id === userId) {
        selectedPartner = null;
        el("chat-active-area").classList.add("hidden");
        el("chat-empty-state").classList.remove("hidden");
    }
    await refreshAllData();
};

window.adminDeleteMessage = async function (messageId) {
    if (!db || currentUser?.role !== "admin") return;
    const { error } = await db.from("app_messages").delete().eq("id", messageId);
    if (error) {
        alert("Erreur suppression message : " + error.message);
        return;
    }
    await refreshAllData();
};

// ============================================================================
// SYNCHRONISATION TEMPS RÉEL & VÉRIFICATION CONTINUE
// ============================================================================
async function refreshAllData() {
    if (!currentUser || !db) return;

    const { data: freshMe } = await db
        .from("app_users")
        .select("id, username, role, status")
        .eq("id", currentUser.id)
        .maybeSingle();

    if (!freshMe || freshMe.status !== "approved") {
        if (!freshMe) {
            clearSession();
            switchMainView("auth-view");
        } else {
            await handleRouteByUserStatus(freshMe);
        }
        return;
    }

    await loadApprovedUsers();
    if (selectedPartner) {
        await loadConversationMessages();
    }
    if (currentUser.role === "admin") {
        await loadAdminSupervision();
    }
}

function setupRealtimeAndPolling() {
    if (!db) return;

    if (realtimeChannel) {
        db.removeChannel(realtimeChannel);
    }

    realtimeChannel = db
        .channel("public-messaging-sync")
        .on("postgres_changes", { event: "*", schema: "public", table: "app_messages" }, () => {
            refreshAllData();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "app_users" }, () => {
            refreshAllData();
        })
        .subscribe();

    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(refreshAllData, 4000);
}

// ============================================================================
// DÉMARRAGE DE L'APPLICATION
// ============================================================================
window.addEventListener("DOMContentLoaded", async () => {
    if (!db) {
        showAuthFeedback(
            "Configurez SUPABASE_URL et SUPABASE_ANON_KEY en haut du fichier app.js avant d'utiliser le site.",
            "warning"
        );
        return;
    }

    const saved = sessionStorage.getItem("msg_app_user");
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            const { data: freshUser } = await db
                .from("app_users")
                .select("id, username, role, status")
                .eq("id", parsed.id)
                .maybeSingle();

            if (freshUser) {
                await handleRouteByUserStatus(freshUser);
                return;
            }
        } catch (e) {
            clearSession();
        }
    }
    switchMainView("auth-view");
});
