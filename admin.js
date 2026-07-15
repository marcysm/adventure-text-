"use strict";

/* ==========================================================
   ARTIST VALLEY ADVENTURE
   ADMIN.JS — ARQUIVO COMPLETO
   ========================================================== */


/* ==========================================================
   1. CONFIGURAÇÕES
   ========================================================== */

const GAME_SLUG = "artist-valley-adventure";

const TABLES = Object.freeze({
  GAMES: "games",
  ROUTES: "routes",
  SCENES: "scenes",
  ACTIONS: "scene_actions",
  ITEMS: "items",
  SCENE_ITEMS: "scene_items",
  MEDIA: "media_library"
});

const STORAGE_BUCKET = "adventure-media";

const MEDIA_LIMITS = Object.freeze({
  image: 6 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  other: 6 * 1024 * 1024
});

const MAP_CONFIG = Object.freeze({
  width: 2400,
  height: 1600,
  nodeWidth: 210,
  nodeHeight: 100,
  minZoom: 0.35,
  maxZoom: 1.8,
  zoomStep: 0.1,
  defaultZoom: 0.75,
  gridSize: 20
});


/* ==========================================================
   2. ESTADO CENTRAL
   ========================================================== */

const state = {
  client: null,

  user: null,
  adminStatus: null,
  game: null,

  routes: [],
  scenes: [],
  filteredScenes: [],
  actions: [],
  items: [],
  sceneItems: [],
  media: [],

  currentView: "dashboard",

  editingSceneId: null,
  actionsSceneId: null,
  editingActionId: null,
  editingRouteId: null,
  editingItemId: null,

  selectedMediaId: null,
  mediaTargetInputId: null,
  mediaFilter: "all",
  mediaSearch: "",

  sceneSearch: "",
  sceneStatusFilter: "all",
  sceneRouteFilter: "all",

  selectedMapSceneId: null,
  selectedMapConnectionId: null,

  map: {
    zoom: MAP_CONFIG.defaultZoom,
    offsetX: 40,
    offsetY: 40,

    draggingCanvas: false,
    draggingNode: false,

    dragSceneId: null,

    startMouseX: 0,
    startMouseY: 0,

    startOffsetX: 0,
    startOffsetY: 0,

    nodeStartX: 0,
    nodeStartY: 0,

    connecting: false,
    connectionFromSceneId: null,
    connectionMouseX: 0,
    connectionMouseY: 0
  },

  loadingCount: 0,
  eventsConfigured: false
};


/* ==========================================================
   3. INICIALIZAÇÃO
   ========================================================== */

document.addEventListener("DOMContentLoaded", initializeAdmin);

async function initializeAdmin() {
  try {
    state.client = resolveSupabaseClient();

    configureEvents();
    showLoading(true, "Verificando acesso administrativo...");

    await verifyAdminAccess();
    await loadPanelData();

    renderEverything();
    navigateToView(getInitialView());

    window.addEventListener("resize", handleWindowResize);
  } catch (error) {
    console.error("Erro ao iniciar painel:", error);
    handleInitializationError(error);
  } finally {
    showLoading(false);
  }
}

function resolveSupabaseClient() {
  if (window.supabaseClient) {
    return window.supabaseClient;
  }

  if (window.supabase && typeof window.supabase.from === "function") {
    return window.supabase;
  }

  if (
    window.supabase &&
    typeof window.supabase.createClient === "function" &&
    window.SUPABASE_URL &&
    window.SUPABASE_ANON_KEY
  ) {
    const client = window.supabase.createClient(
      window.SUPABASE_URL,
      window.SUPABASE_ANON_KEY
    );

    window.supabaseClient = client;
    return client;
  }

  throw new Error(
    "O cliente do Supabase não foi encontrado. Confira config.js e a ordem dos scripts no admin.html."
  );
}

function getInitialView() {
  const hash = window.location.hash.replace("#", "").trim();

  const allowedViews = [
    "dashboard",
    "scenes",
    "routes",
    "items",
    "map",
    "media",
    "tester",
    "settings"
  ];

  return allowedViews.includes(hash) ? hash : "dashboard";
}


/* ==========================================================
   4. AUTENTICAÇÃO E PERMISSÃO
   ========================================================== */

async function verifyAdminAccess() {
  const {
    data: { session },
    error: sessionError
  } = await state.client.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (!session?.user) {
    redirectToAdminLogin();
    throw new Error("Sessão administrativa não encontrada.");
  }

  state.user = session.user;

  const { data, error } = await state.client.rpc("get_admin_status");

  if (error) {
    throw error;
  }

  state.adminStatus = normalizeAdminStatus(data);

  if (!state.adminStatus.isAdmin || !state.adminStatus.isActive) {
    showAccessDenied();
    throw new Error("Este usuário não possui acesso administrativo ativo.");
  }

  renderAdminIdentity();
}

function normalizeAdminStatus(data) {
  const raw = Array.isArray(data) ? data[0] : data || {};

  return {
    isAdmin: Boolean(
      raw.is_admin ??
      raw.isAdmin ??
      raw.admin ??
      raw.allowed
    ),

    isActive: Boolean(
      raw.is_active ??
      raw.isActive ??
      raw.active ??
      true
    ),

    displayName:
      raw.display_name ??
      raw.displayName ??
      raw.name ??
      state.user?.email ??
      "Administrador"
  };
}

function renderAdminIdentity() {
  const displayName =
    state.adminStatus?.displayName ||
    state.user?.user_metadata?.display_name ||
    state.user?.email ||
    "Administrador";

  setText("sidebarUserName", displayName);
  setText("topbarUserName", displayName);
  setText("sidebarUserRole", "Administrador");
  setText("topbarUserRole", "Administrador");

  const initial = displayName.trim().charAt(0).toUpperCase() || "A";

  setText("sidebarUserAvatar", initial);
  setText("topbarUserAvatar", initial);
}

function redirectToAdminLogin() {
  const currentPath = window.location.pathname;
  const loginPath = currentPath.replace(/admin\.html?$/i, "admin-login.html");

  window.location.replace(loginPath);
}

function showAccessDenied() {
  hideElement("adminApp");
  showElement("accessDenied");
}

async function logoutAdmin() {
  try {
    showLoading(true, "Saindo...");
    await state.client.auth.signOut();
    redirectToAdminLogin();
  } catch (error) {
    handleError(error, "Não foi possível encerrar a sessão.");
  } finally {
    showLoading(false);
  }
}


/* ==========================================================
   5. CARREGAMENTO GERAL
   ========================================================== */

async function loadPanelData() {
  showLoading(true, "Carregando dados do jogo...");

  try {
    await loadGame();

    await Promise.all([
      loadRoutes(),
      loadScenes(),
      loadItems(),
      loadMediaLibrary()
    ]);

    await Promise.all([
      loadActions(),
      loadSceneItems()
    ]);

    applySceneFilters();
  } finally {
    showLoading(false);
  }
}

async function refreshAllData() {
  try {
    showLoading(true, "Atualizando painel...");
    await loadPanelData();
    renderEverything();
    toast("success", "Painel atualizado", "Os dados foram carregados novamente.");
  } catch (error) {
    handleError(error, "Não foi possível atualizar o painel.");
  } finally {
    showLoading(false);
  }
}

async function loadGame() {
  const { data, error } = await state.client
    .from(TABLES.GAMES)
    .select("*")
    .eq("slug", GAME_SLUG)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error(`O jogo "${GAME_SLUG}" não foi encontrado.`);
  }

  state.game = data;
}

async function loadRoutes() {
  let query = state.client
    .from(TABLES.ROUTES)
    .select("*")
    .eq("game_id", state.game.id);

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  state.routes = sortByMultiple(
    data || [],
    ["sort_order", "name", "title"]
  );
}

async function loadScenes() {
  const { data, error } = await state.client
    .from(TABLES.SCENES)
    .select("*")
    .eq("game_id", state.game.id);

  if (error) {
    throw error;
  }

  state.scenes = sortByMultiple(
    data || [],
    ["sort_order", "scene_order", "title"]
  );
}

async function loadActions() {
  if (!state.scenes.length) {
    state.actions = [];
    return;
  }

  const sceneIds = state.scenes.map(scene => scene.id);

  const { data, error } = await state.client
    .from(TABLES.ACTIONS)
    .select("*")
    .in("scene_id", sceneIds);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn("Tabela scene_actions ainda não existe.", error);
      state.actions = [];
      return;
    }

    throw error;
  }

  state.actions = sortByMultiple(
    data || [],
    ["sort_order", "created_at"]
  );
}

async function loadItems() {
  const { data, error } = await state.client
    .from(TABLES.ITEMS)
    .select("*")
    .eq("game_id", state.game.id);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn("Tabela items ainda não existe.", error);
      state.items = [];
      return;
    }

    throw error;
  }

  state.items = sortByMultiple(
    data || [],
    ["sort_order", "name", "title"]
  );
}

async function loadSceneItems() {
  if (!state.scenes.length) {
    state.sceneItems = [];
    return;
  }

  const sceneIds = state.scenes.map(scene => scene.id);

  const { data, error } = await state.client
    .from(TABLES.SCENE_ITEMS)
    .select("*")
    .in("scene_id", sceneIds);

  if (error) {
    if (isMissingTableError(error)) {
      console.warn("Tabela scene_items ainda não existe.", error);
      state.sceneItems = [];
      return;
    }

    throw error;
  }

  state.sceneItems = data || [];
}

async function loadMediaLibrary() {
  const { data, error } = await state.client
    .from(TABLES.MEDIA)
    .select("*")
    .eq("game_id", state.game.id)
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingTableError(error)) {
      console.warn("Tabela media_library ainda não existe.", error);
      state.media = [];
      return;
    }

    throw error;
  }

  state.media = data || [];
}


/* ==========================================================
   6. CONFIGURAÇÃO DE EVENTOS
   ========================================================== */

function configureEvents() {
  if (state.eventsConfigured) {
    return;
  }

  state.eventsConfigured = true;

  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("input", handleDocumentInput);
  document.addEventListener("change", handleDocumentChange);
  document.addEventListener("submit", handleDocumentSubmit);
  document.addEventListener("keydown", handleDocumentKeydown);

  window.addEventListener("hashchange", () => {
    const view = getInitialView();
    navigateToView(view, false);
  });

  configureMapEvents();
}

function handleDocumentClick(event) {
  const actionElement = event.target.closest("[data-action]");

  if (actionElement) {
    event.preventDefault();
    dispatchAction(actionElement.dataset.action, actionElement, event);
    return;
  }

  const navElement = event.target.closest("[data-view]");

  if (navElement) {
    event.preventDefault();
    navigateToView(navElement.dataset.view);
    return;
  }

  const tabButton = event.target.closest("[data-tab-target]");

  if (tabButton) {
    event.preventDefault();
    activateTab(tabButton);
    return;
  }

  const modalClose = event.target.closest("[data-close-modal]");

  if (modalClose) {
    closeModal(modalClose.dataset.closeModal);
    return;
  }

  if (
    event.target.classList.contains("modal") ||
    event.target.classList.contains("modal-overlay")
  ) {
    closeModal(event.target.id);
  }

  if (!event.target.closest(".dropdown")) {
    closeAllDropdowns();
  }
}

function handleDocumentInput(event) {
  const target = event.target;

  if (target.id === "sceneSearchInput") {
    state.sceneSearch = target.value;
    applySceneFilters();
    renderScenesList();
    return;
  }

  if (target.id === "mediaSearchInput") {
    state.mediaSearch = target.value;
    renderMediaLibrary();
    return;
  }

  if (target.matches("[data-slug-source]")) {
    syncSlugField(target);
  }

  if (target.id === "sceneTitleInput") {
    updateSceneEditorHeading();
  }

  if (target.id === "mapZoomRange") {
    setMapZoom(Number(target.value));
  }
}

function handleDocumentChange(event) {
  const target = event.target;

  if (target.id === "sceneStatusFilter") {
    state.sceneStatusFilter = target.value;
    applySceneFilters();
    renderScenesList();
    return;
  }

  if (target.id === "sceneRouteFilter") {
    state.sceneRouteFilter = target.value;
    applySceneFilters();
    renderScenesList();
    return;
  }

  if (target.id === "mediaTypeFilter") {
    state.mediaFilter = target.value;
    renderMediaLibrary();
    return;
  }

  if (target.id === "mediaUploadInput") {
    uploadSelectedMedia(target);
    return;
  }

  if (target.id === "sceneRouteInput") {
    updateSceneRoutePreview(target.value);
  }
}

function handleDocumentSubmit(event) {
  const form = event.target;

  if (form.id === "sceneForm") {
    event.preventDefault();
    saveScene(form);
    return;
  }

  if (form.id === "actionForm") {
    event.preventDefault();
    saveAction(form);
    return;
  }

  if (form.id === "routeForm") {
    event.preventDefault();
    saveRoute(form);
    return;
  }

  if (form.id === "itemForm") {
    event.preventDefault();
    saveItem(form);
    return;
  }

  if (form.id === "gameSettingsForm") {
    event.preventDefault();
    saveGameSettings(form);
  }
}

function handleDocumentKeydown(event) {
  if (event.key === "Escape") {
    closeTopModal();
    cancelMapConnection();
  }

  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "s"
  ) {
    const sceneModal = getElement("sceneModal");

    if (sceneModal?.classList.contains("open")) {
      event.preventDefault();
      getElement("sceneForm")?.requestSubmit();
    }
  }

  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "k"
  ) {
    event.preventDefault();

    const input =
      getElement("sceneSearchInput") ||
      getElement("mediaSearchInput");

    input?.focus();
  }
}

