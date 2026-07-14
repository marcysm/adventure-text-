"use strict";

document.addEventListener("DOMContentLoaded", initializeApplication);

/*
  Variáveis utilizadas em toda a página.
*/
let supabaseClient = null;
let currentUser = null;
let currentProfile = null;

/*
  Inicia a aplicação.
*/
async function initializeApplication() {
  const elements = getPageElements();

  try {
    validatePageElements(elements);
    validateConfiguration();

    setLoadingState(
      elements,
      "Conectando ao banco de dados..."
    );

    supabaseClient = createSupabaseClient();

    currentUser = await getOrCreateAnonymousUser();

    currentProfile = await getOrCreatePlayerProfile(
      currentUser.id
    );

    displayConnectedPlayer(elements, currentProfile);

    configureTestButton(elements);
  } catch (error) {
    console.error("Falha ao iniciar o sistema:", error);

    displayError(
      elements,
      formatErrorMessage(error)
    );
  }
}

/*
  Reúne os elementos principais da página.
*/
function getPageElements() {
  return {
    systemStatus: document.getElementById("system-status"),
    playerCode: document.getElementById("player-code"),
    testButton: document.getElementById("test-button"),
    connectionLabel: document.getElementById(
      "connection-label"
    ),
    statusLight: document.getElementById("status-light")
  };
}

/*
  Confirma se o HTML contém tudo de que precisamos.
*/
function validatePageElements(elements) {
  const missingElements = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missingElements.length > 0) {
    throw new Error(
      `Elementos ausentes no HTML: ${missingElements.join(", ")}`
    );
  }
}

/*
  Confirma se config.js foi preenchido corretamente.
*/
function validateConfiguration() {
  if (!window.APP_CONFIG) {
    throw new Error(
      "O arquivo config.js não foi carregado."
    );
  }

  const {
    supabaseUrl,
    supabasePublishableKey
  } = window.APP_CONFIG;

  if (
    !supabaseUrl ||
    supabaseUrl.includes("COLE_AQUI")
  ) {
    throw new Error(
      "A Project URL ainda não foi configurada."
    );
  }

  if (
    !supabasePublishableKey ||
    supabasePublishableKey.includes("COLE_AQUI")
  ) {
    throw new Error(
      "A Publishable Key ainda não foi configurada."
    );
  }

  if (!window.supabase) {
    throw new Error(
      "A biblioteca do Supabase não foi carregada."
    );
  }
}

/*
  Cria o cliente usado para conversar com o Supabase.
*/
function createSupabaseClient() {
  const {
    supabaseUrl,
    supabasePublishableKey
  } = window.APP_CONFIG;

  return window.supabase.createClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
}

/*
  Verifica se já existe uma sessão no navegador.

  Caso não exista, cria um novo usuário anônimo.
*/
async function getOrCreateAnonymousUser() {
  const {
    data: sessionData,
    error: sessionError
  } = await supabaseClient.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  const existingUser = sessionData.session?.user;

  if (existingUser) {
    return existingUser;
  }

  const {
    data: signInData,
    error: signInError
  } = await supabaseClient.auth.signInAnonymously();

  if (signInError) {
    throw signInError;
  }

  if (!signInData.user) {
    throw new Error(
      "O Supabase não retornou o jogador criado."
    );
  }

  return signInData.user;
}

/*
  Procura o perfil correspondente ao usuário.

  Caso não exista, cria um perfil com um código público.
*/
async function getOrCreatePlayerProfile(userId) {
  const {
    data: existingProfile,
    error: searchError
  } = await supabaseClient
    .from("player_profiles")
    .select(
      "user_id, player_code, created_at, last_seen_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (searchError) {
    throw searchError;
  }

  if (existingProfile) {
    return updateLastSeen(existingProfile);
  }

  const newProfile = {
    user_id: userId,
    player_code: generatePlayerCode(),
    last_seen_at: new Date().toISOString()
  };

  const {
    data: createdProfile,
    error: creationError
  } = await supabaseClient
    .from("player_profiles")
    .insert(newProfile)
    .select(
      "user_id, player_code, created_at, last_seen_at"
    )
    .single();

  if (creationError) {
    throw creationError;
  }

  return createdProfile;
}

