"use strict";

const elements = {};

let adminClient = null;

document.addEventListener(
  "DOMContentLoaded",
  initializeAdminLogin
);

async function initializeAdminLogin() {
  cacheElements();

  try {
    validateConfiguration();

    adminClient = createAdminClient();

    configureEvents();

    await redirectIfAlreadyAuthenticated();
  } catch (error) {
    console.error(
      "Erro ao iniciar login administrativo:",
      error
    );

    showMessage(
      formatErrorMessage(error),
      "error"
    );
  }
}

function cacheElements() {
  elements.form =
    document.getElementById("login-form");

  elements.email =
    document.getElementById("email");

  elements.password =
    document.getElementById("password");

  elements.message =
    document.getElementById("login-message");

  elements.button =
    document.getElementById("login-button");

  const missing = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Elementos ausentes: ${missing.join(", ")}`
    );
  }
}

function validateConfiguration() {
  if (!window.supabase) {
    throw new Error(
      "A biblioteca do Supabase não foi carregada."
    );
  }

  if (!window.APP_CONFIG) {
    throw new Error(
      "O arquivo config.js não foi carregado."
    );
  }
}

/*
  Este cliente usa uma chave de armazenamento diferente.

  Por isso, o login administrativo não substitui
  a identidade anônima utilizada dentro do jogo.
*/
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

function configureEvents() {
  elements.form.addEventListener(
    "submit",
    handleLogin
  );
}

async function redirectIfAlreadyAuthenticated() {
  const {
    data,
    error
  } = await adminClient.auth.getSession();

  if (error) {
    throw error;
  }

  if (!data.session?.user) {
    elements.email.focus();
    return;
  }

  const isAdmin = await verifyAdminPermission();

  if (isAdmin) {
    window.location.replace("admin.html");
    return;
  }

  await adminClient.auth.signOut();

  showMessage(
    "A sessão encontrada não possui permissão administrativa.",
    "error"
  );
}

async function handleLogin(event) {
  event.preventDefault();

  const email =
    elements.email.value.trim();

  const password =
    elements.password.value;

  if (!email || !password) {
    showMessage(
      "Preencha o e-mail e a senha.",
      "error"
    );

    return;
  }

  setLoading(true);

  showMessage(
    "VERIFICANDO IDENTIDADE..."
  );

  try {
    const {
      data,
      error
    } = await adminClient.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error(
        "Nenhum usuário foi retornado."
      );
    }

    const isAdmin =
      await verifyAdminPermission();

    if (!isAdmin) {
      await adminClient.auth.signOut();

      showMessage(
        "Esta conta não possui autorização administrativa.",
        "error"
      );

      return;
    }

    showMessage(
      "ACESSO AUTORIZADO.",
      "success"
    );

    window.setTimeout(() => {
      window.location.replace("admin.html");
    }, 650);
  } catch (error) {
    console.error(
      "Falha na autenticação:",
      error
    );

    showMessage(
      formatErrorMessage(error),
      "error"
    );
  } finally {
    setLoading(false);
  }
}

async function verifyAdminPermission() {
  const {
    data,
    error
  } = await adminClient.rpc(
    "get_admin_status"
  );

  if (error) {
    throw error;
  }

  return data?.is_admin === true;
}

function setLoading(isLoading) {
  elements.button.disabled = isLoading;
  elements.email.disabled = isLoading;
  elements.password.disabled = isLoading;

  elements.button.textContent =
    isLoading
      ? "AUTENTICANDO..."
      : "AUTENTICAR";
}

function showMessage(message, type = "") {
  elements.message.className =
    "login-message";

  if (type) {
    elements.message.classList.add(
      `is-${type}`
    );
  }

  elements.message.textContent =
    message || "";
}

function formatErrorMessage(error) {
  const message = String(
    error?.message || "Erro desconhecido."
  ).toLowerCase();

  if (
    message.includes("invalid login credentials")
  ) {
    return "E-mail ou senha incorretos.";
  }

  if (
    message.includes("email not confirmed")
  ) {
    return "O e-mail desta conta ainda não foi confirmado.";
  }

  if (
    message.includes("failed to fetch")
  ) {
    return "Não foi possível alcançar o Supabase.";
  }

  return error?.message ||
    "Não foi possível realizar a autenticação.";
}