function dispatchAction(action, element, event) {
  const id = element.dataset.id;
  const sceneId = element.dataset.sceneId;
  const targetId = element.dataset.target;

  const actions = {
    "refresh-all": refreshAllData,

    "toggle-sidebar": toggleSidebar,
    "close-sidebar": closeSidebar,

    "logout": logoutAdmin,

    "new-scene": openNewSceneModal,
    "edit-scene": () => openEditSceneModal(id),
    "select-scene": () => selectScene(id),
    "duplicate-scene": () => duplicateScene(id),
    "toggle-scene": () => toggleSceneStatus(id),
    "delete-scene": () => requestDeleteScene(id),
    "manage-actions": () => openActionsModal(id),

    "new-action": () => openNewActionModal(sceneId || state.actionsSceneId),
    "edit-action": () => openEditActionModal(id),
    "duplicate-action": () => duplicateAction(id),
    "toggle-action": () => toggleActionStatus(id),
    "delete-action": () => requestDeleteAction(id),

    "new-route": openNewRouteModal,
    "edit-route": () => openEditRouteModal(id),
    "duplicate-route": () => duplicateRoute(id),
    "toggle-route": () => toggleRouteStatus(id),
    "delete-route": () => requestDeleteRoute(id),

    "new-item": openNewItemModal,
    "edit-item": () => openEditItemModal(id),
    "duplicate-item": () => duplicateItem(id),
    "toggle-item": () => toggleItemStatus(id),
    "delete-item": () => requestDeleteItem(id),

    "open-media-library": () =>
      openMediaLibrary(element.dataset.inputTarget || null),

    "trigger-media-upload": () =>
      getElement("mediaUploadInput")?.click(),

    "select-media": () => selectMedia(id),
    "use-selected-media": useSelectedMedia,
    "copy-media-url": () => copyMediaUrl(id),
    "delete-media": () => requestDeleteMedia(id),

    "map-reset": resetMapView,
    "map-fit": fitMapToScenes,
    "map-zoom-in": () => setMapZoom(state.map.zoom + MAP_CONFIG.zoomStep),
    "map-zoom-out": () => setMapZoom(state.map.zoom - MAP_CONFIG.zoomStep),
    "map-save": saveAllMapPositions,
    "map-select-scene": () => focusMapScene(id),
    "map-edit-scene": () => openEditSceneModal(id),
    "map-center-scene": () => centerMapOnScene(id),

    "tester-start": startGameTester,
    "tester-send": sendTesterCommand,
    "tester-clear": clearTester,

    "open-modal": () => openModal(targetId),
    "close-modal": () => closeModal(targetId),

    "confirm-delete": executePendingConfirmation,

    "copy-text": () => copyText(element.dataset.text || ""),

    "toggle-dropdown": () => toggleDropdown(element.closest(".dropdown"))
  };

  const handler = actions[action];

  if (!handler) {
    console.warn(`Ação não cadastrada: ${action}`);
    return;
  }

  try {
    handler(event);
  } catch (error) {
    handleError(error);
  }
}


/* ==========================================================
   7. NAVEGAÇÃO
   ========================================================== */

function navigateToView(viewName, updateHash = true) {
  const target =
    getElement(`view-${viewName}`) ||
    document.querySelector(`[data-view-panel="${viewName}"]`);

  if (!target) {
    console.warn(`A visualização "${viewName}" não existe.`);
    return;
  }

  state.currentView = viewName;

  document
    .querySelectorAll(".admin-section, .admin-page, .view")
    .forEach(section => {
      section.classList.remove("active");
    });

  target.classList.add("active");

  document.querySelectorAll("[data-view]").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.view === viewName
    );
  });

  const titles = {
    dashboard: ["Visão geral", "Resumo do projeto e da estrutura do jogo."],
    scenes: ["Cenas", "Crie e organize todas as cenas da aventura."],
    routes: ["Rotas", "Controle caminhos narrativos e agrupamentos."],
    items: ["Inventário", "Cadastre os itens disponíveis no jogo."],
    map: ["Mapa narrativo", "Visualize e organize as conexões entre as cenas."],
    media: ["Biblioteca de mídias", "Imagens, GIFs e áudios usados no jogo."],
    tester: ["Testador", "Teste comandos e navegação sem sair do painel."],
    settings: ["Configurações", "Configurações gerais do jogo."]
  };

  const [title, subtitle] = titles[viewName] || [viewName, ""];

  setText("topbarTitle", title);
  setText("topbarSubtitle", subtitle);

  if (updateHash) {
    history.replaceState(null, "", `#${viewName}`);
  }

  if (viewName === "map") {
    requestAnimationFrame(() => {
      renderMap();
    });
  }

  if (viewName === "media") {
    renderMediaLibrary();
  }

  closeSidebar();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function activateTab(button) {
  const targetSelector = button.dataset.tabTarget;
  const group = button.closest("[data-tabs-group]") || document;

  group.querySelectorAll("[data-tab-target]").forEach(item => {
    item.classList.remove("active");
    item.setAttribute("aria-selected", "false");
  });

  group.querySelectorAll(".tab-panel, .tab-content").forEach(panel => {
    panel.classList.remove("active");
  });

  button.classList.add("active");
  button.setAttribute("aria-selected", "true");

  const panel = getElement(targetSelector) || document.querySelector(targetSelector);
  panel?.classList.add("active");
}


/* ==========================================================
   8. RENDERIZAÇÃO GERAL
   ========================================================== */

function renderEverything() {
  renderDashboard();
  renderSceneFilters();
  renderScenesList();
  renderRoutes();
  renderItems();
  renderMediaLibrary();
  renderMap();
  renderGameSettings();
}

function renderDashboard() {
  setText("statScenes", state.scenes.length);

  setText(
    "statActiveScenes",
    state.scenes.filter(scene => getEnabled(scene)).length
  );

  setText("statRoutes", state.routes.length);
  setText("statItems", state.items.length);
  setText("statMedia", state.media.length);

  const actionsTotal = state.actions.length;
  setText("statActions", actionsTotal);

  renderRecentScenes();
  renderDashboardRoutes();
  renderDashboardWarnings();
}

function renderRecentScenes() {
  const container = getElement("dashboardRecentScenes");

  if (!container) {
    return;
  }

  const scenes = [...state.scenes]
    .sort((a, b) => {
      const aDate = new Date(a.updated_at || a.created_at || 0);
      const bDate = new Date(b.updated_at || b.created_at || 0);
      return bDate - aDate;
    })
    .slice(0, 6);

  if (!scenes.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma cena cadastrada",
      "Crie a primeira cena para começar a construir a aventura.",
      "new-scene",
      "Criar primeira cena"
    );
    return;
  }

  container.innerHTML = scenes
    .map(scene => {
      const actionCount = getSceneActions(scene.id).length;

      return `
        <div class="dashboard-list-item">
          <div class="dashboard-list-icon">◈</div>

          <div class="dashboard-list-copy">
            <div class="dashboard-list-title">
              ${escapeHtml(scene.title || "Cena sem título")}
            </div>

            <div class="dashboard-list-description">
              ${actionCount} ${actionCount === 1 ? "ação" : "ações"} ·
              ${getEnabled(scene) ? "Ativa" : "Inativa"}
            </div>
          </div>

          <button
            class="btn btn-sm btn-ghost"
            data-action="edit-scene"
            data-id="${escapeAttribute(scene.id)}"
            type="button"
          >
            Editar
          </button>
        </div>
      `;
    })
    .join("");
}

