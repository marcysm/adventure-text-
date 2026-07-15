"use strict";

/* ==========================================================
   ARTIST VALLEY ADVENTURE
   LOGIN ADMINISTRATIVO
   ========================================================== */

document.addEventListener("DOMContentLoaded", initializeAdminLogin);

function initializeAdminLogin() {
  const form = document.getElementById("loginForm");
  const emailInput = document.getElementById("email");
  const passwordInput = document.getElementById("password");
  const errorElement =
    document.getElementById("loginError") ||
    document.getElementById("errorMessage");

  /*
    Remove imediatamente e-mail e senha da URL,
    caso uma versão anterior tenha enviado o formulário por GET.
  */
  if (window.location.search) {
    window.history.replaceState(
      {},
      document.title,
      window.location.pathname
    );
  }

  if (!form) {
    showError(
      errorElement,
      "O formulário de login não foi encontrado."
    );

    return;
  }

  form.setAttribute("method", "post");

  if (!window.supabaseClient) {
    showError(
      errorElement,
      "O arquivo config.js não foi carregado."
    );

    console.error(
      "window.supabaseClient não existe. Verifique config.js e a ordem dos scripts."
    );

    return;
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    event.stopPropagation();

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";

    if (!email || !password) {
      showError(
        errorElement,
        "Preencha o e-mail e a senha."
      );

      return;
    }

    setFormLoading(form, true);
    showError(errorElement, "");

    try {
      const {
        data,
        error
      } = await window.supabaseClient.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      if (!data?.user) {
        throw new Error(
          "O Supabase não retornou um usuário autenticado."
        );
      }

      const {
        data: adminStatus,
        error: adminError
      } = await window.supabaseClient.rpc(
        "get_admin_status"
      );

      if (adminError) {
        throw adminError;
      }

      const status = normalizeAdminStatus(adminStatus);

      if (!status.isAdmin || !status.isActive) {
        await window.supabaseClient.auth.signOut();

        throw new Error(
          "Esta conta não possui acesso administrativo ativo."
        );
      }

      window.location.replace("./admin.html");
    } catch (error) {
      console.error("Erro no login:", error);

      showError(
        errorElement,
        translateLoginError(error)
      );
    } finally {
      setFormLoading(form, false);
    }
  });

  checkExistingSession();
}

async function checkExistingSession() {
  try {
    const {
      data: { session },
      error
    } = await window.supabaseClient.auth.getSession();

    if (error || !session?.user) {
      return;
    }

    const {
      data,
      error: adminError
    } = await window.supabaseClient.rpc(
      "get_admin_status"
    );

    if (adminError) {
      return;
    }

    const status = normalizeAdminStatus(data);

    if (status.isAdmin && status.isActive) {
      window.location.replace("./admin.html");
    }
  } catch (error) {
    console.warn(
      "Não foi possível verificar a sessão existente:",
      error
    );
  }
}

function normalizeAdminStatus(data) {
  const value = Array.isArray(data)
    ? data[0] || {}
    : data || {};

  return {
    isAdmin: Boolean(
      value.is_admin ??
      value.isAdmin ??
      value.admin
    ),

    isActive: Boolean(
      value.is_active ??
      value.isActive ??
      value.active
    )
  };
}

function showError(element, message) {
  if (!element) {
    return;
  }

  element.textContent = message || "";
  element.hidden = !message;

  element.classList.toggle(
    "is-hidden",
    !message
  );
}

function setFormLoading(form, loading) {
  const button = form.querySelector(
    'button[type="submit"]'
  );

  form.classList.toggle("is-loading", loading);

  if (button) {
    button.disabled = loading;

    button.textContent = loading
      ? "AUTENTICANDO..."
      : "AUTENTICAR";
  }
}

function translateLoginError(error) {
  const message = String(
    error?.message || ""
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
    return "Não foi possível conectar ao Supabase.";
  }

  if (
    message.includes("administrativo")
  ) {
    return error.message;
  }

  return (
    error?.message ||
    "Não foi possível realizar o acesso."
  );
}
