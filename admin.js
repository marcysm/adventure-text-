"use strict";

/* ==========================================================
   CONFIGURAÇÕES
   ========================================================== */

const GAME_SLUG = "artist-valley-adventure";

const state = {
  client: null,

  user: null,
  adminStatus: null,

  game: null,

  routes: [],
  scenes: [],
  filteredScenes: [],

  editingSceneId: null,
  actionsSceneId: null,

  isSaving: false
};

const elements = {};


/* ==========================================================
   INICIALIZAÇÃO
   ========================================================== */

document.addEventListener(
  "DOMContentLoaded",
  initializeAdminPanel
);

async function initializeAdminPanel() {
  cacheElements();
  configureEvents();

  try {
    validateConfiguration();

    updateLoadingMessage(
      "VERIFICANDO SESSÃO ADMINISTRATIVA..."
    );

    state.client = createAdminClient();

    const session = await requireAdminSession();

    state.user = session.user;

    updateLoadingMessage(
      "CONFIRMANDO PERMISSÕES..."
    );

    state.adminStatus =
      await loadAdminStatus();

    updateLoadingMessage(
      "CARREGANDO JOGO..."
    );

    state.game = await loadGame();

    updateLoadingMessage(
      "CARREGANDO ROTAS E CENAS..."
    );

    await loadPanelData();

    displayAdminIdentity();

    populateRouteSelectors();

    applySceneFilters();

    revealPanel();
  } catch (error) {
    console.error(
      "Não foi possível abrir o painel:",
      error
    );

    await redirectToLogin();
  }
}


/* ==========================================================
   ELEMENTOS
   ========================================================== */