function renderDashboardRoutes() {
  const container = getElement("dashboardRoutes");

  if (!container) {
    return;
  }

  if (!state.routes.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma rota cadastrada",
      "Rotas ajudam a organizar caminhos diferentes da história.",
      "new-route",
      "Criar rota"
    );
    return;
  }

  container.innerHTML = state.routes
    .slice(0, 6)
    .map(route => {
      const sceneCount = state.scenes.filter(
        scene => String(scene.route_id || "") === String(route.id)
      ).length;

      return `
        <div class="dashboard-list-item">
          <div
            class="dashboard-list-icon"
            style="color:${escapeAttribute(getRouteColor(route))}"
          >
            ●
          </div>

          <div class="dashboard-list-copy">
            <div class="dashboard-list-title">
              ${escapeHtml(getRouteName(route))}
            </div>

            <div class="dashboard-list-description">
              ${sceneCount} ${sceneCount === 1 ? "cena" : "cenas"}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderDashboardWarnings() {
  const container = getElement("dashboardWarnings");

  if (!container) {
    return;
  }

  const warnings = [];

  if (!state.scenes.length) {
    warnings.push("O jogo ainda não possui cenas.");
  }

  if (!state.scenes.some(scene => getSceneStart(scene))) {
    warnings.push("Nenhuma cena foi marcada como cena inicial.");
  }

  const scenesWithoutActions = state.scenes.filter(
    scene =>
      getEnabled(scene) &&
      !getSceneEnding(scene) &&
      getSceneActions(scene.id).length === 0
  );

  if (scenesWithoutActions.length) {
    warnings.push(
      `${scenesWithoutActions.length} cena(s) ativa(s) não possuem ações cadastradas.`
    );
  }

  if (!warnings.length) {
    container.innerHTML = `
      <div class="alert alert-success">
        Não encontramos problemas importantes na estrutura atual.
      </div>
    `;
    return;
  }

  container.innerHTML = warnings
    .map(message => `
      <div class="alert alert-warning">
        ${escapeHtml(message)}
      </div>
    `)
    .join("");
}


/* ==========================================================
   9. FILTROS E LISTAGEM DE CENAS
   ========================================================== */

function renderSceneFilters() {
  const routeSelect = getElement("sceneRouteFilter");

  if (routeSelect) {
    const currentValue = routeSelect.value || state.sceneRouteFilter;

    routeSelect.innerHTML = `
      <option value="all">Todas as rotas</option>
      <option value="none">Sem rota</option>
      ${state.routes
        .map(route => `
          <option value="${escapeAttribute(route.id)}">
            ${escapeHtml(getRouteName(route))}
          </option>
        `)
        .join("")}
    `;

    routeSelect.value = currentValue;
  }

  populateRouteSelect("sceneRouteInput", true);
  populateSceneSelect("actionDestinationSceneInput", true);
  populateItemSelect("actionItemInput", true);
}

function applySceneFilters() {
  const search = normalizeText(state.sceneSearch);

  state.filteredScenes = state.scenes.filter(scene => {
    const sceneText = normalizeText([
      scene.title,
      scene.scene_key,
      scene.slug,
      scene.admin_description,
      scene.fallback_text
    ].join(" "));

    const matchesSearch =
      !search ||
      sceneText.includes(search);

    const isEnabled = getEnabled(scene);

    const matchesStatus =
      state.sceneStatusFilter === "all" ||
      (state.sceneStatusFilter === "active" && isEnabled) ||
      (state.sceneStatusFilter === "inactive" && !isEnabled) ||
      (state.sceneStatusFilter === "ending" && getSceneEnding(scene));

    const routeId = String(scene.route_id || "");

    const matchesRoute =
      state.sceneRouteFilter === "all" ||
      (state.sceneRouteFilter === "none" && !routeId) ||
      routeId === String(state.sceneRouteFilter);

    return matchesSearch && matchesStatus && matchesRoute;
  });
}

function renderScenesList() {
  const container = getElement("scenesList");

  if (!container) {
    return;
  }

  setText("scenesCount", state.filteredScenes.length);

  if (!state.filteredScenes.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma cena encontrada",
      state.scenes.length
        ? "Tente mudar os filtros ou o termo pesquisado."
        : "Crie a primeira cena para iniciar o jogo.",
      "new-scene",
      "Nova cena"
    );
    return;
  }

  container.innerHTML = state.filteredScenes
    .map((scene, index) => createSceneCard(scene, index))
    .join("");
}

function createSceneCard(scene, index) {
  const selected =
    String(state.editingSceneId || "") === String(scene.id);

  const enabled = getEnabled(scene);
  const route = getRoute(scene.route_id);
  const actions = getSceneActions(scene.id);

  return `
    <article
      class="scene-card ${selected ? "active selected" : ""} ${enabled ? "" : "inactive"}"
      data-action="select-scene"
      data-id="${escapeAttribute(scene.id)}"
    >
      <div
        class="scene-card-order"
        style="${
          route
            ? `color:${escapeAttribute(getRouteColor(route))};
               border-color:${escapeAttribute(getRouteColor(route))};`
            : ""
        }"
      >
        ${Number(scene.sort_order ?? scene.scene_order ?? index + 1)}
      </div>

      <div class="scene-card-content">
        <div class="scene-card-title">
          ${escapeHtml(scene.title || "Cena sem título")}
        </div>

        <div class="scene-card-slug">
          ${escapeHtml(scene.scene_key || scene.slug || "sem-chave")}
        </div>

        <div class="scene-card-preview">
          ${escapeHtml(
            truncateText(
              scene.admin_description ||
              scene.fallback_text ||
              "Sem descrição administrativa.",
              150
            )
          )}
        </div>

        <div class="scene-card-meta">
          ${
            route
              ? createBadge(
                  getRouteName(route),
                  "badge-primary",
                  getRouteColor(route)
                )
              : createBadge("Sem rota")
          }

          ${createBadge(
            `${actions.length} ${actions.length === 1 ? "ação" : "ações"}`,
            "badge-info"
          )}

          ${
            getSceneEnding(scene)
              ? createBadge("Final", "badge-purple")
              : ""
          }

          ${
            getSceneStart(scene)
              ? createBadge("Início", "badge-success")
              : ""
          }
        </div>
      </div>

      <div class="scene-card-actions">
        <button
          class="icon-button"
          data-action="edit-scene"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="Editar cena"
          type="button"
        >
          ✎
        </button>

        <button
          class="icon-button"
          data-action="manage-actions"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="Ações da cena"
          type="button"
        >
          ⚡
        </button>

        <button
          class="icon-button"
          data-action="duplicate-scene"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="Duplicar cena"
          type="button"
        >
          ⧉
        </button>

        <button
          class="icon-button"
          data-action="toggle-scene"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="${enabled ? "Desativar" : "Ativar"} cena"
          type="button"
        >
          ${enabled ? "◉" : "○"}
        </button>

        <button
          class="icon-button danger"
          data-action="delete-scene"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="Excluir cena"
          type="button"
        >
          ×
        </button>
      </div>
    </article>
  `;
}

function selectScene(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    toast("error", "Cena não encontrada");
    return;
  }

  state.editingSceneId = scene.id;
  renderScenesList();
  openEditSceneModal(scene.id);
}


/* ==========================================================
   10. CRUD DE CENAS
   ========================================================== */

function openNewSceneModal() {
  state.editingSceneId = null;

  resetForm("sceneForm");
  setText("sceneModalTitle", "Nova cena");
  setText(
    "sceneModalDescription",
    "Cadastre uma nova parte da aventura."
  );

  populateRouteSelect("sceneRouteInput", true);

  setInputValue("sceneIdInput", "");
  setInputValue("sceneTitleInput", "");
  setInputValue("sceneKeyInput", "");
  setInputValue("sceneDescriptionInput", "");
  setInputValue("sceneFallbackTextInput", "");
  setInputValue("sceneHelpModeInput", "default");
  setInputValue("sceneHelpTextInput", "");
  setInputValue("sceneRouteInput", "");
  setInputValue("sceneSortOrderInput", getNextSceneOrder());
  setInputValue("sceneEndingTypeInput", "");
  setInputValue("sceneImageUrlInput", "");
  setInputValue("sceneAudioUrlInput", "");
  setInputValue("sceneMapXInput", getNextMapPosition().x);
  setInputValue("sceneMapYInput", getNextMapPosition().y);

  setCheckboxValue("sceneEnabledInput", true);
  setCheckboxValue("sceneStartInput", state.scenes.length === 0);
  setCheckboxValue("sceneEndingInput", false);
  setCheckboxValue("sceneAllowRepeatInput", true);
  setCheckboxValue("sceneAllowInventoryInput", true);
  setCheckboxValue("sceneAllowHistoryInput", true);
  setCheckboxValue("sceneAllowMapInput", true);

  updateSceneEditorHeading();
  updateMediaPreview("sceneImageUrlInput", "sceneImagePreview");
  updateAudioPreview("sceneAudioUrlInput", "sceneAudioPreview");

  openModal("sceneModal");
}

function openEditSceneModal(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    toast("error", "Cena não encontrada");
    return;
  }

  state.editingSceneId = scene.id;

  resetForm("sceneForm");

  setText("sceneModalTitle", "Editar cena");
  setText(
    "sceneModalDescription",
    "Atualize o conteúdo, as permissões e a posição no mapa."
  );

  populateRouteSelect("sceneRouteInput", true);

  setInputValue("sceneIdInput", scene.id);
  setInputValue("sceneTitleInput", scene.title || "");
  setInputValue("sceneKeyInput", scene.scene_key || scene.slug || "");

  setInputValue(
    "sceneDescriptionInput",
    scene.admin_description || scene.description || ""
  );

  setInputValue(
    "sceneFallbackTextInput",
    scene.fallback_text || scene.text || ""
  );

  setInputValue(
    "sceneHelpModeInput",
    scene.help_mode || "default"
  );

  setInputValue("sceneHelpTextInput", scene.help_text || "");
  setInputValue("sceneRouteInput", scene.route_id || "");

  setInputValue(
    "sceneSortOrderInput",
    scene.sort_order ?? scene.scene_order ?? 0
  );

  setInputValue(
    "sceneEndingTypeInput",
    scene.ending_type || ""
  );

  setInputValue(
    "sceneImageUrlInput",
    scene.image_url || scene.background_url || ""
  );

  setInputValue(
    "sceneAudioUrlInput",
    scene.audio_url || scene.sound_url || ""
  );

  setInputValue(
    "sceneMapXInput",
    getSceneMapX(scene)
  );

  setInputValue(
    "sceneMapYInput",
    getSceneMapY(scene)
  );

  setCheckboxValue("sceneEnabledInput", getEnabled(scene));
  setCheckboxValue("sceneStartInput", getSceneStart(scene));
  setCheckboxValue("sceneEndingInput", getSceneEnding(scene));

  setCheckboxValue(
    "sceneAllowRepeatInput",
    scene.allow_repeat !== false
  );

  setCheckboxValue(
    "sceneAllowInventoryInput",
    scene.allow_inventory !== false
  );

  setCheckboxValue(
    "sceneAllowHistoryInput",
    scene.allow_history !== false
  );

  setCheckboxValue(
    "sceneAllowMapInput",
    scene.allow_map !== false
  );

  updateSceneEditorHeading();
  updateMediaPreview("sceneImageUrlInput", "sceneImagePreview");
  updateAudioPreview("sceneAudioUrlInput", "sceneAudioPreview");

  openModal("sceneModal");
}

async function saveScene(form) {
  const formData = new FormData(form);
  const sceneId = cleanValue(formData.get("id"));

  const title = cleanValue(formData.get("title"));

  if (!title) {
    toast("warning", "Título obrigatório", "Informe um título para a cena.");
    getElement("sceneTitleInput")?.focus();
    return;
  }

  const sceneKey =
    slugify(cleanValue(formData.get("scene_key")) || title);

  const isStart = formData.has("is_start");
  const isEnding = formData.has("is_ending");

  const payload = removeUndefinedValues({
    game_id: state.game.id,

    title,
    scene_key: sceneKey,

    admin_description:
      cleanValue(formData.get("admin_description")),

    fallback_text:
      cleanValue(formData.get("fallback_text")),

    help_mode:
      cleanValue(formData.get("help_mode")) || "default",

    help_text:
      cleanValue(formData.get("help_text")),

    route_id:
      cleanValue(formData.get("route_id")) || null,

    sort_order:
      toInteger(formData.get("sort_order"), getNextSceneOrder()),

    is_start: isStart,
    is_ending: isEnding,

    ending_type:
      isEnding
        ? cleanValue(formData.get("ending_type")) || "default"
        : null,

    is_enabled:
      formData.has("is_enabled"),

    allow_repeat:
      formData.has("allow_repeat"),

    allow_inventory:
      formData.has("allow_inventory"),

    allow_history:
      formData.has("allow_history"),

    allow_map:
      formData.has("allow_map"),

    image_url:
      cleanValue(formData.get("image_url")) || null,

    audio_url:
      cleanValue(formData.get("audio_url")) || null,

    map_x:
      toNumber(formData.get("map_x"), 100),

    map_y:
      toNumber(formData.get("map_y"), 100),

    updated_at: new Date().toISOString()
  });

  try {
    showLoading(true, sceneId ? "Salvando cena..." : "Criando cena...");

    if (isStart) {
      await removeStartFlagFromOtherScenes(sceneId);
    }

    let savedScene;

    if (sceneId) {
      const { data, error } = await state.client
        .from(TABLES.SCENES)
        .update(payload)
        .eq("id", sceneId)
        .eq("game_id", state.game.id)
        .select()
        .single();

      if (error) {
        throw error;
      }

      savedScene = data;
    } else {
      const { data, error } = await state.client
        .from(TABLES.SCENES)
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      savedScene = data;
    }

    state.editingSceneId = savedScene.id;

    await Promise.all([
      loadScenes(),
      loadActions(),
      loadSceneItems()
    ]);

    applySceneFilters();
    renderEverything();

    closeModal("sceneModal");

    toast(
      "success",
      sceneId ? "Cena atualizada" : "Cena criada",
      `"${savedScene.title}" foi salva com sucesso.`
    );
  } catch (error) {
    handleError(error, "Não foi possível salvar a cena.");
  } finally {
    showLoading(false);
  }
}

async function removeStartFlagFromOtherScenes(currentSceneId) {
  let query = state.client
    .from(TABLES.SCENES)
    .update({ is_start: false })
    .eq("game_id", state.game.id)
    .eq("is_start", true);

  if (currentSceneId) {
    query = query.neq("id", currentSceneId);
  }

  const { error } = await query;

  if (error && !isMissingColumnError(error)) {
    throw error;
  }
}

async function duplicateScene(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    return;
  }

  try {
    showLoading(true, "Duplicando cena...");

    const payload = stripDatabaseFields(scene);

    delete payload.id;

    payload.title = `${scene.title || "Cena"} — cópia`;
    payload.scene_key = await createUniqueSceneKey(
      `${scene.scene_key || slugify(scene.title)}-copia`
    );

    payload.is_start = false;
    payload.sort_order = getNextSceneOrder();
    payload.map_x = getSceneMapX(scene) + 50;
    payload.map_y = getSceneMapY(scene) + 50;
    payload.created_at = new Date().toISOString();
    payload.updated_at = new Date().toISOString();

    const { data: copiedScene, error } = await state.client
      .from(TABLES.SCENES)
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw error;
    }

    const originalActions = getSceneActions(scene.id);

    if (originalActions.length) {
      const copiedActions = originalActions.map((action, index) => {
        const copy = stripDatabaseFields(action);

        delete copy.id;

        return {
          ...copy,
          scene_id: copiedScene.id,
          sort_order: action.sort_order ?? index + 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      });

      const { error: actionsError } = await state.client
        .from(TABLES.ACTIONS)
        .insert(copiedActions);

      if (actionsError && !isMissingTableError(actionsError)) {
        throw actionsError;
      }
    }

    await Promise.all([loadScenes(), loadActions()]);

    applySceneFilters();
    renderEverything();

    toast(
      "success",
      "Cena duplicada",
      `A cópia de "${scene.title}" foi criada.`
    );
  } catch (error) {
    handleError(error, "Não foi possível duplicar a cena.");
  } finally {
    showLoading(false);
  }
}

async function toggleSceneStatus(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    return;
  }

  const nextStatus = !getEnabled(scene);

  try {
    const { error } = await state.client
      .from(TABLES.SCENES)
      .update({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", scene.id);

    if (error) {
      throw error;
    }

    scene.is_enabled = nextStatus;

    applySceneFilters();
    renderEverything();

    toast(
      "success",
      nextStatus ? "Cena ativada" : "Cena desativada",
      `"${scene.title}" agora está ${nextStatus ? "ativa" : "inativa"}.`
    );
  } catch (error) {
    handleError(error, "Não foi possível alterar o status da cena.");
  }
}

function requestDeleteScene(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    return;
  }

  openConfirmation({
    title: "Excluir cena?",
    message:
      `A cena "${scene.title}" e suas ações serão excluídas. ` +
      "Esta operação não poderá ser desfeita.",
    confirmLabel: "Excluir cena",
    confirmType: "danger",
    onConfirm: () => deleteScene(scene.id)
  });
}

async function deleteScene(sceneId) {
  try {
    showLoading(true, "Excluindo cena...");

    await state.client
      .from(TABLES.ACTIONS)
      .delete()
      .eq("scene_id", sceneId);

    await state.client
      .from(TABLES.SCENE_ITEMS)
      .delete()
      .eq("scene_id", sceneId);

    const { error } = await state.client
      .from(TABLES.SCENES)
      .delete()
      .eq("id", sceneId)
      .eq("game_id", state.game.id);

    if (error) {
      throw error;
    }

    if (String(state.editingSceneId) === String(sceneId)) {
      state.editingSceneId = null;
    }

    if (String(state.selectedMapSceneId) === String(sceneId)) {
      state.selectedMapSceneId = null;
    }

    await Promise.all([
      loadScenes(),
      loadActions(),
      loadSceneItems()
    ]);

    applySceneFilters();
    renderEverything();

    toast("success", "Cena excluída");
  } catch (error) {
    handleError(error, "Não foi possível excluir a cena.");
  } finally {
    showLoading(false);
  }
}


/* ==========================================================
   11. AÇÕES DAS CENAS
   ========================================================== */

function openActionsModal(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    toast("error", "Cena não encontrada");
    return;
  }

  state.actionsSceneId = scene.id;

  setText("actionsModalTitle", `Ações — ${scene.title}`);
  setText(
    "actionsModalDescription",
    "Cadastre palavras-chave, sinônimos, respostas e mudanças de cena."
  );

  renderActionsList();
  openModal("actionsModal");
}

function renderActionsList() {
  const container = getElement("actionsList");

  if (!container) {
    return;
  }

  const actions = getSceneActions(state.actionsSceneId);

  setText("actionsCount", actions.length);

  if (!actions.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma ação cadastrada",
      "Cadastre os comandos que o jogador poderá usar nesta cena.",
      "new-action",
      "Criar ação",
      { sceneId: state.actionsSceneId }
    );
    return;
  }

  container.innerHTML = actions
    .map((action, index) => createActionCard(action, index))
    .join("");
}

function createActionCard(action, index) {
  const enabled = getEnabled(action);
  const destinationScene = getScene(
    action.destination_scene_id ||
    action.target_scene_id ||
    action.next_scene_id
  );

  const keywords = parseKeywords(
    action.keywords ||
    action.trigger_words ||
    action.aliases
  );

  const actionType = action.action_type || action.type || "response";

  return `
    <article class="action-card ${enabled ? "" : "is-disabled"}">
      <div class="action-card-header">
        <div class="action-drag-handle" title="Ordem da ação">⋮⋮</div>

        <div class="action-type-icon ${escapeAttribute(actionType)}">
          ${getActionTypeIcon(actionType)}
        </div>

        <div class="action-card-main">
          <div class="action-card-title">
            ${escapeHtml(
              action.label ||
              action.name ||
              keywords[0] ||
              `Ação ${index + 1}`
            )}
          </div>

          <div class="action-card-keywords">
            ${
              keywords.length
                ? escapeHtml(keywords.join(", "))
                : "Sem palavras-chave"
            }
          </div>
        </div>

        <div class="card-actions">
          <button
            class="icon-button"
            data-action="edit-action"
            data-id="${escapeAttribute(action.id)}"
            data-tooltip="Editar ação"
            type="button"
          >
            ✎
          </button>

          <button
            class="icon-button"
            data-action="duplicate-action"
            data-id="${escapeAttribute(action.id)}"
            data-tooltip="Duplicar ação"
            type="button"
          >
            ⧉
          </button>

          <button
            class="icon-button"
            data-action="toggle-action"
            data-id="${escapeAttribute(action.id)}"
            data-tooltip="${enabled ? "Desativar" : "Ativar"} ação"
            type="button"
          >
            ${enabled ? "◉" : "○"}
          </button>

          <button
            class="icon-button danger"
            data-action="delete-action"
            data-id="${escapeAttribute(action.id)}"
            data-tooltip="Excluir ação"
            type="button"
          >
            ×
          </button>
        </div>
      </div>

      <div class="action-card-body">
        <div class="route-flow">
          <span>${escapeHtml(getActionTypeLabel(actionType))}</span>

          ${
            destinationScene
              ? `
                <span class="route-flow-arrow">→</span>
                <span class="route-flow-scene">
                  ${escapeHtml(destinationScene.title)}
                </span>
              `
              : ""
          }
        </div>

        ${
          action.response_text
            ? `
              <div class="mt-8 text-muted">
                ${escapeHtml(truncateText(action.response_text, 180))}
              </div>
            `
            : ""
        }
      </div>
    </article>
  `;
}

function openNewActionModal(sceneId = state.actionsSceneId) {
  if (!sceneId) {
    toast("warning", "Selecione uma cena");
    return;
  }

  state.editingActionId = null;
  state.actionsSceneId = sceneId;

  resetForm("actionForm");

  setText("actionModalTitle", "Nova ação");
  setText(
    "actionModalDescription",
    "Defina o que o jogador poderá escrever e o resultado do comando."
  );

  populateSceneSelect("actionDestinationSceneInput", true, sceneId);
  populateItemSelect("actionItemInput", true);

  setInputValue("actionIdInput", "");
  setInputValue("actionSceneIdInput", sceneId);
  setInputValue("actionLabelInput", "");
  setInputValue("actionTypeInput", "response");
  setInputValue("actionKeywordsInput", "");
  setInputValue("actionResponseInput", "");
  setInputValue("actionDestinationSceneInput", "");
  setInputValue("actionItemInput", "");
  setInputValue("actionSortOrderInput", getNextActionOrder(sceneId));
  setInputValue("actionConditionInput", "");
  setInputValue("actionEffectInput", "");

  setCheckboxValue("actionEnabledInput", true);
  setCheckboxValue("actionEndsGameInput", false);
  setCheckboxValue("actionConsumesItemInput", false);

  openModal("actionModal");
}

function openEditActionModal(actionId) {
  const action = getAction(actionId);

  if (!action) {
    toast("error", "Ação não encontrada");
    return;
  }

  state.editingActionId = action.id;
  state.actionsSceneId = action.scene_id;

  resetForm("actionForm");

  setText("actionModalTitle", "Editar ação");
  setText(
    "actionModalDescription",
    "Atualize os gatilhos e efeitos da ação."
  );

  populateSceneSelect(
    "actionDestinationSceneInput",
    true,
    action.scene_id
  );

  populateItemSelect("actionItemInput", true);

  setInputValue("actionIdInput", action.id);
  setInputValue("actionSceneIdInput", action.scene_id);

  setInputValue(
    "actionLabelInput",
    action.label || action.name || ""
  );

  setInputValue(
    "actionTypeInput",
    action.action_type || action.type || "response"
  );

  setInputValue(
    "actionKeywordsInput",
    parseKeywords(
      action.keywords ||
      action.trigger_words ||
      action.aliases
    ).join(", ")
  );

  setInputValue(
    "actionResponseInput",
    action.response_text || action.response || ""
  );

  setInputValue(
    "actionDestinationSceneInput",
    action.destination_scene_id ||
    action.target_scene_id ||
    action.next_scene_id ||
    ""
  );

  setInputValue(
    "actionItemInput",
    action.item_id || ""
  );

  setInputValue(
    "actionSortOrderInput",
    action.sort_order ?? 0
  );

  setInputValue(
    "actionConditionInput",
    stringifyJsonField(action.condition_data || action.conditions)
  );

  setInputValue(
    "actionEffectInput",
    stringifyJsonField(action.effect_data || action.effects)
  );

  setCheckboxValue("actionEnabledInput", getEnabled(action));
  setCheckboxValue("actionEndsGameInput", Boolean(action.ends_game));

  setCheckboxValue(
    "actionConsumesItemInput",
    Boolean(action.consumes_item)
  );

  openModal("actionModal");
}

async function saveAction(form) {
  const formData = new FormData(form);

  const actionId = cleanValue(formData.get("id"));
  const sceneId =
    cleanValue(formData.get("scene_id")) ||
    state.actionsSceneId;

  if (!sceneId) {
    toast("error", "Cena da ação não encontrada");
    return;
  }

  const keywords = parseKeywords(
    cleanValue(formData.get("keywords"))
  );

  if (!keywords.length) {
    toast(
      "warning",
      "Palavra-chave obrigatória",
      "Cadastre ao menos uma palavra ou comando."
    );

    getElement("actionKeywordsInput")?.focus();
    return;
  }

  let conditionData = null;
  let effectData = null;

  try {
    conditionData = parseOptionalJson(
      formData.get("condition_data")
    );

    effectData = parseOptionalJson(
      formData.get("effect_data")
    );
  } catch (error) {
    toast("error", "JSON inválido", error.message);
    return;
  }

  const payload = removeUndefinedValues({
    scene_id: sceneId,

    label:
      cleanValue(formData.get("label")) ||
      keywords[0],

    action_type:
      cleanValue(formData.get("action_type")) ||
      "response",

    keywords,

    response_text:
      cleanValue(formData.get("response_text")),

    destination_scene_id:
      cleanValue(formData.get("destination_scene_id")) ||
      null,

    item_id:
      cleanValue(formData.get("item_id")) ||
      null,

    condition_data: conditionData,
    effect_data: effectData,

    ends_game:
      formData.has("ends_game"),

    consumes_item:
      formData.has("consumes_item"),

    is_enabled:
      formData.has("is_enabled"),

    sort_order:
      toInteger(
        formData.get("sort_order"),
        getNextActionOrder(sceneId)
      ),

    updated_at: new Date().toISOString()
  });

  try {
    showLoading(true, actionId ? "Salvando ação..." : "Criando ação...");

    if (actionId) {
      const { error } = await state.client
        .from(TABLES.ACTIONS)
        .update(payload)
        .eq("id", actionId)
        .eq("scene_id", sceneId);

      if (error) {
        throw error;
      }
    } else {
      const { error } = await state.client
        .from(TABLES.ACTIONS)
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }
    }

    await loadActions();

    renderActionsList();
    renderScenesList();
    renderDashboard();

    closeModal("actionModal");

    toast(
      "success",
      actionId ? "Ação atualizada" : "Ação criada"
    );
  } catch (error) {
    handleError(error, "Não foi possível salvar a ação.");
  } finally {
    showLoading(false);
  }
}

async function duplicateAction(actionId) {
  const action = getAction(actionId);

  if (!action) {
    return;
  }

  try {
    const payload = stripDatabaseFields(action);

    delete payload.id;

    payload.label = `${action.label || "Ação"} — cópia`;
    payload.sort_order = getNextActionOrder(action.scene_id);
    payload.created_at = new Date().toISOString();
    payload.updated_at = new Date().toISOString();

    const { error } = await state.client
      .from(TABLES.ACTIONS)
      .insert(payload);

    if (error) {
      throw error;
    }

    await loadActions();
    renderActionsList();
    renderScenesList();

    toast("success", "Ação duplicada");
  } catch (error) {
    handleError(error, "Não foi possível duplicar a ação.");
  }
}

async function toggleActionStatus(actionId) {
  const action = getAction(actionId);

  if (!action) {
    return;
  }

  const nextStatus = !getEnabled(action);

  try {
    const { error } = await state.client
      .from(TABLES.ACTIONS)
      .update({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", action.id);

    if (error) {
      throw error;
    }

    action.is_enabled = nextStatus;

    renderActionsList();
    renderScenesList();

    toast(
      "success",
      nextStatus ? "Ação ativada" : "Ação desativada"
    );
  } catch (error) {
    handleError(error, "Não foi possível alterar a ação.");
  }
}

function requestDeleteAction(actionId) {
  const action = getAction(actionId);

  if (!action) {
    return;
  }

  openConfirmation({
    title: "Excluir ação?",
    message:
      `A ação "${action.label || "Sem nome"}" será removida permanentemente.`,
    confirmLabel: "Excluir ação",
    confirmType: "danger",
    onConfirm: () => deleteAction(action.id)
  });
}

async function deleteAction(actionId) {
  try {
    const { error } = await state.client
      .from(TABLES.ACTIONS)
      .delete()
      .eq("id", actionId);

    if (error) {
      throw error;
    }

    await loadActions();
    renderActionsList();
    renderScenesList();
    renderDashboard();

    toast("success", "Ação excluída");
  } catch (error) {
    handleError(error, "Não foi possível excluir a ação.");
  }
}


/* ==========================================================
   12. ROTAS
   ========================================================== */

function renderRoutes() {
  const container = getElement("routesList");

  if (!container) {
    return;
  }

  setText("routesCount", state.routes.length);

  if (!state.routes.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma rota cadastrada",
      "Crie rotas para organizar caminhos, capítulos ou núcleos da história.",
      "new-route",
      "Criar rota"
    );
    return;
  }

  container.innerHTML = state.routes
    .map(route => createRouteCard(route))
    .join("");
}

function createRouteCard(route) {
  const enabled = getEnabled(route);

  const scenes = state.scenes.filter(
    scene => String(scene.route_id || "") === String(route.id)
  );

  return `
    <article
      class="route-card ${enabled ? "" : "is-disabled"}"
      style="--route-color:${escapeAttribute(getRouteColor(route))}"
    >
      <div class="route-color-bar"></div>

      <div class="route-card-main">
        <div class="route-card-header">
          <span class="route-color-preview"></span>

          <div class="route-card-name">
            ${escapeHtml(getRouteName(route))}
          </div>

          ${
            enabled
              ? createBadge("Ativa", "badge-success")
              : createBadge("Inativa", "badge-danger")
          }
        </div>

        <div class="route-card-description">
          ${escapeHtml(
            route.description ||
            route.admin_description ||
            "Sem descrição."
          )}
        </div>

        <div class="route-card-meta">
          ${createBadge(
            `${scenes.length} ${scenes.length === 1 ? "cena" : "cenas"}`,
            "badge-info"
          )}

          ${
            route.is_default
              ? createBadge("Principal", "badge-primary")
              : ""
          }
        </div>
      </div>

      <div class="route-card-actions">
        <button
          class="icon-button"
          data-action="edit-route"
          data-id="${escapeAttribute(route.id)}"
          data-tooltip="Editar rota"
          type="button"
        >
          ✎
        </button>

        <button
          class="icon-button"
          data-action="duplicate-route"
          data-id="${escapeAttribute(route.id)}"
          data-tooltip="Duplicar rota"
          type="button"
        >
          ⧉
        </button>

        <button
          class="icon-button"
          data-action="toggle-route"
          data-id="${escapeAttribute(route.id)}"
          data-tooltip="${enabled ? "Desativar" : "Ativar"} rota"
          type="button"
        >
          ${enabled ? "◉" : "○"}
        </button>

        <button
          class="icon-button danger"
          data-action="delete-route"
          data-id="${escapeAttribute(route.id)}"
          data-tooltip="Excluir rota"
          type="button"
        >
          ×
        </button>
      </div>
    </article>
  `;
}

function openNewRouteModal() {
  state.editingRouteId = null;

  resetForm("routeForm");

  setText("routeModalTitle", "Nova rota");
  setInputValue("routeIdInput", "");
  setInputValue("routeNameInput", "");
  setInputValue("routeSlugInput", "");
  setInputValue("routeDescriptionInput", "");
  setInputValue("routeColorInput", "#c99c5d");
  setInputValue("routeSortOrderInput", state.routes.length + 1);

  setCheckboxValue("routeEnabledInput", true);
  setCheckboxValue("routeDefaultInput", state.routes.length === 0);

  openModal("routeModal");
}

function openEditRouteModal(routeId) {
  const route = getRoute(routeId);

  if (!route) {
    toast("error", "Rota não encontrada");
    return;
  }

  state.editingRouteId = route.id;

  resetForm("routeForm");

  setText("routeModalTitle", "Editar rota");

  setInputValue("routeIdInput", route.id);
  setInputValue("routeNameInput", getRouteName(route));
  setInputValue("routeSlugInput", route.slug || route.route_key || "");

  setInputValue(
    "routeDescriptionInput",
    route.description || route.admin_description || ""
  );

  setInputValue("routeColorInput", getRouteColor(route));

  setInputValue(
    "routeSortOrderInput",
    route.sort_order ?? 0
  );

  setCheckboxValue("routeEnabledInput", getEnabled(route));
  setCheckboxValue("routeDefaultInput", Boolean(route.is_default));

  openModal("routeModal");
}

async function saveRoute(form) {
  const formData = new FormData(form);
  const routeId = cleanValue(formData.get("id"));

  const name = cleanValue(formData.get("name"));

  if (!name) {
    toast("warning", "Nome obrigatório");
    getElement("routeNameInput")?.focus();
    return;
  }

  const isDefault = formData.has("is_default");

  const payload = {
    game_id: state.game.id,
    name,
    slug: slugify(cleanValue(formData.get("slug")) || name),

    description:
      cleanValue(formData.get("description")),

    color:
      cleanValue(formData.get("color")) || "#c99c5d",

    sort_order:
      toInteger(formData.get("sort_order"), state.routes.length + 1),

    is_enabled:
      formData.has("is_enabled"),

    is_default: isDefault,
    updated_at: new Date().toISOString()
  };

  try {
    showLoading(true, "Salvando rota...");

    if (isDefault) {
      let query = state.client
        .from(TABLES.ROUTES)
        .update({ is_default: false })
        .eq("game_id", state.game.id)
        .eq("is_default", true);

      if (routeId) {
        query = query.neq("id", routeId);
      }

      await query;
    }

    if (routeId) {
      const { error } = await state.client
        .from(TABLES.ROUTES)
        .update(payload)
        .eq("id", routeId);

      if (error) {
        throw error;
      }
    } else {
      const { error } = await state.client
        .from(TABLES.ROUTES)
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }
    }

    await loadRoutes();

    renderEverything();
    closeModal("routeModal");

    toast(
      "success",
      routeId ? "Rota atualizada" : "Rota criada"
    );
  } catch (error) {
    handleError(error, "Não foi possível salvar a rota.");
  } finally {
    showLoading(false);
  }
}

async function duplicateRoute(routeId) {
  const route = getRoute(routeId);

  if (!route) {
    return;
  }

  try {
    const payload = stripDatabaseFields(route);

    delete payload.id;

    payload.name = `${getRouteName(route)} — cópia`;
    payload.slug = `${route.slug || slugify(getRouteName(route))}-copia-${Date.now()}`;
    payload.is_default = false;
    payload.sort_order = state.routes.length + 1;
    payload.created_at = new Date().toISOString();
    payload.updated_at = new Date().toISOString();

    const { error } = await state.client
      .from(TABLES.ROUTES)
      .insert(payload);

    if (error) {
      throw error;
    }

    await loadRoutes();
    renderEverything();

    toast("success", "Rota duplicada");
  } catch (error) {
    handleError(error, "Não foi possível duplicar a rota.");
  }
}

async function toggleRouteStatus(routeId) {
  const route = getRoute(routeId);

  if (!route) {
    return;
  }

  const nextStatus = !getEnabled(route);

  try {
    const { error } = await state.client
      .from(TABLES.ROUTES)
      .update({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", route.id);

    if (error) {
      throw error;
    }

    route.is_enabled = nextStatus;

    renderEverything();

    toast(
      "success",
      nextStatus ? "Rota ativada" : "Rota desativada"
    );
  } catch (error) {
    handleError(error, "Não foi possível alterar a rota.");
  }
}

function requestDeleteRoute(routeId) {
  const route = getRoute(routeId);

  if (!route) {
    return;
  }

  const sceneCount = state.scenes.filter(
    scene => String(scene.route_id || "") === String(route.id)
  ).length;

  openConfirmation({
    title: "Excluir rota?",
    message:
      sceneCount > 0
        ? `A rota "${getRouteName(route)}" possui ${sceneCount} cena(s). As cenas continuarão existindo, mas ficarão sem rota.`
        : `A rota "${getRouteName(route)}" será excluída.`,
    confirmLabel: "Excluir rota",
    confirmType: "danger",
    onConfirm: () => deleteRoute(route.id)
  });
}

async function deleteRoute(routeId) {
  try {
    showLoading(true, "Excluindo rota...");

    const { error: sceneError } = await state.client
      .from(TABLES.SCENES)
      .update({
        route_id: null,
        updated_at: new Date().toISOString()
      })
      .eq("route_id", routeId);

    if (sceneError) {
      throw sceneError;
    }

    const { error } = await state.client
      .from(TABLES.ROUTES)
      .delete()
      .eq("id", routeId);

    if (error) {
      throw error;
    }

    await Promise.all([loadRoutes(), loadScenes()]);

    applySceneFilters();
    renderEverything();

    toast("success", "Rota excluída");
  } catch (error) {
    handleError(error, "Não foi possível excluir a rota.");
  } finally {
    showLoading(false);
  }
}


/* ==========================================================
   13. ITENS E INVENTÁRIO
   ========================================================== */

function renderItems() {
  const container = getElement("itemsGrid");

  if (!container) {
    return;
  }

  setText("itemsCount", state.items.length);

  if (!state.items.length) {
    container.innerHTML = createEmptyState(
      "Nenhum item cadastrado",
      "Cadastre objetos, documentos, chaves e outros itens da aventura.",
      "new-item",
      "Criar item"
    );
    return;
  }

  container.innerHTML = state.items
    .map(item => createItemCard(item))
    .join("");
}

function createItemCard(item) {
  const enabled = getEnabled(item);
  const itemName = item.name || item.title || "Item sem nome";
  const rarity = item.rarity || "common";

  return `
    <article class="item-card ${enabled ? "" : "inactive"}">
      <div class="item-card-header">
        <div class="item-card-icon">
          ${
            item.image_url
              ? `
                <img
                  src="${escapeAttribute(item.image_url)}"
                  alt="${escapeAttribute(itemName)}"
                >
              `
              : "◆"
          }
        </div>

        <div class="item-card-copy">
          <div class="item-card-title">
            ${escapeHtml(itemName)}
          </div>

          <div class="item-card-slug">
            ${escapeHtml(item.slug || item.item_key || "sem-chave")}
          </div>
        </div>
      </div>

      <div class="item-card-description">
        ${escapeHtml(item.description || "Sem descrição.")}
      </div>

      <div class="item-card-footer">
        <span class="badge item-rarity-${escapeAttribute(rarity)}">
          ${escapeHtml(getRarityLabel(rarity))}
        </span>

        <div class="card-actions">
          <button
            class="icon-button"
            data-action="edit-item"
            data-id="${escapeAttribute(item.id)}"
            data-tooltip="Editar item"
            type="button"
          >
            ✎
          </button>

          <button
            class="icon-button"
            data-action="duplicate-item"
            data-id="${escapeAttribute(item.id)}"
            data-tooltip="Duplicar item"
            type="button"
          >
            ⧉
          </button>

          <button
            class="icon-button"
            data-action="toggle-item"
            data-id="${escapeAttribute(item.id)}"
            data-tooltip="${enabled ? "Desativar" : "Ativar"} item"
            type="button"
          >
            ${enabled ? "◉" : "○"}
          </button>

          <button
            class="icon-button danger"
            data-action="delete-item"
            data-id="${escapeAttribute(item.id)}"
            data-tooltip="Excluir item"
            type="button"
          >
            ×
          </button>
        </div>
      </div>
    </article>
  `;
}

function openNewItemModal() {
  state.editingItemId = null;

  resetForm("itemForm");

  setText("itemModalTitle", "Novo item");

  setInputValue("itemIdInput", "");
  setInputValue("itemNameInput", "");
  setInputValue("itemSlugInput", "");
  setInputValue("itemDescriptionInput", "");
  setInputValue("itemImageUrlInput", "");
  setInputValue("itemRarityInput", "common");
  setInputValue("itemSortOrderInput", state.items.length + 1);

  setCheckboxValue("itemEnabledInput", true);
  setCheckboxValue("itemUniqueInput", false);
  setCheckboxValue("itemVisibleInput", true);

  updateMediaPreview("itemImageUrlInput", "itemImagePreview");

  openModal("itemModal");
}

function openEditItemModal(itemId) {
  const item = getItem(itemId);

  if (!item) {
    toast("error", "Item não encontrado");
    return;
  }

  state.editingItemId = item.id;

  resetForm("itemForm");

  setText("itemModalTitle", "Editar item");

  setInputValue("itemIdInput", item.id);
  setInputValue("itemNameInput", item.name || item.title || "");
  setInputValue("itemSlugInput", item.slug || item.item_key || "");
  setInputValue("itemDescriptionInput", item.description || "");
  setInputValue("itemImageUrlInput", item.image_url || "");
  setInputValue("itemRarityInput", item.rarity || "common");
  setInputValue("itemSortOrderInput", item.sort_order ?? 0);

  setCheckboxValue("itemEnabledInput", getEnabled(item));
  setCheckboxValue("itemUniqueInput", Boolean(item.is_unique));

  setCheckboxValue(
    "itemVisibleInput",
    item.is_visible !== false
  );

  updateMediaPreview("itemImageUrlInput", "itemImagePreview");

  openModal("itemModal");
}

async function saveItem(form) {
  const formData = new FormData(form);
  const itemId = cleanValue(formData.get("id"));

  const name = cleanValue(formData.get("name"));

  if (!name) {
    toast("warning", "Nome obrigatório");
    getElement("itemNameInput")?.focus();
    return;
  }

  const payload = {
    game_id: state.game.id,
    name,
    slug: slugify(cleanValue(formData.get("slug")) || name),

    description:
      cleanValue(formData.get("description")),

    image_url:
      cleanValue(formData.get("image_url")) || null,

    rarity:
      cleanValue(formData.get("rarity")) || "common",

    sort_order:
      toInteger(formData.get("sort_order"), state.items.length + 1),

    is_unique:
      formData.has("is_unique"),

    is_visible:
      formData.has("is_visible"),

    is_enabled:
      formData.has("is_enabled"),

    updated_at: new Date().toISOString()
  };

  try {
    showLoading(true, "Salvando item...");

    if (itemId) {
      const { error } = await state.client
        .from(TABLES.ITEMS)
        .update(payload)
        .eq("id", itemId);

      if (error) {
        throw error;
      }
    } else {
      const { error } = await state.client
        .from(TABLES.ITEMS)
        .insert({
          ...payload,
          created_at: new Date().toISOString()
        });

      if (error) {
        throw error;
      }
    }

    await loadItems();

    renderItems();
    renderDashboard();
    populateItemSelect("actionItemInput", true);

    closeModal("itemModal");

    toast(
      "success",
      itemId ? "Item atualizado" : "Item criado"
    );
  } catch (error) {
    handleError(error, "Não foi possível salvar o item.");
  } finally {
    showLoading(false);
  }
}

async function duplicateItem(itemId) {
  const item = getItem(itemId);

  if (!item) {
    return;
  }

  try {
    const payload = stripDatabaseFields(item);

    delete payload.id;

    payload.name = `${item.name || "Item"} — cópia`;
    payload.slug = `${item.slug || slugify(item.name)}-copia-${Date.now()}`;
    payload.sort_order = state.items.length + 1;
    payload.created_at = new Date().toISOString();
    payload.updated_at = new Date().toISOString();

    const { error } = await state.client
      .from(TABLES.ITEMS)
      .insert(payload);

    if (error) {
      throw error;
    }

    await loadItems();
    renderItems();

    toast("success", "Item duplicado");
  } catch (error) {
    handleError(error, "Não foi possível duplicar o item.");
  }
}

async function toggleItemStatus(itemId) {
  const item = getItem(itemId);

  if (!item) {
    return;
  }

  const nextStatus = !getEnabled(item);

  try {
    const { error } = await state.client
      .from(TABLES.ITEMS)
      .update({
        is_enabled: nextStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", item.id);

    if (error) {
      throw error;
    }

    item.is_enabled = nextStatus;
    renderItems();

    toast(
      "success",
      nextStatus ? "Item ativado" : "Item desativado"
    );
  } catch (error) {
    handleError(error, "Não foi possível alterar o item.");
  }
}

function requestDeleteItem(itemId) {
  const item = getItem(itemId);

  if (!item) {
    return;
  }

  openConfirmation({
    title: "Excluir item?",
    message:
      `O item "${item.name || item.title}" será excluído permanentemente.`,
    confirmLabel: "Excluir item",
    confirmType: "danger",
    onConfirm: () => deleteItem(item.id)
  });
}

async function deleteItem(itemId) {
  try {
    await state.client
      .from(TABLES.SCENE_ITEMS)
      .delete()
      .eq("item_id", itemId);

    const { error } = await state.client
      .from(TABLES.ITEMS)
      .delete()
      .eq("id", itemId);

    if (error) {
      throw error;
    }

    await Promise.all([
      loadItems(),
      loadSceneItems()
    ]);

    renderItems();
    renderDashboard();

    toast("success", "Item excluído");
  } catch (error) {
    handleError(error, "Não foi possível excluir o item.");
  }
}


/* ==========================================================
   14. BIBLIOTECA DE MÍDIAS
   ========================================================== */

function openMediaLibrary(targetInputId = null) {
  state.mediaTargetInputId = targetInputId;
  state.selectedMediaId = null;

  renderMediaLibrary();
  openModal("mediaModal");
}

function renderMediaLibrary() {
  const container =
    getElement("mediaGrid") ||
    getElement("mediaLibraryGrid");

  if (!container) {
    return;
  }

  const search = normalizeText(state.mediaSearch);

  const filteredMedia = state.media.filter(media => {
    const mediaType = getMediaType(media);

    const matchesType =
      state.mediaFilter === "all" ||
      state.mediaFilter === mediaType;

    const matchesSearch =
      !search ||
      normalizeText([
        media.display_name,
        media.original_name,
        media.alt_text,
        media.storage_path
      ].join(" ")).includes(search);

    return matchesType && matchesSearch;
  });

  setText("mediaCount", filteredMedia.length);

  if (!filteredMedia.length) {
    container.innerHTML = createEmptyState(
      "Nenhuma mídia encontrada",
      state.media.length
        ? "Tente mudar o filtro ou o termo pesquisado."
        : "Envie uma imagem, GIF ou arquivo de áudio.",
      "trigger-media-upload",
      "Enviar arquivo"
    );
    return;
  }

  container.innerHTML = filteredMedia
    .map(media => createMediaCard(media))
    .join("");
}

function createMediaCard(media) {
  const selected =
    String(state.selectedMediaId || "") === String(media.id);

  const type = getMediaType(media);
  const name =
    media.display_name ||
    media.original_name ||
    "Arquivo sem nome";

  let preview = "";

  if (type === "image") {
    preview = `
      <img
        src="${escapeAttribute(media.public_url)}"
        alt="${escapeAttribute(media.alt_text || name)}"
        loading="lazy"
      >
    `;
  } else if (type === "audio") {
    preview = `
      <div class="empty-state-icon">♫</div>
      <audio controls preload="none">
        <source
          src="${escapeAttribute(media.public_url)}"
          type="${escapeAttribute(media.mime_type || "")}"
        >
      </audio>
    `;
  } else {
    preview = `<div class="empty-state-icon">◆</div>`;
  }

  return `
    <article
      class="media-card card card-clickable ${selected ? "is-selected" : ""}"
      data-action="select-media"
      data-id="${escapeAttribute(media.id)}"
    >
      <div class="media-preview">
        ${preview}
      </div>

      <div class="card-body">
        <div class="table-cell-title">
          ${escapeHtml(name)}
        </div>

        <div class="table-cell-subtitle">
          ${escapeHtml(formatFileSize(media.size_bytes || 0))}
        </div>

        <div class="card-actions mt-12">
          <button
            class="btn btn-sm btn-ghost"
            data-action="copy-media-url"
            data-id="${escapeAttribute(media.id)}"
            type="button"
          >
            Copiar URL
          </button>

          <button
            class="btn btn-sm btn-outline-danger"
            data-action="delete-media"
            data-id="${escapeAttribute(media.id)}"
            type="button"
          >
            Excluir
          </button>
        </div>
      </div>
    </article>
  `;
}

function selectMedia(mediaId) {
  state.selectedMediaId = mediaId;
  renderMediaLibrary();

  const media = getMedia(mediaId);

  setText(
    "selectedMediaName",
    media?.display_name || media?.original_name || ""
  );

  const useButton = getElement("useSelectedMediaButton");

  if (useButton) {
    useButton.disabled = !media;
  }
}

function useSelectedMedia() {
  const media = getMedia(state.selectedMediaId);

  if (!media) {
    toast("warning", "Selecione um arquivo");
    return;
  }

  if (state.mediaTargetInputId) {
    setInputValue(state.mediaTargetInputId, media.public_url);

    const input = getElement(state.mediaTargetInputId);

    input?.dispatchEvent(
      new Event("input", { bubbles: true })
    );

    updateAllMediaPreviews();
  }

  closeModal("mediaModal");

  toast(
    "success",
    "Mídia selecionada",
    "A URL foi adicionada ao formulário."
  );
}

async function uploadSelectedMedia(input) {
  const file = input.files?.[0];

  if (!file) {
    return;
  }

  try {
    validateMediaFile(file);

    showLoading(true, "Enviando arquivo...");

    const mediaType = determineMediaType(file);
    const extension = getFileExtension(file.name);

    const safeName = slugify(
      removeFileExtension(file.name)
    ) || "arquivo";

    const storagePath =
      `${state.game.id}/${mediaType}/` +
      `${Date.now()}-${safeName}.${extension}`;

    const { error: uploadError } = await state.client.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: publicData } = state.client.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    const publicUrl = publicData?.publicUrl;

    if (!publicUrl) {
      throw new Error("Não foi possível gerar a URL pública do arquivo.");
    }

    const { error: libraryError } = await state.client
      .from(TABLES.MEDIA)
      .insert({
        game_id: state.game.id,

        storage_bucket: STORAGE_BUCKET,
        storage_path: storagePath,

        original_name: file.name,
        display_name: removeFileExtension(file.name),

        media_type: mediaType,
        mime_type: file.type || null,
        size_bytes: file.size,

        public_url: publicUrl,
        alt_text: removeFileExtension(file.name),

        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });

    if (libraryError) {
      await state.client.storage
        .from(STORAGE_BUCKET)
        .remove([storagePath]);

      throw libraryError;
    }

    await loadMediaLibrary();
    renderMediaLibrary();
    renderDashboard();

    toast(
      "success",
      "Arquivo enviado",
      `"${file.name}" foi adicionado à biblioteca.`
    );
  } catch (error) {
    handleError(error, "Não foi possível enviar o arquivo.");
  } finally {
    input.value = "";
    showLoading(false);
  }
}

function validateMediaFile(file) {
  const type = determineMediaType(file);

  const allowedImageTypes = [
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif"
  ];

  const allowedAudioTypes = [
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/ogg",
    "audio/webm",
    "audio/x-wav"
  ];

  if (
    type === "image" &&
    !allowedImageTypes.includes(file.type)
  ) {
    throw new Error(
      "Formato de imagem inválido. Use PNG, JPG, WEBP ou GIF."
    );
  }

  if (
    type === "audio" &&
    !allowedAudioTypes.includes(file.type)
  ) {
    throw new Error(
      "Formato de áudio inválido. Use MP3, WAV, OGG ou WEBM."
    );
  }

  if (type === "other") {
    throw new Error(
      "Este tipo de arquivo não é permitido na biblioteca."
    );
  }

  const limit = MEDIA_LIMITS[type] || MEDIA_LIMITS.other;

  if (file.size > limit) {
    throw new Error(
      `O arquivo ultrapassa o limite de ${formatFileSize(limit)}.`
    );
  }
}

async function copyMediaUrl(mediaId) {
  const media = getMedia(mediaId);

  if (!media?.public_url) {
    return;
  }

  await copyText(media.public_url);

  toast(
    "success",
    "URL copiada",
    "O endereço público foi copiado."
  );
}

function requestDeleteMedia(mediaId) {
  const media = getMedia(mediaId);

  if (!media) {
    return;
  }

  openConfirmation({
    title: "Excluir mídia?",
    message:
      `O arquivo "${media.display_name || media.original_name}" será removido da biblioteca e do armazenamento.`,
    confirmLabel: "Excluir mídia",
    confirmType: "danger",
    onConfirm: () => deleteMedia(media.id)
  });
}

async function deleteMedia(mediaId) {
  const media = getMedia(mediaId);

  if (!media) {
    return;
  }

  try {
    showLoading(true, "Excluindo arquivo...");

    if (media.storage_path) {
      const { error: storageError } = await state.client.storage
        .from(media.storage_bucket || STORAGE_BUCKET)
        .remove([media.storage_path]);

      if (storageError) {
        console.warn("Falha ao remover do Storage:", storageError);
      }
    }

    const { error } = await state.client
      .from(TABLES.MEDIA)
      .delete()
      .eq("id", media.id);

    if (error) {
      throw error;
    }

    state.selectedMediaId = null;

    await loadMediaLibrary();

    renderMediaLibrary();
    renderDashboard();

    toast("success", "Mídia excluída");
  } catch (error) {
    handleError(error, "Não foi possível excluir a mídia.");
  } finally {
    showLoading(false);
  }
}


/* ==========================================================
   15. MAPA NARRATIVO
   ========================================================== */

function configureMapEvents() {
  document.addEventListener("pointerdown", handleMapPointerDown);
  document.addEventListener("pointermove", handleMapPointerMove);
  document.addEventListener("pointerup", handleMapPointerUp);
  document.addEventListener("pointercancel", handleMapPointerUp);

  document.addEventListener(
    "wheel",
    handleMapWheel,
    { passive: false }
  );
}

function renderMap() {
  const canvas = getElement("mapCanvas");
  const connections = getElement("mapConnections");

  if (!canvas || !connections) {
    return;
  }

  canvas.style.width = `${MAP_CONFIG.width}px`;
  canvas.style.height = `${MAP_CONFIG.height}px`;

  renderMapNodes();
  renderMapConnections();
  renderMapSceneList();
  applyMapTransform();
}

function renderMapNodes() {
  const layer =
    getElement("mapNodesLayer") ||
    getElement("mapCanvas");

  if (!layer) {
    return;
  }

  layer.querySelectorAll(".map-node").forEach(node => node.remove());

  const fragment = document.createDocumentFragment();

  state.scenes.forEach(scene => {
    const route = getRoute(scene.route_id);
    const node = document.createElement("article");

    node.className = [
      "map-node",
      getEnabled(scene) ? "" : "inactive",
      getSceneStart(scene) ? "start-node" : "",
      String(state.selectedMapSceneId || "") === String(scene.id)
        ? "selected"
        : ""
    ].filter(Boolean).join(" ");

    node.dataset.sceneId = scene.id;

    node.style.left = `${getSceneMapX(scene)}px`;
    node.style.top = `${getSceneMapY(scene)}px`;

    node.style.setProperty(
      "--node-color",
      route ? getRouteColor(route) : "#c99c5d"
    );

    node.innerHTML = `
      <button
        class="map-node-port node-port-left"
        data-map-port="left"
        data-scene-id="${escapeAttribute(scene.id)}"
        type="button"
        aria-label="Criar conexão"
      ></button>

      <button
        class="map-node-port node-port-right"
        data-map-port="right"
        data-scene-id="${escapeAttribute(scene.id)}"
        type="button"
        aria-label="Criar conexão"
      ></button>

      <button
        class="map-node-port node-port-top"
        data-map-port="top"
        data-scene-id="${escapeAttribute(scene.id)}"
        type="button"
        aria-label="Criar conexão"
      ></button>

      <button
        class="map-node-port node-port-bottom"
        data-map-port="bottom"
        data-scene-id="${escapeAttribute(scene.id)}"
        type="button"
        aria-label="Criar conexão"
      ></button>

      <div class="map-node-header">
        <div class="map-node-icon">◈</div>

        <div class="map-node-copy">
          <div class="map-node-title">
            ${escapeHtml(scene.title || "Cena sem título")}
          </div>

          <div class="map-node-slug">
            ${escapeHtml(scene.scene_key || scene.slug || "")}
          </div>
        </div>

        <button
          class="icon-button"
          data-action="map-edit-scene"
          data-id="${escapeAttribute(scene.id)}"
          data-tooltip="Editar cena"
          type="button"
        >
          ✎
        </button>
      </div>

      <div class="map-node-body">
        <div class="map-node-description">
          ${escapeHtml(
            scene.admin_description ||
            scene.fallback_text ||
            "Sem descrição."
          )}
        </div>

        <div class="map-node-meta">
          ${createBadge(
            `${getSceneActions(scene.id).length} ações`,
            "badge-info"
          )}

          ${
            getSceneEnding(scene)
              ? createBadge("Final", "badge-purple")
              : ""
          }
        </div>
      </div>
    `;

    fragment.appendChild(node);
  });

  layer.appendChild(fragment);
}

function renderMapConnections() {
  const svg = getElement("mapConnections");

  if (!svg) {
    return;
  }

  svg.setAttribute("viewBox", `0 0 ${MAP_CONFIG.width} ${MAP_CONFIG.height}`);

  const connections = [];

  state.actions.forEach(action => {
    const fromScene = getScene(action.scene_id);

    const destinationId =
      action.destination_scene_id ||
      action.target_scene_id ||
      action.next_scene_id;

    const toScene = getScene(destinationId);

    if (!fromScene || !toScene || !getEnabled(action)) {
      return;
    }

    connections.push({
      id: action.id,
      fromScene,
      toScene,
      action
    });
  });

  svg.innerHTML = connections
    .map(connection => {
      const route =
        getRoute(connection.fromScene.route_id) ||
        getRoute(connection.toScene.route_id);

      const color = route
        ? getRouteColor(route)
        : "#c99c5d";

      const path = createConnectionPath(
        connection.fromScene,
        connection.toScene
      );

      return `
        <path
          class="map-connection-line"
          d="${path}"
          style="--route-color:${escapeAttribute(color)}"
        ></path>

        <path
          class="map-connection-hitbox"
          d="${path}"
          data-connection-id="${escapeAttribute(connection.id)}"
        ></path>
      `;
    })
    .join("");

  if (state.map.connecting) {
    renderTemporaryConnection();
  }
}

function createConnectionPath(fromScene, toScene) {
  const from = getNodeCenter(fromScene);
  const to = getNodeCenter(toScene);

  const horizontalDistance = Math.abs(to.x - from.x);
  const curve = Math.max(80, horizontalDistance * 0.45);

  const control1X =
    from.x + (to.x >= from.x ? curve : -curve);

  const control2X =
    to.x - (to.x >= from.x ? curve : -curve);

  return [
    `M ${from.x} ${from.y}`,
    `C ${control1X} ${from.y},`,
    `${control2X} ${to.y},`,
    `${to.x} ${to.y}`
  ].join(" ");
}

function getNodeCenter(scene) {
  return {
    x: getSceneMapX(scene) + MAP_CONFIG.nodeWidth / 2,
    y: getSceneMapY(scene) + MAP_CONFIG.nodeHeight / 2
  };
}

function renderMapSceneList() {
  const container = getElement("mapSceneList");

  if (!container) {
    return;
  }

  container.innerHTML = state.scenes
    .map(scene => {
      const route = getRoute(scene.route_id);
      const color = route ? getRouteColor(route) : "#c99c5d";

      return `
        <button
          class="map-scene-list-item"
          data-action="map-center-scene"
          data-id="${escapeAttribute(scene.id)}"
          type="button"
        >
          <span
            class="map-scene-list-color"
            style="--scene-color:${escapeAttribute(color)}"
          ></span>

          <span class="map-scene-list-copy">
            <span class="map-scene-list-title">
              ${escapeHtml(scene.title)}
            </span>

            <span class="map-scene-list-subtitle">
              ${escapeHtml(scene.scene_key || scene.slug || "")}
            </span>
          </span>
        </button>
      `;
    })
    .join("");
}

function handleMapPointerDown(event) {
  const viewport = event.target.closest("#mapViewport");

  if (!viewport) {
    return;
  }

  const port = event.target.closest("[data-map-port]");

  if (port) {
    event.preventDefault();
    event.stopPropagation();

    startMapConnection(port.dataset.sceneId, event);
    return;
  }

  const node = event.target.closest(".map-node");

  if (node && !event.target.closest("button")) {
    event.preventDefault();

    const scene = getScene(node.dataset.sceneId);

    if (!scene) {
      return;
    }

    state.selectedMapSceneId = scene.id;
    state.map.draggingNode = true;
    state.map.dragSceneId = scene.id;

    state.map.startMouseX = event.clientX;
    state.map.startMouseY = event.clientY;

    state.map.nodeStartX = getSceneMapX(scene);
    state.map.nodeStartY = getSceneMapY(scene);

    node.setPointerCapture?.(event.pointerId);
    node.classList.add("selected");

    renderMapNodes();
    return;
  }

  if (
    event.target === viewport ||
    event.target.closest("#mapCanvas")
  ) {
    state.map.draggingCanvas = true;

    state.map.startMouseX = event.clientX;
    state.map.startMouseY = event.clientY;

    state.map.startOffsetX = state.map.offsetX;
    state.map.startOffsetY = state.map.offsetY;

    viewport.classList.add("grabbing");
    viewport.setPointerCapture?.(event.pointerId);
  }
}

function handleMapPointerMove(event) {
  if (state.map.draggingCanvas) {
    const dx = event.clientX - state.map.startMouseX;
    const dy = event.clientY - state.map.startMouseY;

    state.map.offsetX = state.map.startOffsetX + dx;
    state.map.offsetY = state.map.startOffsetY + dy;

    applyMapTransform();
    return;
  }

  if (state.map.draggingNode) {
    const scene = getScene(state.map.dragSceneId);

    if (!scene) {
      return;
    }

    const dx =
      (event.clientX - state.map.startMouseX) /
      state.map.zoom;

    const dy =
      (event.clientY - state.map.startMouseY) /
      state.map.zoom;

    const x = clamp(
      snapToGrid(state.map.nodeStartX + dx),
      0,
      MAP_CONFIG.width - MAP_CONFIG.nodeWidth
    );

    const y = clamp(
      snapToGrid(state.map.nodeStartY + dy),
      0,
      MAP_CONFIG.height - MAP_CONFIG.nodeHeight
    );

    setSceneMapPosition(scene, x, y);

    const node = document.querySelector(
      `.map-node[data-scene-id="${cssEscape(scene.id)}"]`
    );

    if (node) {
      node.style.left = `${x}px`;
      node.style.top = `${y}px`;
    }

    renderMapConnections();
    return;
  }

  if (state.map.connecting) {
    const position = getMapPointerPosition(event);

    state.map.connectionMouseX = position.x;
    state.map.connectionMouseY = position.y;

    renderMapConnections();
  }
}

function handleMapPointerUp(event) {
  const wasDraggingNode = state.map.draggingNode;
  const draggedSceneId = state.map.dragSceneId;

  state.map.draggingCanvas = false;
  state.map.draggingNode = false;
  state.map.dragSceneId = null;

  getElement("mapViewport")?.classList.remove("grabbing");

  if (wasDraggingNode && draggedSceneId) {
    saveMapPosition(draggedSceneId);
  }

  if (state.map.connecting) {
    const targetNode = event.target.closest(".map-node");

    if (
      targetNode &&
      String(targetNode.dataset.sceneId) !==
      String(state.map.connectionFromSceneId)
    ) {
      createMapConnection(
        state.map.connectionFromSceneId,
        targetNode.dataset.sceneId
      );
    } else {
      cancelMapConnection();
    }
  }
}

function handleMapWheel(event) {
  const viewport = event.target.closest("#mapViewport");

  if (!viewport) {
    return;
  }

  event.preventDefault();

  const direction = event.deltaY < 0 ? 1 : -1;
  const nextZoom =
    state.map.zoom + direction * MAP_CONFIG.zoomStep;

  const rect = viewport.getBoundingClientRect();

  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;

  const mapX =
    (pointerX - state.map.offsetX) /
    state.map.zoom;

  const mapY =
    (pointerY - state.map.offsetY) /
    state.map.zoom;

  const clampedZoom = clamp(
    nextZoom,
    MAP_CONFIG.minZoom,
    MAP_CONFIG.maxZoom
  );

  state.map.offsetX =
    pointerX - mapX * clampedZoom;

  state.map.offsetY =
    pointerY - mapY * clampedZoom;

  state.map.zoom = clampedZoom;

  applyMapTransform();
}

function startMapConnection(sceneId, event) {
  const scene = getScene(sceneId);

  if (!scene) {
    return;
  }

  const pointer = getMapPointerPosition(event);

  state.map.connecting = true;
  state.map.connectionFromSceneId = scene.id;
  state.map.connectionMouseX = pointer.x;
  state.map.connectionMouseY = pointer.y;

  renderMapConnections();

  toast(
    "info",
    "Criando conexão",
    "Clique ou solte sobre a cena de destino."
  );
}

function renderTemporaryConnection() {
  const svg = getElement("mapConnections");
  const fromScene = getScene(state.map.connectionFromSceneId);

  if (!svg || !fromScene) {
    return;
  }

  const from = getNodeCenter(fromScene);

  const to = {
    x: state.map.connectionMouseX,
    y: state.map.connectionMouseY
  };

  const curve = Math.max(
    80,
    Math.abs(to.x - from.x) * 0.45
  );

  const path = [
    `M ${from.x} ${from.y}`,
    `C ${from.x + curve} ${from.y},`,
    `${to.x - curve} ${to.y},`,
    `${to.x} ${to.y}`
  ].join(" ");

  svg.insertAdjacentHTML(
    "beforeend",
    `
      <path
        class="map-connection-line"
        d="${path}"
        style="--route-color:#5798ff;stroke-dasharray:8 6"
      ></path>
    `
  );
}

function cancelMapConnection() {
  if (!state.map.connecting) {
    return;
  }

  state.map.connecting = false;
  state.map.connectionFromSceneId = null;

  renderMapConnections();
}

async function createMapConnection(fromSceneId, toSceneId) {
  cancelMapConnection();

  const fromScene = getScene(fromSceneId);
  const toScene = getScene(toSceneId);

  if (!fromScene || !toScene) {
    return;
  }

  openNewActionModal(fromScene.id);

  setInputValue(
    "actionLabelInput",
    `Ir para ${toScene.title}`
  );

  setInputValue("actionTypeInput", "move");

  setInputValue(
    "actionDestinationSceneInput",
    toScene.id
  );

  setInputValue(
    "actionKeywordsInput",
    `ir ${slugify(toScene.title)}, seguir, avançar`
  );
}

async function saveMapPosition(sceneId) {
  const scene = getScene(sceneId);

  if (!scene) {
    return;
  }

  try {
    const { error } = await state.client
      .from(TABLES.SCENES)
      .update({
        map_x: getSceneMapX(scene),
        map_y: getSceneMapY(scene),
        updated_at: new Date().toISOString()
      })
      .eq("id", scene.id);

    if (error) {
      throw error;
    }
  } catch (error) {
    handleError(error, "Não foi possível salvar a posição da cena.");
  }
}

async function saveAllMapPositions() {
  if (!state.scenes.length) {
    return;
  }

  try {
    showLoading(true, "Salvando mapa...");

    const operations = state.scenes.map(scene =>
      state.client
        .from(TABLES.SCENES)
        .update({
          map_x: getSceneMapX(scene),
          map_y: getSceneMapY(scene),
          updated_at: new Date().toISOString()
        })
        .eq("id", scene.id)
    );

    const results = await Promise.all(operations);

    const failed = results.find(result => result.error);

    if (failed?.error) {
      throw failed.error;
    }

    toast("success", "Mapa salvo");
  } catch (error) {
    handleError(error, "Não foi possível salvar o mapa.");
  } finally {
    showLoading(false);
  }
}

function applyMapTransform() {
  const canvas = getElement("mapCanvas");

  if (!canvas) {
    return;
  }

  canvas.style.transform =
    `translate(${state.map.offsetX}px, ${state.map.offsetY}px) ` +
    `scale(${state.map.zoom})`;

  setText(
    "mapZoomDisplay",
    `${Math.round(state.map.zoom * 100)}%`
  );

  const range = getElement("mapZoomRange");

  if (range) {
    range.value = state.map.zoom;
  }
}

function setMapZoom(value) {
  state.map.zoom = clamp(
    Number(value),
    MAP_CONFIG.minZoom,
    MAP_CONFIG.maxZoom
  );

  applyMapTransform();
}

function resetMapView() {
  state.map.zoom = MAP_CONFIG.defaultZoom;
  state.map.offsetX = 40;
  state.map.offsetY = 40;

  applyMapTransform();
}

function fitMapToScenes() {
  const viewport = getElement("mapViewport");

  if (!viewport || !state.scenes.length) {
    resetMapView();
    return;
  }

  const positions = state.scenes.map(scene => ({
    x: getSceneMapX(scene),
    y: getSceneMapY(scene)
  }));

  const minX = Math.min(...positions.map(item => item.x));
  const minY = Math.min(...positions.map(item => item.y));

  const maxX = Math.max(
    ...positions.map(item => item.x + MAP_CONFIG.nodeWidth)
  );

  const maxY = Math.max(
    ...positions.map(item => item.y + MAP_CONFIG.nodeHeight)
  );

  const contentWidth = maxX - minX + 100;
  const contentHeight = maxY - minY + 100;

  const zoomX = viewport.clientWidth / contentWidth;
  const zoomY = viewport.clientHeight / contentHeight;

  state.map.zoom = clamp(
    Math.min(zoomX, zoomY),
    MAP_CONFIG.minZoom,
    1
  );

  state.map.offsetX =
    (viewport.clientWidth - contentWidth * state.map.zoom) / 2 -
    (minX - 50) * state.map.zoom;

  state.map.offsetY =
    (viewport.clientHeight - contentHeight * state.map.zoom) / 2 -
    (minY - 50) * state.map.zoom;

  applyMapTransform();
}

function centerMapOnScene(sceneId) {
  const scene = getScene(sceneId);
  const viewport = getElement("mapViewport");

  if (!scene || !viewport) {
    return;
  }

  state.selectedMapSceneId = scene.id;

  const centerX =
    getSceneMapX(scene) + MAP_CONFIG.nodeWidth / 2;

  const centerY =
    getSceneMapY(scene) + MAP_CONFIG.nodeHeight / 2;

  state.map.offsetX =
    viewport.clientWidth / 2 -
    centerX * state.map.zoom;

  state.map.offsetY =
    viewport.clientHeight / 2 -
    centerY * state.map.zoom;

  renderMapNodes();
  applyMapTransform();
}

function focusMapScene(sceneId) {
  navigateToView("map");
  centerMapOnScene(sceneId);
}

function getMapPointerPosition(event) {
  const viewport = getElement("mapViewport");

  if (!viewport) {
    return { x: 0, y: 0 };
  }

  const rect = viewport.getBoundingClientRect();

  return {
    x:
      (event.clientX - rect.left - state.map.offsetX) /
      state.map.zoom,

    y:
      (event.clientY - rect.top - state.map.offsetY) /
      state.map.zoom
  };
}


/* ==========================================================
   16. TESTADOR
   ========================================================== */

function startGameTester() {
  clearTester();

  const startScene =
    state.scenes.find(scene => getSceneStart(scene) && getEnabled(scene)) ||
    state.scenes.find(scene => getEnabled(scene));

  if (!startScene) {
    appendTesterOutput(
      "Nenhuma cena ativa foi encontrada.",
      "error"
    );
    return;
  }

  state.testerSceneId = startScene.id;

  appendTesterOutput(
    startScene.fallback_text ||
    startScene.text ||
    startScene.title,
    "system"
  );

  appendTesterOutput(
    `Cena atual: ${startScene.title}`,
    "help"
  );
}

function sendTesterCommand() {
  const input = getElement("testerCommandInput");

  if (!input) {
    return;
  }

  const command = input.value.trim();

  if (!command) {
    return;
  }

  input.value = "";

  appendTesterOutput(`> ${command}`, "user");

  processTesterCommand(command);
}

function processTesterCommand(command) {
  const scene = getScene(state.testerSceneId);

  if (!scene) {
    appendTesterOutput(
      "A partida de teste não foi iniciada.",
      "error"
    );
    return;
  }

  const normalizedCommand = normalizeText(command);

  if (normalizedCommand === "ajuda") {
    if (scene.help_mode === "none") {
      appendTesterOutput(
        "Não há resposta para ajuda neste momento.",
        "system"
      );
      return;
    }

    appendTesterOutput(
      scene.help_text ||
      "Tente observar a cena e usar palavras relacionadas ao que está acontecendo.",
      "help"
    );

    return;
  }

  if (normalizedCommand === "repetir") {
    appendTesterOutput(
      scene.fallback_text ||
      scene.text ||
      scene.title,
      "system"
    );

    return;
  }

  if (normalizedCommand === "inventario") {
    appendTesterOutput(
      scene.allow_inventory === false
        ? "O inventário não está disponível nesta cena."
        : "Inventário de teste: nenhum item.",
      "help"
    );

    return;
  }

  if (normalizedCommand === "historico") {
    appendTesterOutput(
      scene.allow_history === false
        ? "O histórico não está disponível nesta cena."
        : "O histórico completo será exibido na versão jogável.",
      "help"
    );

    return;
  }

  const actions = getSceneActions(scene.id)
    .filter(action => getEnabled(action));

  const matchedAction = actions.find(action => {
    const keywords = parseKeywords(
      action.keywords ||
      action.trigger_words ||
      action.aliases
    );

    return keywords.some(keyword => {
      const normalizedKeyword = normalizeText(keyword);

      return (
        normalizedCommand === normalizedKeyword ||
        normalizedCommand.includes(normalizedKeyword)
      );
    });
  });

  if (!matchedAction) {
    appendTesterOutput(
      scene.unknown_command_text ||
      "Não parece possível fazer isso agora.",
      "system"
    );

    return;
  }

  if (matchedAction.response_text) {
    appendTesterOutput(
      matchedAction.response_text,
      "system"
    );
  }

  const destinationId =
    matchedAction.destination_scene_id ||
    matchedAction.target_scene_id ||
    matchedAction.next_scene_id;

  const destinationScene = getScene(destinationId);

  if (destinationScene) {
    state.testerSceneId = destinationScene.id;

    appendTesterOutput(
      destinationScene.fallback_text ||
      destinationScene.text ||
      destinationScene.title,
      "system"
    );

    appendTesterOutput(
      `Cena atual: ${destinationScene.title}`,
      "help"
    );
  }

  if (matchedAction.ends_game || destinationScene?.is_ending) {
    appendTesterOutput(
      "Fim do teste.",
      "help"
    );
  }
}

function appendTesterOutput(text, type = "system") {
  const output = getElement("testerOutput");

  if (!output) {
    return;
  }

  const entry = document.createElement("div");

  entry.className =
    `terminal-entry terminal-entry-${type}`;

  entry.textContent = text;

  output.appendChild(entry);
  output.scrollTop = output.scrollHeight;
}

function clearTester() {
  const output = getElement("testerOutput");

  if (output) {
    output.innerHTML = "";
  }

  state.testerSceneId = null;
}


/* ==========================================================
   17. CONFIGURAÇÕES DO JOGO
   ========================================================== */

function renderGameSettings() {
  if (!state.game) {
    return;
  }

  setInputValue(
    "gameTitleInput",
    state.game.title || state.game.name || ""
  );

  setInputValue(
    "gameSlugInput",
    state.game.slug || GAME_SLUG
  );

  setInputValue(
    "gameDescriptionInput",
    state.game.description || ""
  );

  setInputValue(
    "gameUnknownCommandInput",
    state.game.unknown_command_text ||
    "Não parece possível fazer isso agora."
  );

  setInputValue(
    "gameLogoUrlInput",
    state.game.logo_url || ""
  );

  setInputValue(
    "gameFaviconUrlInput",
    state.game.favicon_url || ""
  );

  setCheckboxValue(
    "gameEnabledInput",
    state.game.is_enabled !== false
  );
}

async function saveGameSettings(form) {
  const formData = new FormData(form);

  const payload = {
    title:
      cleanValue(formData.get("title")),

    description:
      cleanValue(formData.get("description")),

    unknown_command_text:
      cleanValue(formData.get("unknown_command_text")) ||
      "Não parece possível fazer isso agora.",

    logo_url:
      cleanValue(formData.get("logo_url")) || null,

    favicon_url:
      cleanValue(formData.get("favicon_url")) || null,

    is_enabled:
      formData.has("is_enabled"),

    updated_at: new Date().toISOString()
  };

  try {
    showLoading(true, "Salvando configurações...");

    const { data, error } = await state.client
      .from(TABLES.GAMES)
      .update(payload)
      .eq("id", state.game.id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    state.game = data;

    renderGameSettings();

    toast(
      "success",
      "Configurações salvas"
    );
  } catch (error) {
    handleError(error, "Não foi possível salvar as configurações.");
  } finally {
    showLoading(false);
  }
}


/* ==========================================================
   18. MODAIS E CONFIRMAÇÕES
   ========================================================== */

let pendingConfirmation = null;

function openModal(modalId) {
  const modal = getElement(modalId);

  if (!modal) {
    console.warn(`Modal não encontrado: ${modalId}`);
    return;
  }

  modal.classList.add("open", "active");
  modal.setAttribute("aria-hidden", "false");

  document.body.classList.add("modal-open");

  const focusable = modal.querySelector(
    "input:not([type='hidden']), select, textarea, button"
  );

  requestAnimationFrame(() => {
    focusable?.focus();
  });
}

function closeModal(modalId) {
  const modal = getElement(modalId);

  if (!modal) {
    return;
  }

  modal.classList.remove("open", "active");
  modal.setAttribute("aria-hidden", "true");

  if (!document.querySelector(".modal.open, .admin-modal.open")) {
    document.body.classList.remove("modal-open");
  }
}

function closeTopModal() {
  const openModals = [
    ...document.querySelectorAll(".modal.open, .admin-modal.open")
  ];

  const topModal = openModals.at(-1);

  if (topModal) {
    closeModal(topModal.id);
  }
}

function openConfirmation({
  title,
  message,
  confirmLabel = "Confirmar",
  confirmType = "danger",
  onConfirm
}) {
  pendingConfirmation = onConfirm;

  setText("confirmationTitle", title);
  setText("confirmationMessage", message);
  setText("confirmationConfirmButton", confirmLabel);

  const button = getElement("confirmationConfirmButton");

  if (button) {
    button.className =
      `btn ${confirmType === "danger" ? "btn-danger" : "btn-primary"}`;
  }

  openModal("confirmationModal");
}

async function executePendingConfirmation() {
  const callback = pendingConfirmation;
  pendingConfirmation = null;

  closeModal("confirmationModal");

  if (typeof callback === "function") {
    await callback();
  }
}


/* ==========================================================
   19. SIDEBAR E INTERFACE
   ========================================================== */

function toggleSidebar() {
  getElement("adminSidebar")?.classList.toggle("open");
  getElement("sidebarBackdrop")?.classList.toggle("open");
}

function closeSidebar() {
  getElement("adminSidebar")?.classList.remove("open");
  getElement("sidebarBackdrop")?.classList.remove("open");
}

function toggleDropdown(dropdown) {
  if (!dropdown) {
    return;
  }

  const isOpen = dropdown.classList.contains("open");

  closeAllDropdowns();

  if (!isOpen) {
    dropdown.classList.add("open");
  }
}

function closeAllDropdowns() {
  document.querySelectorAll(".dropdown.open").forEach(dropdown => {
    dropdown.classList.remove("open");
  });
}

function handleWindowResize() {
  if (window.innerWidth > 820) {
    closeSidebar();
  }

  if (state.currentView === "map") {
    applyMapTransform();
  }
}


/* ==========================================================
   20. LOADING, TOASTS E ERROS
   ========================================================== */

function showLoading(show, text = "Carregando...") {
  const overlay = getElement("loadingOverlay");

  if (show) {
    state.loadingCount += 1;
  } else {
    state.loadingCount = Math.max(0, state.loadingCount - 1);
  }

  if (!overlay) {
    return;
  }

  setText("loadingText", text);

  overlay.classList.toggle(
    "active",
    state.loadingCount > 0
  );
}

function toast(type, title, message = "") {
  const container = getElement("toastContainer");

  if (!container) {
    console.log(`[${type}] ${title}: ${message}`);
    return;
  }

  const toastElement = document.createElement("div");

  const icons = {
    success: "✓",
    error: "!",
    danger: "!",
    warning: "!",
    info: "i"
  };

  toastElement.className =
    `toast toast-${type || "info"}`;

  toastElement.innerHTML = `
    <div class="toast-icon">
      ${icons[type] || "i"}
    </div>

    <div class="toast-copy">
      <div class="toast-title">
        ${escapeHtml(title)}
      </div>

      ${
        message
          ? `
            <div class="toast-message">
              ${escapeHtml(message)}
            </div>
          `
          : ""
      }
    </div>

    <button class="toast-close" type="button">×</button>
  `;

  const closeButton = toastElement.querySelector(".toast-close");

  closeButton.addEventListener("click", () => {
    toastElement.remove();
  });

  container.appendChild(toastElement);

  window.setTimeout(() => {
    toastElement.remove();
  }, type === "error" || type === "danger" ? 7000 : 4500);
}

function handleError(error, fallbackMessage = "Ocorreu um erro.") {
  console.error(error);

  const message =
    error?.message ||
    error?.details ||
    fallbackMessage;

  toast("error", fallbackMessage, message);
}

function handleInitializationError(error) {
  const message = error?.message || "Erro desconhecido.";

  setText("fatalErrorMessage", message);
  hideElement("adminApp");
  showElement("fatalError");
}


/* ==========================================================
   21. SELETORES E FORMULÁRIOS
   ========================================================== */

function populateRouteSelect(selectId, includeEmpty = false) {
  const select = getElement(selectId);

  if (!select) {
    return;
  }

  const current = select.value;

  select.innerHTML = `
    ${includeEmpty ? '<option value="">Sem rota</option>' : ""}
    ${state.routes
      .map(route => `
        <option value="${escapeAttribute(route.id)}">
          ${escapeHtml(getRouteName(route))}
        </option>
      `)
      .join("")}
  `;

  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

function populateSceneSelect(
  selectId,
  includeEmpty = false,
  excludedSceneId = null
) {
  const select = getElement(selectId);

  if (!select) {
    return;
  }

  const current = select.value;

  select.innerHTML = `
    ${
      includeEmpty
        ? '<option value="">Não mudar de cena</option>'
        : ""
    }

    ${state.scenes
      .filter(
        scene =>
          !excludedSceneId ||
          String(scene.id) !== String(excludedSceneId)
      )
      .map(scene => `
        <option value="${escapeAttribute(scene.id)}">
          ${escapeHtml(scene.title)}
        </option>
      `)
      .join("")}
  `;

  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

function populateItemSelect(selectId, includeEmpty = false) {
  const select = getElement(selectId);

  if (!select) {
    return;
  }

  const current = select.value;

  select.innerHTML = `
    ${
      includeEmpty
        ? '<option value="">Nenhum item</option>'
        : ""
    }

    ${state.items
      .map(item => `
        <option value="${escapeAttribute(item.id)}">
          ${escapeHtml(item.name || item.title)}
        </option>
      `)
      .join("")}
  `;

  if ([...select.options].some(option => option.value === current)) {
    select.value = current;
  }
}

function syncSlugField(sourceInput) {
  const targetId = sourceInput.dataset.slugSource;
  const target = getElement(targetId);

  if (!target || target.dataset.manual === "true") {
    return;
  }

  target.value = slugify(sourceInput.value);
}

function updateSceneEditorHeading() {
  const title =
    getElement("sceneTitleInput")?.value.trim() ||
    "Nova cena";

  setText("sceneEditorHeading", title);
}

function updateSceneRoutePreview(routeId) {
  const preview = getElement("sceneRoutePreview");

  if (!preview) {
    return;
  }

  const route = getRoute(routeId);

  preview.textContent = route
    ? getRouteName(route)
    : "Sem rota";

  preview.style.color = route
    ? getRouteColor(route)
    : "";
}

function updateMediaPreview(inputId, previewId) {
  const input = getElement(inputId);
  const preview = getElement(previewId);

  if (!input || !preview) {
    return;
  }

  const url = input.value.trim();

  if (!url) {
    preview.innerHTML = `
      <div class="text-muted">
        Nenhuma imagem selecionada.
      </div>
    `;
    return;
  }

  preview.innerHTML = `
    <img
      src="${escapeAttribute(url)}"
      alt="Pré-visualização"
      onerror="this.parentElement.innerHTML='<div class=&quot;text-danger&quot;>Não foi possível carregar a imagem.</div>'"
    >
  `;
}

function updateAudioPreview(inputId, previewId) {
  const input = getElement(inputId);
  const preview = getElement(previewId);

  if (!input || !preview) {
    return;
  }

  const url = input.value.trim();

  if (!url) {
    preview.innerHTML = "";
    return;
  }

  preview.innerHTML = `
    <audio class="scene-audio-preview" controls preload="none">
      <source src="${escapeAttribute(url)}">
    </audio>
  `;
}

function updateAllMediaPreviews() {
  updateMediaPreview(
    "sceneImageUrlInput",
    "sceneImagePreview"
  );

  updateAudioPreview(
    "sceneAudioUrlInput",
    "sceneAudioPreview"
  );

  updateMediaPreview(
    "itemImageUrlInput",
    "itemImagePreview"
  );
}


/* ==========================================================
   22. CONSULTAS E GETTERS
   ========================================================== */

function getScene(sceneId) {
  return state.scenes.find(
    scene => String(scene.id) === String(sceneId)
  ) || null;
}

function getRoute(routeId) {
  if (!routeId) {
    return null;
  }

  return state.routes.find(
    route => String(route.id) === String(routeId)
  ) || null;
}

function getAction(actionId) {
  return state.actions.find(
    action => String(action.id) === String(actionId)
  ) || null;
}

function getItem(itemId) {
  return state.items.find(
    item => String(item.id) === String(itemId)
  ) || null;
}

function getMedia(mediaId) {
  return state.media.find(
    media => String(media.id) === String(mediaId)
  ) || null;
}

function getSceneActions(sceneId) {
  return state.actions
    .filter(
      action => String(action.scene_id) === String(sceneId)
    )
    .sort(
      (a, b) =>
        Number(a.sort_order || 0) -
        Number(b.sort_order || 0)
    );
}

function getEnabled(entity) {
  return entity?.is_enabled !== false;
}

function getSceneStart(scene) {
  return Boolean(
    scene?.is_start ??
    scene?.is_initial ??
    scene?.start_scene
  );
}

function getSceneEnding(scene) {
  return Boolean(
    scene?.is_ending ??
    scene?.is_final ??
    scene?.ending
  );
}

function getSceneMapX(scene) {
  return toNumber(
    scene?.map_x ??
    scene?.position_x ??
    scene?.x,
    100
  );
}

function getSceneMapY(scene) {
  return toNumber(
    scene?.map_y ??
    scene?.position_y ??
    scene?.y,
    100
  );
}

function setSceneMapPosition(scene, x, y) {
  scene.map_x = x;
  scene.map_y = y;
}

function getRouteName(route) {
  return route?.name || route?.title || "Rota sem nome";
}

function getRouteColor(route) {
  return route?.color || route?.route_color || "#c99c5d";
}

function getNextSceneOrder() {
  const maximum = Math.max(
    0,
    ...state.scenes.map(
      scene => Number(scene.sort_order ?? scene.scene_order ?? 0)
    )
  );

  return maximum + 1;
}

function getNextActionOrder(sceneId) {
  const actions = getSceneActions(sceneId);

  const maximum = Math.max(
    0,
    ...actions.map(action => Number(action.sort_order || 0))
  );

  return maximum + 1;
}

function getNextMapPosition() {
  const index = state.scenes.length;

  const columns = 5;
  const spacingX = 270;
  const spacingY = 160;

  return {
    x: 100 + (index % columns) * spacingX,
    y: 100 + Math.floor(index / columns) * spacingY
  };
}


/* ==========================================================
   23. HELPERS DE MÍDIA
   ========================================================== */

function determineMediaType(file) {
  if (file.type.startsWith("image/")) {
    return "image";
  }

  if (file.type.startsWith("audio/")) {
    return "audio";
  }

  return "other";
}

function getMediaType(media) {
  if (media.media_type) {
    return media.media_type;
  }

  const mimeType = media.mime_type || "";

  if (mimeType.startsWith("image/")) {
    return "image";
  }

  if (mimeType.startsWith("audio/")) {
    return "audio";
  }

  return "other";
}

function getFileExtension(filename) {
  const extension = String(filename).split(".").pop();

  return extension && extension !== filename
    ? extension.toLowerCase()
    : "bin";
}

function removeFileExtension(filename) {
  return String(filename).replace(/\.[^/.]+$/, "");
}


/* ==========================================================
   24. HELPERS DE TEXTO E DADOS
   ========================================================== */

function getElement(id) {
  if (!id) {
    return null;
  }

  return document.getElementById(
    String(id).replace(/^#/, "")
  );
}

function setText(id, value) {
  const element = getElement(id);

  if (element) {
    element.textContent =
      value === null || value === undefined
        ? ""
        : String(value);
  }
}

function setInputValue(id, value) {
  const input = getElement(id);

  if (input) {
    input.value =
      value === null || value === undefined
        ? ""
        : value;
  }
}

function setCheckboxValue(id, checked) {
  const input = getElement(id);

  if (input) {
    input.checked = Boolean(checked);
  }
}

function resetForm(id) {
  getElement(id)?.reset();
}

function showElement(id) {
  getElement(id)?.classList.remove("is-hidden", "hidden");
}

function hideElement(id) {
  getElement(id)?.classList.add("is-hidden");
}

function cleanValue(value) {
  return String(value ?? "").trim();
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function parseKeywords(value) {
  if (Array.isArray(value)) {
    return [
      ...new Set(
        value
          .map(item => cleanValue(item))
          .filter(Boolean)
      )
    ];
  }

  if (!value) {
    return [];
  }

  if (typeof value === "object") {
    return Object.values(value)
      .map(item => cleanValue(item))
      .filter(Boolean);
  }

  const text = String(value).trim();

  if (!text) {
    return [];
  }

  try {
    const parsed = JSON.parse(text);

    if (Array.isArray(parsed)) {
      return parseKeywords(parsed);
    }
  } catch {
    // Não é JSON; continua como texto separado.
  }

  return [
    ...new Set(
      text
        .split(/[,;\n|]+/)
        .map(item => item.trim())
        .filter(Boolean)
    )
  ];
}

function parseOptionalJson(value) {
  const text = cleanValue(value);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Não foi possível interpretar este JSON: ${text.slice(0, 80)}`
    );
  }
}

