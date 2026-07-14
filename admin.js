"use strict";

const elements = {};

let adminClient = null;
let currentAdmin = null;

document.addEventListener(
  "DOMContentLoaded",
  initializeAdminPanel
);

async function initializeAdminPanel() {
  cacheElements();

  try {
    validateConfiguration();

    adminClient = createAdminClient();

    const session =
      await requireAdminSession();

    currentAdmin = session.user;

    const adminStatus =
      await loadAdminStatus();

    displayAdminData(
      currentAdmin,
      adminStatus
    );

    configureEvents();

    revealPanel();
  } catch (error) {
    console.error(
      "Acesso administrativo recusado:",
      error
    );

    await redirectToLogin();
  }
}

function cacheElements() {
  elements.loading =
    document.getElementById("admin-loading");

  elements.application =
    document.getElementById("admin-application");

  elements.adminName =
    document.getElementById("admin-name");

  elements.adminEmail =
    document.getElementById("admin-email");

  elements.logoutButton =
    document.getElementById("logout-button");
}

function validateConfiguration() {
  if (
    !window.supabase ||
    !window.APP_CONFIG
  ) {
    throw new Error(
      "Configuração do Supabase ausente."
    );
  }
}

function createAdminClient() {
  return window.supabase.createClient(
    window.APP_CONFIG.supabaseUrl,
    window.APP_CONFIG.supabasePublishableKey,
    {
      auth: {
        storageKey:
          "artist-valley-admin-auth",

        persistSession: true,

        autoRefreshToken: true,

        detectSessionInUrl: true
      }
    }
  );
}

async function requireAdminSession() {
  const {
    data,
    error
  } = await adminClient.auth.getSession();

  if (error) {
    throw error;
  }

  if (!data.session?.user) {
    throw new Error(
      "Nenhuma sessão administrativa encontrada."
    );
  }

  return data.session;
}

async function loadAdminStatus() {
  const {
    data,
    error
  } = await adminClient.rpc(
    "get_admin_status"
  );

  if (error) {
    throw error;
  }

  if (!data?.is_admin) {
    throw new Error(
      "A conta não possui permissão administrativa."
    );
  }

  return data;
}

function displayAdminData(user, adminStatus) {
  elements.adminName.textContent =
    adminStatus.display_name ||
    "Administrador";

  elements.adminEmail.textContent =
    user.email ||
    "E-mail não informado";
}

function configureEvents() {
  elements.logoutButton.addEventListener(
    "click",
    handleLogout
  );
}

async function handleLogout() {
  elements.logoutButton.disabled = true;
  elements.logoutButton.textContent =
    "ENCERRANDO...";

  try {
    await adminClient.auth.signOut();
  } finally {
    window.location.replace(
      "admin-login.html"
    );
  }
}

function revealPanel() {
  elements.loading.classList.add(
    "is-hidden"
  );

  elements.application.classList.remove(
    "is-hidden"
  );
}

async function redirectToLogin() {
  try {
    if (adminClient) {
      await adminClient.auth.signOut();
    }
  } catch (error) {
    console.warn(
      "Não foi possível limpar a sessão:",
      error
    );
  }

  window.location.replace(
    "admin-login.html"
  );
}