function cacheElements() {
  elements.loading =
    document.getElementById("admin-loading");

  elements.loadingMessage =
    document.getElementById(
      "admin-loading-message"
    );

  elements.application =
    document.getElementById(
      "admin-application"
    );

  elements.adminName =
    document.getElementById("admin-name");

  elements.adminEmail =
    document.getElementById("admin-email");

  elements.logoutButton =
    document.getElementById("logout-button");

  elements.newSceneButton =
    document.getElementById(
      "new-scene-button"
    );

  elements.sceneSearch =
    document.getElementById("scene-search");

  elements.routeFilter =
    document.getElementById("route-filter");

  elements.statusFilter =
    document.getElementById("status-filter");

  elements.sceneList =
    document.getElementById("scene-list");

  elements.sceneListMessage =
    document.getElementById(
      "scene-list-message"
    );

  elements.totalScenes =
    document.getElementById("total-scenes");

  elements.activeScenes =
    document.getElementById("active-scenes");

  elements.inactiveScenes =
    document.getElementById(
      "inactive-scenes"
    );

  elements.endingScenes =
    document.getElementById(
      "ending-scenes"
    );

  elements.sceneCardTemplate =
    document.getElementById(
      "scene-card-template"
    );

  elements.sceneModal =
    document.getElementById("scene-modal");

  elements.sceneModalTitle =
    document.getElementById(
      "scene-modal-title"
    );

  elements.sceneForm =
    document.getElementById("scene-form");

  elements.sceneId =
    document.getElementById("scene-id");

  elements.sceneTitle =
    document.getElementById("scene-title");

  elements.sceneKey =
    document.getElementById("scene-key");

  elements.sceneDescription =
    document.getElementById(
      "scene-description"
    );

  elements.sceneRoute =
    document.getElementById("scene-route");

  elements.sceneFallback =
    document.getElementById(
      "scene-fallback"
    );

  elements.sceneHelpMode =
    document.getElementById(
      "scene-help-mode"
    );

  elements.sceneHelpText =
    document.getElementById(
      "scene-help-text"
    );

  elements.helpTextField =
    document.getElementById(
      "help-text-field"
    );

  elements.allowRepeat =
    document.getElementById("allow-repeat");

  elements.allowInventory =
    document.getElementById(
      "allow-inventory"
    );

  elements.allowHistory =
    document.getElementById(
      "allow-history"
    );

  elements.allowMap =
    document.getElementById("allow-map");

  elements.sceneEnabled =
    document.getElementById(
      "scene-enabled"
    );

  elements.sceneEnding =
    document.getElementById(
      "scene-ending"
    );

  elements.endingTypeField =
    document.getElementById(
      "ending-type-field"
    );

  elements.sceneEndingType =
    document.getElementById(
      "scene-ending-type"
    );

  elements.sceneFormMessage =
    document.getElementById(
      "scene-form-message"
    );

  elements.saveSceneButton =
    document.getElementById(
      "save-scene-button"
    );

  elements.sceneActionsModal =
    document.getElementById(
      "scene-actions-modal"
    );

  elements.sceneActionsTitle =
    document.getElementById(
      "scene-actions-title"
    );

  elements.duplicateSceneButton =
    document.getElementById(
      "duplicate-scene-button"
    );

  elements.toggleSceneButton =
    document.getElementById(
      "toggle-scene-button"
    );

  const missing = Object.entries(elements)
    .filter(([, element]) => !element)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Elementos ausentes no HTML: ${missing.join(", ")}`
    );
  }
}


/* ==========================================================
   EVENTOS
   ========================================================== */

function configureEvents() {
  elements.logoutButton.addEventListener(
    "click",
    handleLogout
  );

  elements.newSceneButton.addEventListener(
    "click",
    openNewSceneModal
  );

  elements.sceneSearch.addEventListener(
    "input",
    applySceneFilters
  );

  elements.routeFilter.addEventListener(
    "change",
    applySceneFilters
  );

  elements.statusFilter.addEventListener(
    "change",
    applySceneFilters
  );

  elements.sceneList.addEventListener(
    "click",
    handleSceneListClick
  );

  elements.sceneForm.addEventListener(
    "submit",
    handleSceneFormSubmit
  );

  elements.sceneHelpMode.addEventListener(
    "change",
    updateHelpModeInterface
  );

  elements.sceneEnding.addEventListener(
    "change",
    updateEndingInterface
  );

  elements.sceneKey.addEventListener(
    "input",
    handleSceneKeyInput
  );

  elements.sceneModal.addEventListener(
    "click",
    handleSceneModalClick
  );

  elements.sceneActionsModal.addEventListener(
    "click",
    handleActionsModalClick
  );

  elements.duplicateSceneButton.addEventListener(
    "click",
    duplicateSelectedScene
  );

  elements.toggleSceneButton.addEventListener(
    "click",
    toggleSelectedScene
  );

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") {
      return;
    }

    closeSceneModal();
    closeActionsModal();
  });
}


/* ==========================================================
   CONFIGURAÇÃO E AUTENTICAÇÃO
   ========================================================== */

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
  } = await state.client.auth.getSession();

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
  } = await state.client.rpc(
    "get_admin_status"
  );

  if (error) {
    throw error;
  }

  if (!data?.is_admin) {
    throw new Error(
      "Esta conta não possui permissão administrativa."
    );
  }

  return data;
}

async function handleLogout() {
  elements.logoutButton.disabled = true;
  elements.logoutButton.textContent =
    "ENCERRANDO...";

  try {
    await state.client.auth.signOut();
  } finally {
    window.location.replace(
      "admin-login.html"
    );
  }
}

async function redirectToLogin() {
  try {
    if (state.client) {
      await state.client.auth.signOut();
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


/* ==========================================================
   CARREGAMENTO DOS DADOS
   ========================================================== */

async function loadGame() {
  const {
    data,
    error
  } = await state.client
    .from("games")
    .select(`
      id,
      slug,
      title,
      is_published
    `)
    .eq("slug", GAME_SLUG)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function loadPanelData() {
  const [
    routesResult,
    scenesResult
  ] = await Promise.all([
    state.client
      .from("routes")
      .select(`
        id,
        code,
        name,
        primary_color,
        is_secret,
        is_enabled,
        display_order
      `)
      .eq("game_id", state.game.id)
      .order("display_order", {
        ascending: true
      }),

    state.client
      .from("scenes")
      .select(`
        id,
        game_id,
        route_id,
        scene_key,
        title,
        admin_description,
        fallback_text,
        help_mode,
        help_text,
        allow_repeat,
        allow_inventory,
        allow_history,
        allow_map,
        is_ending,
        ending_type,
        is_enabled,
        created_at,
        updated_at
      `)
      .eq("game_id", state.game.id)
      .order("updated_at", {
        ascending: false
      })
  ]);

  if (routesResult.error) {
    throw routesResult.error;
  }

  if (scenesResult.error) {
    throw scenesResult.error;
  }

  state.routes = routesResult.data || [];
  state.scenes = scenesResult.data || [];
}

async function refreshScenes() {
  showSceneListMessage(
    "ATUALIZANDO CENAS..."
  );

  const {
    data,
    error
  } = await state.client
    .from("scenes")
    .select(`
      id,
      game_id,
      route_id,
      scene_key,
      title,
      admin_description,
      fallback_text,
      help_mode,
      help_text,
      allow_repeat,
      allow_inventory,
      allow_history,
      allow_map,
      is_ending,
      ending_type,
      is_enabled,
      created_at,
      updated_at
    `)
    .eq("game_id", state.game.id)
    .order("updated_at", {
      ascending: false
    });

  if (error) {
    throw error;
  }

  state.scenes = data || [];

  applySceneFilters();
}


/* ==========================================================
   IDENTIDADE E EXIBIÇÃO INICIAL
   ========================================================== */

function displayAdminIdentity() {
  elements.adminName.textContent =
    state.adminStatus.display_name ||
    "Administrador";

  elements.adminEmail.textContent =
    state.user.email ||
    "E-mail não informado";
}

function revealPanel() {
  elements.loading.classList.add(
    "is-hidden"
  );

  elements.application.classList.remove(
    "is-hidden"
  );
}

function updateLoadingMessage(message) {
  elements.loadingMessage.textContent =
    message;
}


/* ==========================================================
   ROTAS
   ========================================================== */

function populateRouteSelectors() {
  state.routes.forEach(route => {
    const filterOption =
      document.createElement("option");

    filterOption.value = route.id;

    filterOption.textContent =
      route.is_secret
        ? `${route.name} — secreta`
        : route.name;

    elements.routeFilter.appendChild(
      filterOption
    );

    const formOption =
      document.createElement("option");

    formOption.value = route.id;

    formOption.textContent =
      route.is_secret
        ? `${route.name} — secreta`
        : route.name;

    elements.sceneRoute.appendChild(
      formOption
    );
  });
}

function getRouteById(routeId) {
  return state.routes.find(
    route => route.id === routeId
  ) || null;
}


/* ==========================================================
   FILTROS
   ========================================================== */

function applySceneFilters() {
  const searchTerm = normalizeText(
    elements.sceneSearch.value
  );

  const routeValue =
    elements.routeFilter.value;

  const statusValue =
    elements.statusFilter.value;

  state.filteredScenes =
    state.scenes.filter(scene => {
      const searchableContent = normalizeText([
        scene.title,
        scene.scene_key,
        scene.admin_description
      ].filter(Boolean).join(" "));

      const matchesSearch =
        !searchTerm ||
        searchableContent.includes(searchTerm);

      let matchesRoute = true;

      if (routeValue === "none") {
        matchesRoute = !scene.route_id;
      } else if (routeValue) {
        matchesRoute =
          scene.route_id === routeValue;
      }

      let matchesStatus = true;

      switch (statusValue) {
        case "active":
          matchesStatus =
            scene.is_enabled === true;
          break;

        case "inactive":
          matchesStatus =
            scene.is_enabled === false;
          break;

        case "ending":
          matchesStatus =
            scene.is_ending === true;
          break;

        default:
          matchesStatus = true;
      }

      return (
        matchesSearch &&
        matchesRoute &&
        matchesStatus
      );
    });

  updateSceneStatistics();

  renderSceneList();
}

function updateSceneStatistics() {
  elements.totalScenes.textContent =
    String(state.scenes.length);

  elements.activeScenes.textContent =
    String(
      state.scenes.filter(
        scene => scene.is_enabled
      ).length
    );

  elements.inactiveScenes.textContent =
    String(
      state.scenes.filter(
        scene => !scene.is_enabled
      ).length
    );

  elements.endingScenes.textContent =
    String(
      state.scenes.filter(
        scene => scene.is_ending
      ).length
    );
}


/* ==========================================================
   LISTA DE CENAS
   ========================================================== */

function renderSceneList() {
  elements.sceneList.replaceChildren();

  if (state.filteredScenes.length === 0) {
    const empty = document.createElement("div");

    empty.className = "scene-list__empty";

    empty.textContent =
      "Nenhuma cena corresponde aos filtros selecionados.";

    elements.sceneList.appendChild(empty);

    showSceneListMessage(
      "NENHUMA CENA ENCONTRADA."
    );

    return;
  }

  const fragment =
    document.createDocumentFragment();

  state.filteredScenes.forEach(scene => {
    fragment.appendChild(
      createSceneCard(scene)
    );
  });

  elements.sceneList.appendChild(fragment);

  showSceneListMessage(
    `${state.filteredScenes.length} CENA(S) EXIBIDA(S).`
  );
}

function createSceneCard(scene) {
  const fragment =
    elements.sceneCardTemplate.content
      .cloneNode(true);

  const card =
    fragment.querySelector(".scene-card");

  const title =
    fragment.querySelector(
      ".scene-card__title"
    );

  const identifier =
    fragment.querySelector(
      ".scene-card__identifier"
    );

  const routeLabel =
    fragment.querySelector(
      ".scene-card__route"
    );

  const description =
    fragment.querySelector(
      ".scene-card__description"
    );

  const helpMetadata =
    fragment.querySelector(
      '[data-scene-meta="help"]'
    );

  const commandsMetadata =
    fragment.querySelector(
      '[data-scene-meta="commands"]'
    );

  const endingMetadata =
    fragment.querySelector(
      '[data-scene-meta="ending"]'
    );

  const editButton =
    fragment.querySelector(
      '[data-action="edit"]'
    );

  const moreButton =
    fragment.querySelector(
      '[data-action="more"]'
    );

  card.dataset.sceneId = scene.id;

  card.classList.toggle(
    "is-inactive",
    !scene.is_enabled
  );

  card.classList.toggle(
    "is-ending",
    scene.is_ending
  );

  title.textContent =
    scene.title || "Cena sem título";

  identifier.textContent =
    scene.scene_key;

  const route = getRouteById(scene.route_id);

  routeLabel.textContent =
    route
      ? route.name.toLocaleUpperCase("pt-BR")
      : "TODAS AS ROTAS";

  if (route?.primary_color) {
    routeLabel.style.borderColor =
      route.primary_color;

    routeLabel.style.color =
      route.primary_color;
  }

  description.textContent =
    scene.admin_description ||
    "Nenhuma descrição administrativa.";

  helpMetadata.textContent =
    `AJUDA: ${formatHelpMode(scene.help_mode)}`;

  commandsMetadata.textContent =
    formatAllowedCommands(scene);

  endingMetadata.textContent =
    scene.is_ending
      ? `FINAL: ${formatEndingType(
          scene.ending_type
        )}`
      : "";

  editButton.dataset.sceneId = scene.id;
  moreButton.dataset.sceneId = scene.id;

  return fragment;
}

function formatHelpMode(helpMode) {
  const names = {
    normal: "NORMAL",
    custom: "PERSONALIZADA",
    silent: "SEM RESPOSTA",
    disabled: "DESATIVADA"
  };

  return names[helpMode] || helpMode;
}

function formatAllowedCommands(scene) {
  const commands = [];

  if (scene.allow_repeat) {
    commands.push("REPETIR");
  }

  if (scene.allow_inventory) {
    commands.push("INVENTÁRIO");
  }

  if (scene.allow_history) {
    commands.push("HISTÓRICO");
  }

  if (scene.allow_map) {
    commands.push("MAPA");
  }

  return commands.length > 0
    ? commands.join(" · ")
    : "SEM COMANDOS ADICIONAIS";
}

function formatEndingType(endingType) {
  const names = {
    victory: "VITÓRIA",
    defeat: "DERROTA",
    neutral: "NEUTRO",
    secret: "SECRETO"
  };

  return names[endingType] || "NEUTRO";
}

function showSceneListMessage(
  message,
  type = ""
) {
  elements.sceneListMessage.className =
    "scene-list-message";

  if (type) {
    elements.sceneListMessage.classList.add(
      `is-${type}`
    );
  }

  elements.sceneListMessage.textContent =
    message || "";
}


/* ==========================================================
   CLIQUES DA LISTA
   ========================================================== */

function handleSceneListClick(event) {
  const button = event.target.closest(
    "[data-action]"
  );

  if (!button) {
    return;
  }

  const sceneId = button.dataset.sceneId;

  if (!sceneId) {
    return;
  }

  switch (button.dataset.action) {
    case "edit":
      openEditSceneModal(sceneId);
      break;

    case "more":
      openActionsModal(sceneId);
      break;
  }
}


/* ==========================================================
   MODAL DA CENA
   ========================================================== */

function openNewSceneModal() {
  state.editingSceneId = null;

  resetSceneForm();

  elements.sceneModalTitle.textContent =
    "Nova cena";

  elements.sceneKey.disabled = false;

  openSceneModal();
}

function openEditSceneModal(sceneId) {
  const scene = state.scenes.find(
    item => item.id === sceneId
  );

  if (!scene) {
    showSceneListMessage(
      "A cena selecionada não foi encontrada.",
      "error"
    );

    return;
  }

  state.editingSceneId = scene.id;

  fillSceneForm(scene);

  elements.sceneModalTitle.textContent =
    scene.title || "Editar cena";

  /*
    O identificador é bloqueado após a criação para evitar
    quebrar referências narrativas sem querer.
  */
  elements.sceneKey.disabled = true;

  openSceneModal();
}

function openSceneModal() {
  clearSceneFormMessage();

  elements.sceneModal.classList.remove(
    "is-hidden"
  );

  document.body.style.overflow = "hidden";

  window.setTimeout(() => {
    if (state.editingSceneId) {
      elements.sceneTitle.focus();
    } else {
      elements.sceneTitle.focus();
    }
  }, 50);
}

function closeSceneModal() {
  if (state.isSaving) {
    return;
  }

  elements.sceneModal.classList.add(
    "is-hidden"
  );

  document.body.style.overflow = "";

  state.editingSceneId = null;
}

function handleSceneModalClick(event) {
  if (
    event.target.closest(
      "[data-close-scene-modal]"
    )
  ) {
    closeSceneModal();
  }
}

function resetSceneForm() {
  elements.sceneForm.reset();

  elements.sceneId.value = "";

  elements.sceneRoute.value = "";
  elements.sceneHelpMode.value = "normal";

  elements.allowRepeat.checked = true;
  elements.allowInventory.checked = true;
  elements.allowHistory.checked = true;
  elements.allowMap.checked = false;

  elements.sceneEnabled.checked = true;
  elements.sceneEnding.checked = false;
  elements.sceneEndingType.value = "neutral";

  elements.sceneKey.disabled = false;

  updateHelpModeInterface();
  updateEndingInterface();

  clearSceneFormMessage();
}

function fillSceneForm(scene) {
  elements.sceneId.value =
    scene.id;

  elements.sceneTitle.value =
    scene.title || "";

  elements.sceneKey.value =
    scene.scene_key || "";

  elements.sceneDescription.value =
    scene.admin_description || "";

  elements.sceneRoute.value =
    scene.route_id || "";

  elements.sceneFallback.value =
    scene.fallback_text || "";

  elements.sceneHelpMode.value =
    scene.help_mode || "normal";

  elements.sceneHelpText.value =
    scene.help_text || "";

  elements.allowRepeat.checked =
    scene.allow_repeat === true;

  elements.allowInventory.checked =
    scene.allow_inventory === true;

  elements.allowHistory.checked =
    scene.allow_history === true;

  elements.allowMap.checked =
    scene.allow_map === true;

  elements.sceneEnabled.checked =
    scene.is_enabled === true;

  elements.sceneEnding.checked =
    scene.is_ending === true;

  elements.sceneEndingType.value =
    scene.ending_type || "neutral";

  updateHelpModeInterface();
  updateEndingInterface();

  clearSceneFormMessage();
}


/* ==========================================================
   INTERFACE DO FORMULÁRIO
   ========================================================== */

function updateHelpModeInterface() {
  const currentMode =
    elements.sceneHelpMode.value;

  const showTextField =
    currentMode === "normal" ||
    currentMode === "custom";

  elements.helpTextField.classList.toggle(
    "is-hidden",
    !showTextField
  );

  document
    .querySelectorAll(
      "[data-help-explanation]"
    )
    .forEach(paragraph => {
      paragraph.classList.toggle(
        "is-hidden",
        paragraph.dataset.helpExplanation
          !== currentMode
      );
    });
}

function updateEndingInterface() {
  const isEnding =
    elements.sceneEnding.checked;

  elements.endingTypeField.classList.toggle(
    "is-hidden",
    !isEnding
  );
}

function handleSceneKeyInput() {
  if (elements.sceneKey.disabled) {
    return;
  }

  const normalizedKey =
    normalizeSceneKey(
      elements.sceneKey.value
    );

  if (
    normalizedKey !==
    elements.sceneKey.value
  ) {
    elements.sceneKey.value =
      normalizedKey;
  }
}

function normalizeSceneKey(value) {
  return String(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}


/* ==========================================================
   SALVAR CENA
   ========================================================== */

async function handleSceneFormSubmit(event) {
  event.preventDefault();

  if (state.isSaving) {
    return;
  }

  const sceneData = collectSceneFormData();

  const validationError =
    validateSceneData(sceneData);

  if (validationError) {
    showSceneFormMessage(
      validationError,
      "error"
    );

    return;
  }

  setSceneSaving(true);

  showSceneFormMessage(
    "SALVANDO CENA..."
  );

  try {
    if (state.editingSceneId) {
      await updateScene(
        state.editingSceneId,
        sceneData
      );
    } else {
      await createScene(sceneData);
    }

    showSceneFormMessage(
      "CENA SALVA COM SUCESSO.",
      "success"
    );

    await refreshScenes();

    window.setTimeout(() => {
      closeSceneModal();
    }, 450);
  } catch (error) {
    console.error(
      "Erro ao salvar cena:",
      error
    );

    showSceneFormMessage(
      formatDatabaseError(error),
      "error"
    );
  } finally {
    setSceneSaving(false);
  }
}

function collectSceneFormData() {
  const isEnding =
    elements.sceneEnding.checked;

  return {
    game_id: state.game.id,

    route_id:
      elements.sceneRoute.value || null,

    scene_key:
      normalizeSceneKey(
        elements.sceneKey.value
      ),

    title:
      emptyToNull(
        elements.sceneTitle.value
      ),

    admin_description:
      emptyToNull(
        elements.sceneDescription.value
      ),

    fallback_text:
      emptyToNull(
        elements.sceneFallback.value
      ),

    help_mode:
      elements.sceneHelpMode.value,

    help_text:
      (
        elements.sceneHelpMode.value === "normal" ||
        elements.sceneHelpMode.value === "custom"
      )
        ? emptyToNull(
            elements.sceneHelpText.value
          )
        : null,

    allow_repeat:
      elements.allowRepeat.checked,

    allow_inventory:
      elements.allowInventory.checked,

    allow_history:
      elements.allowHistory.checked,

    allow_map:
      elements.allowMap.checked,

    is_ending:
      isEnding,

    ending_type:
      isEnding
        ? elements.sceneEndingType.value
        : null,

    is_enabled:
      elements.sceneEnabled.checked
  };
}

function validateSceneData(sceneData) {
  if (!sceneData.scene_key) {
    return "Informe o identificador interno da cena.";
  }

  if (
    !/^[a-z0-9_]+$/.test(
      sceneData.scene_key
    )
  ) {
    return (
      "O identificador pode conter apenas letras minúsculas, " +
      "números e sublinhados."
    );
  }

  if (
    sceneData.help_mode === "custom" &&
    !sceneData.help_text
  ) {
    return (
      "Cadastre o texto da ajuda personalizada."
    );
  }

  return null;
}

async function createScene(sceneData) {
  const {
    data,
    error
  } = await state.client
    .from("scenes")
    .insert(sceneData)
    .select(`
      id,
      scene_key,
      title
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

async function updateScene(
  sceneId,
  sceneData
) {
  /*
    Não alteramos game_id nem scene_key durante a edição.
  */
  const {
    game_id,
    scene_key,
    ...editableData
  } = sceneData;

  const {
    data,
    error
  } = await state.client
    .from("scenes")
    .update(editableData)
    .eq("id", sceneId)
    .eq("game_id", state.game.id)
    .select(`
      id,
      scene_key,
      title
    `)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function setSceneSaving(isSaving) {
  state.isSaving = isSaving;

  const formControls =
    elements.sceneForm.querySelectorAll(
      "input, textarea, select, button"
    );

  formControls.forEach(control => {
    control.disabled = isSaving;
  });

  /*
    Se não estiver salvando, devolvemos o bloqueio
    permanente do scene_key durante uma edição.
  */
  if (!isSaving) {
    elements.sceneKey.disabled =
      Boolean(state.editingSceneId);
  }

  elements.saveSceneButton.textContent =
    isSaving
      ? "SALVANDO..."
      : "SALVAR CENA";
}

function showSceneFormMessage(
  message,
  type = ""
) {
  elements.sceneFormMessage.className =
    "form-message";

  if (type) {
    elements.sceneFormMessage.classList.add(
      `is-${type}`
    );
  }

  elements.sceneFormMessage.textContent =
    message || "";
}

function clearSceneFormMessage() {
  showSceneFormMessage("");
}


/* ==========================================================
   MENU DE AÇÕES
   ========================================================== */

function openActionsModal(sceneId) {
  const scene = state.scenes.find(
    item => item.id === sceneId
  );

  if (!scene) {
    return;
  }

  state.actionsSceneId = scene.id;

  elements.sceneActionsTitle.textContent =
    scene.title || scene.scene_key;

  updateToggleSceneButton(scene);

  elements.sceneActionsModal.classList.remove(
    "is-hidden"
  );

  document.body.style.overflow = "hidden";
}

function closeActionsModal() {
  elements.sceneActionsModal.classList.add(
    "is-hidden"
  );

  document.body.style.overflow = "";

  state.actionsSceneId = null;
}

function handleActionsModalClick(event) {
  if (
    event.target.closest(
      "[data-close-actions-modal]"
    )
  ) {
    closeActionsModal();
  }
}

function updateToggleSceneButton(scene) {
  const strong =
    elements.toggleSceneButton.querySelector(
      "strong"
    );

  const description =
    elements.toggleSceneButton.querySelector(
      "span"
    );

  if (scene.is_enabled) {
    strong.textContent =
      "DESATIVAR CENA";

    description.textContent =
      "Impede temporariamente o uso da cena no jogo.";
  } else {
    strong.textContent =
      "ATIVAR CENA";

    description.textContent =
      "Torna a cena novamente disponível no jogo.";
  }
}


/* ==========================================================
   DUPLICAR CENA
   ========================================================== */

async function duplicateSelectedScene() {
  const sourceScene = state.scenes.find(
    scene => scene.id === state.actionsSceneId
  );

  if (!sourceScene) {
    return;
  }

  elements.duplicateSceneButton.disabled = true;

  try {
    const duplicatedKey =
      createAvailableDuplicateKey(
        sourceScene.scene_key
      );

    const duplicateData = {
      game_id: sourceScene.game_id,
      route_id: sourceScene.route_id,

      scene_key: duplicatedKey,

      title: sourceScene.title
        ? `${sourceScene.title} — Cópia`
        : "Cena duplicada",

      admin_description:
        sourceScene.admin_description,

      fallback_text:
        sourceScene.fallback_text,

      help_mode:
        sourceScene.help_mode,

      help_text:
        sourceScene.help_text,

      allow_repeat:
        sourceScene.allow_repeat,

      allow_inventory:
        sourceScene.allow_inventory,

      allow_history:
        sourceScene.allow_history,

      allow_map:
        sourceScene.allow_map,

      is_ending:
        sourceScene.is_ending,

      ending_type:
        sourceScene.ending_type,

      is_enabled: false
    };

    const duplicatedScene =
      await createScene(duplicateData);

    await refreshScenes();

    closeActionsModal();

    openEditSceneModal(
      duplicatedScene.id
    );
  } catch (error) {
    console.error(
      "Erro ao duplicar cena:",
      error
    );

    window.alert(
      formatDatabaseError(error)
    );
  } finally {
    elements.duplicateSceneButton.disabled =
      false;
  }
}

function createAvailableDuplicateKey(
  originalKey
) {
  let index = 1;

  let candidate =
    `${originalKey}_copia`;

  const existingKeys = new Set(
    state.scenes.map(
      scene => scene.scene_key
    )
  );

  while (existingKeys.has(candidate)) {
    index += 1;

    candidate =
      `${originalKey}_copia_${index}`;
  }

  return candidate;
}


/* ==========================================================
   ATIVAR OU DESATIVAR
   ========================================================== */

async function toggleSelectedScene() {
  const scene = state.scenes.find(
    item => item.id === state.actionsSceneId
  );

  if (!scene) {
    return;
  }

  elements.toggleSceneButton.disabled = true;

  try {
    const {
      error
    } = await state.client
      .from("scenes")
      .update({
        is_enabled: !scene.is_enabled
      })
      .eq("id", scene.id)
      .eq("game_id", state.game.id);

    if (error) {
      throw error;
    }

    await refreshScenes();

    closeActionsModal();
  } catch (error) {
    console.error(
      "Erro ao alterar estado da cena:",
      error
    );

    window.alert(
      formatDatabaseError(error)
    );
  } finally {
    elements.toggleSceneButton.disabled =
      false;
  }
}


/* ==========================================================
   UTILIDADES
   ========================================================== */

function normalizeText(value) {
  return String(value || "")
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function emptyToNull(value) {
  const trimmed = String(value || "").trim();

  return trimmed || null;
}

function formatDatabaseError(error) {
  const message = String(
    error?.message || "Erro desconhecido."
  );

  const lowerMessage =
    message.toLocaleLowerCase("pt-BR");

  if (
    lowerMessage.includes(
      "scenes_game_key_unique"
    ) ||
    lowerMessage.includes(
      "duplicate key value"
    )
  ) {
    return (
      "Já existe uma cena com esse identificador interno."
    );
  }

  if (
    lowerMessage.includes(
      "row-level security"
    )
  ) {
    return (
      "A operação foi bloqueada pelas permissões do banco."
    );
  }

  if (
    lowerMessage.includes(
      "permission denied"
    )
  ) {
    return (
      "A conta não possui permissão para alterar esta tabela."
    );
  }

  if (
    lowerMessage.includes(
      "failed to fetch"
    )
  ) {
    return (
      "Não foi possível alcançar o Supabase."
    );
  }

  return message;
}