function stringifyJsonField(value) {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function toNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function toInteger(value, fallback = 0) {
  const number = Number.parseInt(value, 10);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function snapToGrid(value) {
  return Math.round(value / MAP_CONFIG.gridSize) *
    MAP_CONFIG.gridSize;
}

function truncateText(value, maximumLength = 120) {
  const text = String(value ?? "");

  return text.length > maximumLength
    ? `${text.slice(0, maximumLength - 1)}…`
    : text;
}

function sortByMultiple(list, fields) {
  return [...list].sort((a, b) => {
    for (const field of fields) {
      const aValue = a?.[field];
      const bValue = b?.[field];

      if (aValue === bValue) {
        continue;
      }

      if (aValue === null || aValue === undefined) {
        return 1;
      }

      if (bValue === null || bValue === undefined) {
        return -1;
      }

      if (
        typeof aValue === "number" ||
        typeof bValue === "number"
      ) {
        return Number(aValue) - Number(bValue);
      }

      return String(aValue).localeCompare(
        String(bValue),
        "pt-BR",
        { numeric: true }
      );
    }

    return 0;
  });
}

function removeUndefinedValues(object) {
  return Object.fromEntries(
    Object.entries(object).filter(
      ([, value]) => value !== undefined
    )
  );
}

function stripDatabaseFields(record) {
  const copy = { ...record };

  [
    "created_by",
    "updated_by",
    "deleted_at"
  ].forEach(field => {
    if (copy[field] === undefined) {
      delete copy[field];
    }
  });

  return copy;
}

async function createUniqueSceneKey(baseKey) {
  let key = slugify(baseKey) || `cena-${Date.now()}`;
  let suffix = 2;

  while (
    state.scenes.some(
      scene =>
        normalizeText(scene.scene_key || scene.slug) ===
        normalizeText(key)
    )
  ) {
    key = `${slugify(baseKey)}-${suffix}`;
    suffix += 1;
  }

  return key;
}

function getActionTypeLabel(type) {
  const labels = {
    response: "Responder",
    move: "Mudar de cena",
    item: "Entregar item",
    remove_item: "Remover item",
    secret: "Código secreto",
    condition: "Ação condicional",
    ending: "Encerrar jogo"
  };

  return labels[type] || "Ação";
}

function getActionTypeIcon(type) {
  const icons = {
    response: "“”",
    move: "→",
    item: "◆",
    remove_item: "◇",
    secret: "✦",
    condition: "?",
    ending: "■"
  };

  return icons[type] || "⚡";
}

function getRarityLabel(rarity) {
  const labels = {
    common: "Comum",
    uncommon: "Incomum",
    rare: "Raro",
    epic: "Épico",
    legendary: "Lendário"
  };

  return labels[rarity] || rarity || "Comum";
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);

  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}


/* ==========================================================
   25. HELPERS DE HTML E SEGURANÇA
   ========================================================== */

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(String(value));
  }

  return String(value).replace(
    /[^a-zA-Z0-9_-]/g,
    "\\$&"
  );
}