/*
  Atualiza o último acesso do jogador.
*/
async function updateLastSeen(profile) {
  const newLastSeen = new Date().toISOString();

  const {
    data: updatedProfile,
    error
  } = await supabaseClient
    .from("player_profiles")
    .update({
      last_seen_at: newLastSeen
    })
    .eq("user_id", profile.user_id)
    .select(
      "user_id, player_code, created_at, last_seen_at"
    )
    .single();

  if (error) {
    throw error;
  }

  return updatedProfile;
}

/*
  Gera um código visual para identificar o jogador.

  A segurança real continua sendo feita pelo UUID do Supabase.
*/
function generatePlayerCode() {
  const firstPart = generateRandomPart(4);
  const secondPart = generateRandomPart(4);

  return `ARQ-${firstPart}-${secondPart}`;
}

/*
  Gera caracteres sem letras facilmente confundidas.
*/
function generateRandomPart(length) {
  const characters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const randomValues = new Uint32Array(length);

  crypto.getRandomValues(randomValues);

  return Array.from(randomValues, value => {
    return characters[value % characters.length];
  }).join("");
}

/*
  Mostra que o jogador foi conectado corretamente.
*/
function displayConnectedPlayer(elements, profile) {
  elements.playerCode.textContent = profile.player_code;

  elements.systemStatus.textContent =
    "IDENTIDADE CONFIRMADA. PROGRESSO INDIVIDUAL ATIVO.";

  elements.systemStatus.classList.remove("is-error");
  elements.systemStatus.classList.add("is-success");

  elements.connectionLabel.textContent =
    "SISTEMA CONECTADO";

  elements.statusLight.classList.add("is-connected");

  elements.testButton.disabled = false;
}

/*
  Configura o botão de teste.

  Ao clicar, atualizamos novamente o último acesso.
*/
function configureTestButton(elements) {
  elements.testButton.addEventListener(
    "click",
    async () => {
      elements.testButton.disabled = true;

      setLoadingState(
        elements,
        "Testando leitura e salvamento..."
      );

      try {
        currentProfile = await updateLastSeen(
          currentProfile
        );

        const formattedTime = formatDate(
          currentProfile.last_seen_at
        );

        elements.systemStatus.textContent =
          `SALVAMENTO CONFIRMADO EM ${formattedTime}.`;

        elements.systemStatus.classList.remove(
          "is-error"
        );

        elements.systemStatus.classList.add(
          "is-success"
        );
      } catch (error) {
        console.error(
          "Erro durante o teste de salvamento:",
          error
        );

        displayError(
          elements,
          formatErrorMessage(error)
        );
      } finally {
        elements.testButton.disabled = false;
      }
    }
  );
}

/*
  Aplica estado de carregamento.
*/
function setLoadingState(elements, message) {
  elements.systemStatus.textContent = message;

  elements.systemStatus.classList.remove(
    "is-success",
    "is-error"
  );
}

/*
  Mostra erros de forma amigável.
*/
function displayError(elements, message) {
  elements.systemStatus.textContent =
    `ERRO: ${message}`;

  elements.systemStatus.classList.remove(
    "is-success"
  );

  elements.systemStatus.classList.add(
    "is-error"
  );

  elements.connectionLabel.textContent =
    "FALHA DE CONEXÃO";

  elements.statusLight.classList.remove(
    "is-connected"
  );

  elements.statusLight.classList.add(
    "is-error"
  );

  elements.testButton.disabled = true;
}

/*
  Traduz alguns erros comuns.
*/
function formatErrorMessage(error) {
  const message = String(
    error?.message || "Erro desconhecido."
  );

  if (
    message.toLowerCase().includes(
      "anonymous sign-ins are disabled"
    )
  ) {
    return (
      "O login anônimo não está ativado no Supabase."
    );
  }

  if (
    message.toLowerCase().includes(
      "invalid api key"
    )
  ) {
    return (
      "A Publishable Key parece estar incorreta."
    );
  }

  if (
    message.toLowerCase().includes(
      "failed to fetch"
    )
  ) {
    return (
      "Não foi possível alcançar o Supabase. Confira a URL e sua internet."
    );
  }

  if (
    message.toLowerCase().includes(
      "player_profiles"
    )
  ) {
    return (
      "A tabela player_profiles não foi encontrada ou está bloqueada."
    );
  }

  return message;
}

/*
  Formata data e horário no padrão brasileiro.
*/
function formatDate(dateValue) {
  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      dateStyle: "short",
      timeStyle: "medium"
    }
  ).format(new Date(dateValue));
}