function createBadge(text, className = "", customColor = "") {
  const style = customColor
    ? `style="border-color:${escapeAttribute(customColor)};color:${escapeAttribute(customColor)}"`
    : "";

  return `
    <span class="badge ${escapeAttribute(className)}" ${style}>
      ${escapeHtml(text)}
    </span>
  `;
}

function createEmptyState(
  title,
  description,
  action = "",
  actionLabel = "",
  data = {}
) {
  const dataAttributes = Object.entries(data)
    .map(([key, value]) => {
      const attribute = key.replace(
        /[A-Z]/g,
        letter => `-${letter.toLowerCase()}`
      );

      return `data-${attribute}="${escapeAttribute(value)}"`;
    })
    .join(" ");

  return `
    <div class="empty-state">
      <div class="empty-state-inner">
        <div class="empty-state-icon">◇</div>

        <h3 class="empty-state-title">
          ${escapeHtml(title)}
        </h3>

        <p class="empty-state-description">
          ${escapeHtml(description)}
        </p>

        ${
          action
            ? `
              <div class="empty-state-action">
                <button
                  class="btn btn-primary"
                  data-action="${escapeAttribute(action)}"
                  ${dataAttributes}
                  type="button"
                >
                  ${escapeHtml(actionLabel)}
                </button>
              </div>
            `
            : ""
        }
      </div>
    </div>
  `;
}


/* ==========================================================
   26. ÁREA DE TRANSFERÊNCIA
   ========================================================== */

async function copyText(text) {
  const value = String(text ?? "");

  if (!value) {
    return;
  }

  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");

  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);

  textarea.select();
  document.execCommand("copy");

  textarea.remove();
}


/* ==========================================================
   27. COMPATIBILIDADE E DIAGNÓSTICO
   ========================================================== */

function isMissingTableError(error) {
  const message = normalizeText(
    `${error?.message || ""} ${error?.details || ""}`
  );

  return (
    message.includes("does not exist") ||
    message.includes("relation") &&
    message.includes("not found") ||
    error?.code === "42P01" ||
    error?.code === "PGRST205"
  );
}

function isMissingColumnError(error) {
  const message = normalizeText(
    `${error?.message || ""} ${error?.details || ""}`
  );

  return (
    message.includes("column") &&
    (
      message.includes("does not exist") ||
      message.includes("not found")
    )
  );
}


/* ==========================================================
   28. FUNÇÕES GLOBAIS DE COMPATIBILIDADE
   ========================================================== */

window.AdminApp = {
  state,

  refreshAllData,
  navigateToView,

  openNewSceneModal,
  openEditSceneModal,
  duplicateScene,
  toggleSceneStatus,
  deleteScene,

  openActionsModal,
  openNewActionModal,
  openEditActionModal,

  openNewRouteModal,
  openEditRouteModal,

  openNewItemModal,
  openEditItemModal,

  openMediaLibrary,

  renderMap,
  resetMapView,
  fitMapToScenes,
  saveAllMapPositions,

  logoutAdmin
};

/*
  Estas funções também ficam disponíveis diretamente no window
  para manter compatibilidade com botões antigos que ainda usem
  onclick="nomeDaFuncao()".
*/

window.openNewSceneModal = openNewSceneModal;
window.openEditSceneModal = openEditSceneModal;
window.openActionsModal = openActionsModal;
window.openNewRouteModal = openNewRouteModal;
window.openNewItemModal = openNewItemModal;
window.openMediaLibrary = openMediaLibrary;

window.refreshScenes = async function refreshScenes() {
  await Promise.all([
    loadScenes(),
    loadActions(),
    loadSceneItems()
  ]);

  applySceneFilters();
  renderScenesList();
  renderDashboard();
  renderMap();
};

window.loadPanelData = loadPanelData;
window.configureEvents = configureEvents;
window.logoutAdmin = logoutAdmin;
