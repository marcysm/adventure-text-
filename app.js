"use strict";

/* ==========================================================
   CONFIGURAÇÕES FIXAS
   ========================================================== */

const GAME_SLUG = "artist-valley-adventure";

const DEFAULT_FALLBACK =
  "Não parece possível fazer isso agora.";

const SYSTEM_COMMANDS = {
  ajuda: ["ajuda", "help", "socorro"],
  repetir: ["repetir", "repita", "rever", "novamente"],
  inventario: [
    "inventario",
    "itens",
    "meus itens",
    "mochila"
  ],
  historico: [
    "historico",
    "história",
    "acoes",
    "ações",
    "passos anteriores"
  ]
};

/* ==========================================================
   ESTADO DA APLICAÇÃO
   ========================================================== */

const state = {
  client: null,
  user: null,
  profile: null,

  game: null,
  session: null,
  route: null,

  scene: null,
  blocks: [],
  responses: [],

  isProcessing: false
};

const elements = {};

/* ==========================================================
   INICIALIZAÇÃO
   ========================================================== */

document.addEventListener("DOMContentLoaded", initializeGame);

async function initializeGame() {
  cacheElements();
  configureInterfaceEvents();

  try {
    validateConfiguration();

    setLoadingMessage("CONECTANDO AO ARQUIVO CENTRAL...");

    state.client = createSupabaseClient();

    state.user = await getOrCreateAnonymousUser();

    setLoadingMessage("VERIFICANDO IDENTIDADE...");

    state.profile = await getOrCreatePlayerProfile(
      state.user.id
    );

    setLoadingMessage("LOCALIZANDO ARQUIVO NARRATIVO...");

    state.game = await loadGame();

    setLoadingMessage("RECUPERANDO PARTIDA...");

    state.session = await getOrCreateGameSession();

    await loadCurrentRoute();

    await loadCurrentScene();

    updatePermanentInterface();

    revealApplication();

    focusCommandInput();
  } catch (error) {
    console.error("Erro ao iniciar o jogo:", error);

    showFatalError(error);
  }
}

/* ==========================================================
   ELEMENTOS DA PÁGINA
   ========================================================== */

function cacheElements() {
  elements.loadingScreen =
    document.getElementById("loading-screen");

  elements.loadingMessage =
    document.getElementById("loading-message");

  elements.application =
    document.getElementById("application");

  elements.playerCode =
    document.getElementById("player-code");

  elements.routeName =
    document.getElementById("route-name");

  elements.gameTitle =
    document.getElementById("game-title");

  elements.sceneContainer =
    document.getElementById("scene-container");

  elements.systemMessage =
    document.getElementById("system-message");

  elements.commandForm =
    document.getElementById("command-form");

  elements.commandInput =
    document.getElementById("command-input");

  elements.sendButton =
    document.getElementById("send-button");

  elements.menuButton =
    document.getElementById("menu-button");

  elements.commandModal =
    document.getElementById("command-modal");

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
   CONFIGURAÇÃO DA INTERFACE
   ========================================================== */

function configureInterfaceEvents() {
  elements.commandForm.addEventListener(
    "submit",
    handleCommandSubmit
  );

  elements.menuButton.addEventListener(
    "click",
    openCommandModal
  );

  elements.commandModal.addEventListener(
    "click",
    handleModalClick
  );

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeCommandModal();
    }
  });
}

function handleModalClick(event) {
  const closeTarget = event.target.closest(
    "[data-close-modal]"
  );

  if (closeTarget) {
    closeCommandModal();
    return;
  }

  const commandButton = event.target.closest(
    "[data-command]"
  );

  if (!commandButton) {
    return;
  }

  const command = commandButton.dataset.command;

  closeCommandModal();

  elements.commandInput.value = command;

  elements.commandForm.requestSubmit();
}

function openCommandModal() {
  elements.commandModal.classList.remove("is-hidden");
}

function closeCommandModal() {
  elements.commandModal.classList.add("is-hidden");
}

/* ==========================================================
   SUPABASE
   ========================================================== */

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

  const {
    supabaseUrl,
    supabasePublishableKey
  } = window.APP_CONFIG;

  if (
    !supabaseUrl ||
    supabaseUrl.includes("COLE_AQUI")
  ) {
    throw new Error(
      "A Project URL não foi configurada."
    );
  }

  if (
    !supabasePublishableKey ||
    supabasePublishableKey.includes("COLE_AQUI")
  ) {
    throw new Error(
      "A Publishable Key não foi configurada."
    );
  }
}

function createSupabaseClient() {
  return window.supabase.createClient(
    window.APP_CONFIG.supabaseUrl,
    window.APP_CONFIG.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
}

async function getOrCreateAnonymousUser() {
  const {
    data: sessionData,
    error: sessionError
  } = await state.client.auth.getSession();

  if (sessionError) {
    throw sessionError;
  }

  if (sessionData.session?.user) {
    return sessionData.session.user;
  }

  const {
    data,
    error
  } = await state.client.auth.signInAnonymously();

  if (error) {
    throw error;
  }

  if (!data.user) {
    throw new Error(
      "Não foi possível criar a identidade do jogador."
    );
  }

  return data.user;
}

async function getOrCreatePlayerProfile(userId) {
  const {
    data: existingProfile,
    error: readError
  } = await state.client
    .from("player_profiles")
    .select(
      "user_id, player_code, created_at, last_seen_at"
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existingProfile) {
    const {
      data: updatedProfile,
      error: updateError
    } = await state.client
      .from("player_profiles")
      .update({
        last_seen_at: new Date().toISOString()
      })
      .eq("user_id", userId)
      .select(
        "user_id, player_code, created_at, last_seen_at"
      )
      .single();

    if (updateError) {
      throw updateError;
    }

    return updatedProfile;
  }

  const profile = {
    user_id: userId,
    player_code: generatePlayerCode(),
    last_seen_at: new Date().toISOString()
  };

  const {
    data: createdProfile,
    error: createError
  } = await state.client
    .from("player_profiles")
    .insert(profile)
    .select(
      "user_id, player_code, created_at, last_seen_at"
    )
    .single();

  if (createError) {
    throw createError;
  }

  return createdProfile;
}

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
      description,
      default_fallback_text,
      start_scene_id,
      is_published
    `)
    .eq("slug", GAME_SLUG)
    .eq("is_published", true)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

/* ==========================================================
   PARTIDA
   ========================================================== */

async function getOrCreateGameSession() {
  const {
    data: existingSession,
    error: readError
  } = await state.client
    .from("game_sessions")
    .select(`
      id,
      user_id,
      game_id,
      current_scene_id,
      route_id,
      session_name,
      status,
      started_at,
      updated_at,
      completed_at
    `)
    .eq("user_id", state.user.id)
    .eq("game_id", state.game.id)
    .eq("status", "active")
    .order("updated_at", {
      ascending: false
    })
    .limit(1)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (existingSession) {
    return existingSession;
  }

  const newSession = {
    user_id: state.user.id,
    game_id: state.game.id,
    current_scene_id: state.game.start_scene_id,
    route_id: null,
    session_name: "Partida principal",
    status: "active",
    updated_at: new Date().toISOString()
  };

  const {
    data: createdSession,
    error: createError
  } = await state.client
    .from("game_sessions")
    .insert(newSession)
    .select(`
      id,
      user_id,
      game_id,
      current_scene_id,
      route_id,
      session_name,
      status,
      started_at,
      updated_at,
      completed_at
    `)
    .single();

  if (createError) {
    throw createError;
  }

  await addHistoryEntry({
    sceneId: state.game.start_scene_id,
    entryType: "system",
    displayedText: "Partida iniciada."
  }, createdSession.id);

  return createdSession;
}

async function updateSession(changes) {
  const updateData = {
    ...changes,
    updated_at: new Date().toISOString()
  };

  /*
    Primeiro realizamos a atualização sem exigir que
    o Supabase devolva exatamente uma linha.
  */
  const {
    error: updateError
  } = await state.client
    .from("game_sessions")
    .update(updateData)
    .eq("id", state.session.id)
    .eq("user_id", state.user.id)
    .eq("game_id", state.game.id);

  if (updateError) {
    throw updateError;
  }

  /*
    Depois consultamos novamente a partida atual.
  */
  const {
    data: updatedSession,
    error: readError
  } = await state.client
    .from("game_sessions")
    .select(`
      id,
      user_id,
      game_id,
      current_scene_id,
      route_id,
      session_name,
      status,
      started_at,
      updated_at,
      completed_at
    `)
    .eq("id", state.session.id)
    .eq("user_id", state.user.id)
    .eq("game_id", state.game.id)
    .maybeSingle();

  if (readError) {
    throw readError;
  }

  if (!updatedSession) {
    throw new Error(
      "A partida não pôde ser atualizada. Verifique as permissões de game_sessions."
    );
  }

  state.session = updatedSession;
}

/* ==========================================================
   ROTA
   ========================================================== */

async function loadCurrentRoute() {
  if (!state.session.route_id) {
    state.route = null;
    applyDefaultTheme();
    return;
  }

  const {
    data,
    error
  } = await state.client
    .from("routes")
    .select(`
      id,
      game_id,
      code,
      name,
      description,
      primary_color,
      secondary_color,
      background_color,
      panel_color,
      background_image_url,
      start_scene_id,
      is_secret,
      is_initially_available,
      is_enabled
    `)
    .eq("id", state.session.route_id)
    .single();

  if (error) {
    throw error;
  }

  state.route = data;

  applyRouteTheme(data);
}

function applyDefaultTheme() {
  const root = document.documentElement;

  root.style.setProperty(
    "--route-primary",
    "#e8e8e8"
  );

  root.style.setProperty(
    "--route-secondary",
    "#8a8a8a"
  );

  root.style.setProperty(
    "--route-background",
    "#030303"
  );

  root.style.setProperty(
    "--route-panel",
    "#0c0c0c"
  );

  document.body.style.backgroundImage = "";
}

function applyRouteTheme(route) {
  const root = document.documentElement;

  root.style.setProperty(
    "--route-primary",
    route.primary_color || "#e8e8e8"
  );

  root.style.setProperty(
    "--route-secondary",
    route.secondary_color || "#8a8a8a"
  );

  root.style.setProperty(
    "--route-background",
    route.background_color || "#030303"
  );

  root.style.setProperty(
    "--route-panel",
    route.panel_color || "#0c0c0c"
  );

  if (route.background_image_url) {
    document.body.style.backgroundImage =
      `url("${route.background_image_url}")`;
  } else {
    document.body.style.backgroundImage = "";
  }
}

/* ==========================================================
   CENAS
   ========================================================== */

async function loadCurrentScene() {
  if (!state.session.current_scene_id) {
    throw new Error(
      "A partida não possui uma cena atual."
    );
  }

  setProcessing(true);
  clearSystemMessage();

  try {
    const [
      sceneResult,
      blocksResult,
      responsesResult
    ] = await Promise.all([
      state.client
        .from("scenes")
        .select(`
          id,
          game_id,
          route_id,
          scene_key,
          title,
          fallback_text,
          help_mode,
          help_text,
          allow_repeat,
          allow_inventory,
          allow_history,
          allow_map,
          is_ending,
          ending_type
        `)
      .eq("id", state.session.current_scene_id)
.maybeSingle(),

      state.client
        .from("scene_blocks")
        .select(`
          id,
          scene_id,
          block_type,
          content,
          media_url,
          alt_text,
          text_color,
          animation_type,
          display_order
        `)
        .eq("scene_id", state.session.current_scene_id)
        .eq("is_enabled", true)
        .order("display_order", {
          ascending: true
        }),

     state.client
  .from("scene_responses")
  .select(`
    id,
    scene_id,

    internal_name,
    response_key,
    admin_description,

    match_mode,
    exact_phrase,

    required_words,
    optional_words,
    forbidden_words,
    synonyms,

    action_words,
    target_words,
    blocked_words,

    response_text,

    target_scene_id,
    target_route_id,

    next_scene_id,
    set_route_id,

    required_flag_key,
    blocked_flag_key,
    required_item_key,

    give_item_key,
    remove_item_key,
    set_flag_key,

    priority,
    display_order,
    is_enabled
  `)
        .eq("scene_id", state.session.current_scene_id)
        .eq("is_enabled", true)
        .order("priority", {
          ascending: false
        })
    ]);

    if (sceneResult.error) {
      throw sceneResult.error;
    }

if (!sceneResult.data) {
  throw new Error(
    "A cena atual não existe ou está desativada."
  );
}
     
    if (blocksResult.error) {
      throw blocksResult.error;
    }

    if (responsesResult.error) {
      throw responsesResult.error;
    }

    state.scene = sceneResult.data;
    state.blocks = blocksResult.data || [];
    state.responses = responsesResult.data || [];

    renderCurrentScene();

    await addHistoryEntry({
      sceneId: state.scene.id,
      entryType: "scene",
      displayedText:
        state.scene.title || state.scene.scene_key
    });
  } finally {
    setProcessing(false);
  }
}

function renderCurrentScene() {
  elements.sceneContainer.replaceChildren();

  if (state.scene.title) {
    const title = document.createElement("h1");

    title.className = "scene-title";
    title.textContent = state.scene.title;

    elements.sceneContainer.appendChild(title);
  }

  if (state.blocks.length === 0) {
    const emptyMessage = document.createElement("p");

    emptyMessage.className =
      "scene-block scene-block--system";

    emptyMessage.textContent =
      "NENHUM CONTEÚDO FOI REGISTRADO PARA ESTA CENA.";

    elements.sceneContainer.appendChild(emptyMessage);

    return;
  }

  state.blocks.forEach((block, index) => {
    const renderedBlock = createBlockElement(block);

    if (!renderedBlock) {
      return;
    }

    renderedBlock.style.animationDelay =
      `${Math.min(index * 110, 660)}ms`;

    elements.sceneContainer.appendChild(renderedBlock);
  });
}

function createBlockElement(block) {
  let element = null;

  switch (block.block_type) {
    case "title":
      element = document.createElement("h2");
      element.className =
        "scene-block scene-title";
      element.textContent = block.content || "";
      break;

    case "text":
      element = document.createElement("p");
      element.className =
        "scene-block scene-block--text";
      element.textContent = block.content || "";
      break;

    case "system_message":
      element = document.createElement("p");
      element.className =
        "scene-block scene-block--system";
      element.textContent = block.content || "";
      break;

    case "ascii":
      element = document.createElement("pre");
      element.className =
        "scene-block scene-block--ascii";
      element.textContent = block.content || "";
      break;

    case "image":
    case "pixel_art":
      if (!block.media_url) {
        return null;
      }

      element = document.createElement("figure");
      element.className =
        "scene-block scene-block--image";

      const image = document.createElement("img");

      image.src = block.media_url;
      image.alt = block.alt_text || "";

      if (block.block_type === "pixel_art") {
        image.style.imageRendering = "pixelated";
      }

      element.appendChild(image);
      break;

    case "divider":
      element = document.createElement("div");
      element.className =
        "scene-block scene-divider";
      break;

    case "audio":
      if (!block.media_url) {
        return null;
      }

      element = document.createElement("audio");
      element.className = "scene-block";
      element.controls = true;
      element.src = block.media_url;
      break;

    default:
      return null;
  }

  if (block.text_color) {
    element.style.color = block.text_color;
  }

  if (
    block.animation_type &&
    block.animation_type !== "none"
  ) {
    element.classList.add(
      `animation-${block.animation_type}`
    );
  }

  return element;
}

/* ==========================================================
   ENVIO E INTERPRETAÇÃO
   ========================================================== */

async function handleCommandSubmit(event) {
  event.preventDefault();

  if (state.isProcessing) {
    return;
  }

  const originalInput =
    elements.commandInput.value.trim();

  if (!originalInput) {
    focusCommandInput();
    return;
  }

  elements.commandInput.value = "";

  setProcessing(true);
  clearSystemMessage();

  try {
    await addHistoryEntry({
      sceneId: state.scene.id,
      entryType: "action",
      playerInput: originalInput,
      displayedText: originalInput
    });

const normalizedInput = normalizeText(originalInput);

/*
  Antes de procurar comandos ou respostas normais,
  o banco verifica se foi digitado um código secreto.
*/
const secretWasActivated =
  await tryExecuteSecretCode(originalInput);

if (secretWasActivated) {
  return;
}

const systemCommand =
  identifySystemCommand(normalizedInput);

    if (systemCommand) {
      await executeSystemCommand(systemCommand);
      return;
    }

    const matchedResponse =
      await findMatchingResponse(normalizedInput);

    if (!matchedResponse) {
      await handleUnrecognizedInput(
        originalInput,
        normalizedInput
      );

      return;
    }

    await executeSceneResponse(matchedResponse);
  } catch (error) {
    console.error(
      "Erro ao processar comando:",
      error
    );

    showSystemMessage(
      `ERRO: ${formatErrorMessage(error)}`,
      "error"
    );
  } finally {
    setProcessing(false);
    focusCommandInput();
  }
}

function normalizeText(value) {
  return String(value)
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function identifySystemCommand(normalizedInput) {
  for (
    const [commandName, variations]
    of Object.entries(SYSTEM_COMMANDS)
  ) {
    const normalizedVariations =
      variations.map(normalizeText);

    if (normalizedVariations.includes(normalizedInput)) {
      return commandName;
    }
  }

  return null;
}

async function findMatchingResponse(
  normalizedInput
) {
  const flags =
    await loadPlayerFlags();

  const inventory =
    await loadPlayerInventory();

  /*
    As respostas já chegam ordenadas por prioridade.
    Portanto, a primeira regra válida encontrada vence.
  */
  for (const response of state.responses) {
    if (
      !responseConditionsPass(
        response,
        flags,
        inventory
      )
    ) {
      continue;
    }

    if (
      responseMatchesInput(
        response,
        normalizedInput
      )
    ) {
      return response;
    }
  }

  return null;
}


/* ==========================================================
   RECONHECIMENTO DO NOVO FORMATO
   ========================================================== */

function responseMatchesInput(
  response,
  normalizedInput
) {
  const matchMode =
    response.match_mode ||
    inferLegacyMatchMode(response);

  /*
    FRASE EXATA
  */
  if (matchMode === "exact") {
    const exactPhrase =
      normalizeText(
        response.exact_phrase || ""
      );

    return (
      Boolean(exactPhrase) &&
      exactPhrase === normalizedInput
    );
  }

  /*
    Caso seja uma resposta antiga, mantemos
    o sistema action_words + target_words.
  */
  if (matchMode === "legacy") {
    return legacyResponseMatchesInput(
      response,
      normalizedInput
    );
  }

  const synonyms =
    normalizeSynonymGroups(
      response.synonyms
    );

  const commandWords =
    createExpandedCommandWords(
      normalizedInput,
      synonyms
    );

  const requiredWords =
    normalizeWordList(
      response.required_words
    );

  const optionalWords =
    normalizeWordList(
      response.optional_words
    );

  const forbiddenWords =
    normalizeWordList(
      response.forbidden_words
    );

  /*
    Se uma palavra proibida aparecer,
    a regra é imediatamente rejeitada.
  */
  const hasForbiddenWord =
    forbiddenWords.some(word =>
      commandContainsExpression(
        commandWords,
        normalizedInput,
        word
      )
    );

  if (hasForbiddenWord) {
    return false;
  }

  /*
    QUALQUER PALAVRA

    Basta uma palavra obrigatória ou opcional
    aparecer no comando.
  */
  if (matchMode === "any_keyword") {
    const availableWords = [
      ...requiredWords,
      ...optionalWords
    ];

    return availableWords.some(word =>
      commandContainsExpression(
        commandWords,
        normalizedInput,
        word
      )
    );
  }

  /*
    PALAVRAS COMBINADAS

    Todas as obrigatórias precisam aparecer.
  */
  const hasAllRequiredWords =
    requiredWords.every(word =>
      commandContainsExpression(
        commandWords,
        normalizedInput,
        word
      )
    );

  if (!hasAllRequiredWords) {
    return false;
  }

  /*
    Quando existem palavras opcionais,
    pelo menos uma precisa aparecer.

    Sem palavras opcionais, as obrigatórias bastam.
  */
  if (optionalWords.length > 0) {
    return optionalWords.some(word =>
      commandContainsExpression(
        commandWords,
        normalizedInput,
        word
      )
    );
  }

  return requiredWords.length > 0;
}


function inferLegacyMatchMode(response) {
  if (
    response.exact_phrase &&
    normalizeText(
      response.exact_phrase
    )
  ) {
    return "exact";
  }

  if (
    Array.isArray(response.action_words) ||
    Array.isArray(response.target_words)
  ) {
    return "legacy";
  }

  return "keywords";
}


function legacyResponseMatchesInput(
  response,
  normalizedInput
) {
  const blockedWords =
    normalizeWordList(
      response.blocked_words
    );

  if (
    blockedWords.some(word =>
      containsWholeWord(
        normalizedInput,
        word
      )
    )
  ) {
    return false;
  }

  const actionWords =
    normalizeWordList(
      response.action_words
    );

  const targetWords =
    normalizeWordList(
      response.target_words
    );

  const hasAction =
    actionWords.length === 0 ||
    actionWords.some(word =>
      containsWholeWord(
        normalizedInput,
        word
      )
    );

  const hasTarget =
    targetWords.length === 0 ||
    targetWords.some(word =>
      containsWholeWord(
        normalizedInput,
        word
      )
    );

  return hasAction && hasTarget;
}


function normalizeSynonymGroups(synonyms) {
  if (
    !synonyms ||
    typeof synonyms !== "object" ||
    Array.isArray(synonyms)
  ) {
    return {};
  }

  const normalizedGroups = {};

  Object.entries(synonyms).forEach(
    ([mainWord, synonymList]) => {
      const normalizedMainWord =
        normalizeText(mainWord);

      if (!normalizedMainWord) {
        return;
      }

      const normalizedSynonyms =
        Array.isArray(synonymList)
          ? synonymList
              .map(normalizeText)
              .filter(Boolean)
          : [];

      normalizedGroups[
        normalizedMainWord
      ] = normalizedSynonyms;
    }
  );

  return normalizedGroups;
}


function createExpandedCommandWords(
  normalizedInput,
  synonymGroups
) {
  const expandedWords =
    new Set(
      normalizedInput
        .split(" ")
        .filter(Boolean)
    );

  Object.entries(
    synonymGroups
  ).forEach(
    ([mainWord, synonyms]) => {
      const mainWordPresent =
        containsWholeWord(
          normalizedInput,
          mainWord
        );

      const synonymPresent =
        synonyms.some(synonym =>
          containsWholeWord(
            normalizedInput,
            synonym
          )
        );

      if (
        !mainWordPresent &&
        !synonymPresent
      ) {
        return;
      }

      expandedWords.add(mainWord);

      synonyms.forEach(synonym => {
        expandedWords.add(synonym);
      });
    }
  );

  return expandedWords;
}


function commandContainsExpression(
  expandedWords,
  normalizedInput,
  expression
) {
  if (!expression) {
    return false;
  }

  /*
    Expressões com mais de uma palavra são verificadas
    diretamente no texto completo.
  */
  if (expression.includes(" ")) {
    return normalizedInput.includes(
      expression
    );
  }

  return expandedWords.has(expression);
}

function normalizeWordList(words) {
  if (!Array.isArray(words)) {
    return [];
  }

  return words
    .map(normalizeText)
    .filter(Boolean);
}

function containsWholeWord(input, searchedWord) {
  if (!searchedWord) {
    return false;
  }

  if (searchedWord.includes(" ")) {
    return input.includes(searchedWord);
  }

  return input
    .split(" ")
    .includes(searchedWord);
}

function responseConditionsPass(
  response,
  flags,
  inventory
) {
  if (
    response.required_flag_key &&
    !flags.has(response.required_flag_key)
  ) {
    return false;
  }

  if (
    response.blocked_flag_key &&
    flags.has(response.blocked_flag_key)
  ) {
    return false;
  }

  if (
    response.required_item_key &&
    !inventory.has(response.required_item_key)
  ) {
    return false;
  }

  return true;
}

/* ==========================================================
   CÓDIGOS SECRETOS
   ========================================================== */

async function tryExecuteSecretCode(originalInput) {
  const {
    data,
    error
  } = await state.client.rpc(
    "process_secret_code",
    {
      p_session_id: state.session.id,
      p_input: originalInput
    }
  );

  if (error) {
    console.error(
      "Erro ao verificar código secreto:",
      error
    );

    throw error;
  }

  if (!data?.matched) {
    return false;
  }

   /*
  O código administrativo não altera a partida.
  Ele apenas encaminha para a página protegida de login.
*/
if (data.action_type === "open_admin_login") {
  if (data.message) {
    showSystemMessage(
      data.message,
      "response"
    );

    await wait(1100);
  }

  const redirectPath =
    data.redirect_path || "admin-login.html";

  window.location.href = redirectPath;

  return true;
}
   
  if (data.message) {
    showSystemMessage(
      data.message,
      "response"
    );

    await wait(1200);
  }

  /*
    Atualizamos o estado local com o resultado
    devolvido pela função segura.
  */
  state.session.current_scene_id =
    data.current_scene_id;

  state.session.route_id =
    data.route_id;

  /*
    A rota e a cena são carregadas novamente.
  */
  await loadCurrentRoute();

  updatePermanentInterface();

  clearSystemMessage();

  await loadCurrentScene();

  /*
    Pequeno efeito visual quando uma rota secreta
    é ativada.
  */
  document.body.classList.add(
    "secret-route-activated"
  );

  window.setTimeout(() => {
    document.body.classList.remove(
      "secret-route-activated"
    );
  }, 1300);

  return true;
}

/* ==========================================================
   EXECUÇÃO DAS RESPOSTAS
   ========================================================== */

async function executeSceneResponse(response) {
  /*
    Primeiro mostramos a resposta cadastrada.
  */
  if (response.response_text) {
    showSystemMessage(
      response.response_text,
      "response"
    );

    await addHistoryEntry({
      sceneId: state.scene.id,
      entryType: "system",
      displayedText:
        response.response_text
    });

    await wait(650);
  }

  /*
    Mantemos compatibilidade com as funções antigas
    de flags e inventário.
  */
  if (response.set_flag_key) {
    await setPlayerFlag(
      response.set_flag_key
    );
  }

  if (response.give_item_key) {
    await givePlayerItem(
      response.give_item_key
    );
  }

  if (response.remove_item_key) {
    await removePlayerItem(
      response.remove_item_key
    );
  }

  /*
    O painel novo utiliza:
      target_route_id
      target_scene_id

    Os caminhos antigos utilizam:
      set_route_id
      next_scene_id

    Aceitamos os dois formatos.
  */
  const targetRouteId =
    response.target_route_id ||
    response.set_route_id ||
    null;

  const targetSceneId =
    response.target_scene_id ||
    response.next_scene_id ||
    null;

  const sessionChanges = {};

  if (targetRouteId) {
    sessionChanges.route_id =
      targetRouteId;
  }

  if (targetSceneId) {
    sessionChanges.current_scene_id =
      targetSceneId;
  }

  /*
    Se o caminho só possui uma resposta e não altera
    a cena nem a rota, encerramos aqui.
  */
  if (
    Object.keys(sessionChanges).length === 0
  ) {
    return;
  }

  /*
    Salvamos o novo destino na partida.
  */
  await updateSession(
    sessionChanges
  );

  /*
    Recarregamos a rota, pois ela pode ter mudado.
  */
  await loadCurrentRoute();

  updatePermanentInterface();

  /*
    Limpamos a mensagem anterior antes de desenhar
    a nova cena.
  */
  clearSystemMessage();

  /*
    Carregamos a cena de destino e seus novos caminhos.
  */
  await loadCurrentScene();
}

async function handleUnrecognizedInput(
  originalInput,
  normalizedInput
) {
  const {
    error
  } = await state.client
    .from("unrecognized_inputs")
    .insert({
      session_id: state.session.id,
      scene_id: state.scene.id,
      player_input: originalInput,
      normalized_input: normalizedInput
    });

  if (error) {
    console.warn(
      "Não foi possível registrar a entrada:",
      error
    );
  }

  const fallbackText =
    state.scene.fallback_text ||
    state.game.default_fallback_text ||
    DEFAULT_FALLBACK;

  showSystemMessage(fallbackText, "error");

  await addHistoryEntry({
    sceneId: state.scene.id,
    entryType: "error",
    playerInput: originalInput,
    displayedText: fallbackText
  });
}

/* ==========================================================
   COMANDOS DO SISTEMA
   ========================================================== */

async function executeSystemCommand(command) {
  switch (command) {
    case "ajuda":
      await executeHelpCommand();
      break;

    case "repetir":
      await executeRepeatCommand();
      break;

    case "inventario":
      await executeInventoryCommand();
      break;

    case "historico":
      await executeHistoryCommand();
      break;

    default:
      showSystemMessage(
        state.game.default_fallback_text,
        "error"
      );
  }
}

async function executeHelpCommand() {
  switch (state.scene.help_mode) {
    case "silent":
      clearSystemMessage();
      elements.systemMessage.classList.add(
        "is-silent"
      );
      return;

    case "disabled":
      showSystemMessage(
        state.scene.fallback_text ||
        state.game.default_fallback_text,
        "error"
      );
      return;

    case "custom":
      showSystemMessage(
        state.scene.help_text ||
        "Nenhuma orientação foi registrada.",
        "response"
      );
      return;

    case "normal":
    default:
      showSystemMessage(
        state.scene.help_text ||
        "Digite ações curtas. Experimente EXAMINAR, ABRIR, PEGAR, FALAR, IR ou USAR.",
        "response"
      );
  }
}

async function executeRepeatCommand() {
  if (!state.scene.allow_repeat) {
    showSystemMessage(
      state.scene.fallback_text ||
      state.game.default_fallback_text,
      "error"
    );

    return;
  }

  clearSystemMessage();
  renderCurrentScene();
}

async function executeInventoryCommand() {
  if (!state.scene.allow_inventory) {
    showSystemMessage(
      state.scene.fallback_text ||
      state.game.default_fallback_text,
      "error"
    );

    return;
  }

  const {
    data,
    error
  } = await state.client
    .from("player_inventory")
    .select(`
      item_key,
      quantity,
      acquired_at,
      item:items (
        name,
        description
      )
    `)
    .eq("session_id", state.session.id)
    .gt("quantity", 0)
    .order("acquired_at", {
      ascending: true
    });

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    showSystemMessage(
      "INVENTÁRIO\n\nNenhum objeto foi encontrado.",
      "response"
    );

    return;
  }

  const lines = data.map(entry => {
    const itemName =
      entry.item?.name ||
      entry.item_key;

    const quantityText =
      entry.quantity > 1
        ? ` ×${entry.quantity}`
        : "";

    return `— ${itemName}${quantityText}`;
  });

  showSystemMessage(
    `INVENTÁRIO\n\n${lines.join("\n")}`,
    "response"
  );
}

async function executeHistoryCommand() {
  if (!state.scene.allow_history) {
    showSystemMessage(
      state.scene.fallback_text ||
      state.game.default_fallback_text,
      "error"
    );

    return;
  }

  const {
    data,
    error
  } = await state.client
    .from("player_history")
    .select(`
      id,
      entry_type,
      player_input,
      displayed_text,
      created_at
    `)
    .eq("session_id", state.session.id)
    .order("created_at", {
      ascending: false
    })
    .limit(8);

  if (error) {
    throw error;
  }

  if (!data || data.length === 0) {
    showSystemMessage(
      "HISTÓRICO\n\nNenhum acontecimento foi registrado.",
      "response"
    );

    return;
  }

  const orderedEntries = [...data].reverse();

  const lines = orderedEntries
    .map(formatHistoryEntry)
    .filter(Boolean);

  showSystemMessage(
    `HISTÓRICO\n\n${lines.join("\n")}`,
    "response"
  );
}

function formatHistoryEntry(entry) {
  switch (entry.entry_type) {
    case "scene":
      return `— Cena: ${entry.displayed_text}`;

    case "action":
      return `> ${entry.player_input}`;

    case "item":
      return `— Item: ${entry.displayed_text}`;

    case "route":
      return `— Rota: ${entry.displayed_text}`;

    case "secret":
      return `— ${entry.displayed_text}`;

    case "error":
      return null;

    default:
      return entry.displayed_text
        ? `— ${entry.displayed_text}`
        : null;
  }
}

/* ==========================================================
   FLAGS
   ========================================================== */

async function loadPlayerFlags() {
  const {
    data,
    error
  } = await state.client
    .from("player_flags")
    .select("flag_key, flag_value")
    .eq("session_id", state.session.id);

  if (error) {
    throw error;
  }

  return new Map(
    (data || []).map(entry => [
      entry.flag_key,
      entry.flag_value
    ])
  );
}

async function setPlayerFlag(
  flagKey,
  flagValue = "true"
) {
  const {
    error
  } = await state.client
    .from("player_flags")
    .upsert(
      {
        session_id: state.session.id,
        flag_key: flagKey,
        flag_value: flagValue,
        updated_at: new Date().toISOString()
      },
      {
        onConflict: "session_id,flag_key"
      }
    );

  if (error) {
    throw error;
  }
}

/* ==========================================================
   INVENTÁRIO
   ========================================================== */

async function loadPlayerInventory() {
  const {
    data,
    error
  } = await state.client
    .from("player_inventory")
    .select("item_key, quantity")
    .eq("session_id", state.session.id)
    .gt("quantity", 0);

  if (error) {
    throw error;
  }

  return new Map(
    (data || []).map(entry => [
      entry.item_key,
      entry.quantity
    ])
  );
}

async function givePlayerItem(itemKey) {
  const {
    data: item,
    error: itemError
  } = await state.client
    .from("items")
    .select("id, item_key, name")
    .eq("game_id", state.game.id)
    .eq("item_key", itemKey)
    .maybeSingle();

  if (itemError) {
    throw itemError;
  }

  if (!item) {
    throw new Error(
      `O item "${itemKey}" não foi encontrado.`
    );
  }

  const inventory = await loadPlayerInventory();

  const currentQuantity =
    inventory.get(itemKey) || 0;

  const {
    error
  } = await state.client
    .from("player_inventory")
    .upsert(
      {
        session_id: state.session.id,
        item_id: item.id,
        item_key: item.item_key,
        quantity: currentQuantity + 1
      },
      {
        onConflict: "session_id,item_key"
      }
    );

  if (error) {
    throw error;
  }

  await addHistoryEntry({
    sceneId: state.scene.id,
    entryType: "item",
    displayedText: `${item.name} foi adicionado ao inventário.`
  });
}

async function removePlayerItem(itemKey) {
  const inventory = await loadPlayerInventory();

  const currentQuantity =
    inventory.get(itemKey) || 0;

  if (currentQuantity <= 0) {
    return;
  }

  if (currentQuantity === 1) {
    const {
      error
    } = await state.client
      .from("player_inventory")
      .delete()
      .eq("session_id", state.session.id)
      .eq("item_key", itemKey);

    if (error) {
      throw error;
    }

    return;
  }

  const {
    error
  } = await state.client
    .from("player_inventory")
    .update({
      quantity: currentQuantity - 1
    })
    .eq("session_id", state.session.id)
    .eq("item_key", itemKey);

  if (error) {
    throw error;
  }
}

/* ==========================================================
   HISTÓRICO
   ========================================================== */

async function addHistoryEntry(
  {
    sceneId = null,
    entryType = "system",
    playerInput = null,
    displayedText = null
  },
  sessionId = state.session?.id
) {
  if (!sessionId) {
    return;
  }

  const {
    error
  } = await state.client
    .from("player_history")
    .insert({
      session_id: sessionId,
      scene_id: sceneId,
      entry_type: entryType,
      player_input: playerInput,
      displayed_text: displayedText
    });

  if (error) {
    console.warn(
      "Não foi possível registrar o histórico:",
      error
    );
  }
}

/* ==========================================================
   INTERFACE PERMANENTE
   ========================================================== */

function updatePermanentInterface() {
  elements.playerCode.textContent =
    state.profile.player_code;

  elements.gameTitle.textContent =
    state.game.title.toLocaleUpperCase("pt-BR");

  elements.routeName.textContent =
    state.route
      ? state.route.name.toLocaleUpperCase("pt-BR")
      : "NÃO DEFINIDA";
}

function revealApplication() {
  elements.loadingScreen.classList.add("is-hidden");
  elements.application.classList.remove("is-hidden");
}

/* ==========================================================
   MENSAGENS E ESTADOS
   ========================================================== */

function setLoadingMessage(message) {
  elements.loadingMessage.textContent = message;
}

function showSystemMessage(message, type = "response") {
  elements.systemMessage.className =
    `system-message is-${type}`;

  elements.systemMessage.textContent = message;
}

function clearSystemMessage() {
  elements.systemMessage.className =
    "system-message";

  elements.systemMessage.textContent = "";
}

function setProcessing(isProcessing) {
  state.isProcessing = isProcessing;

  elements.commandInput.disabled = isProcessing;
  elements.sendButton.disabled = isProcessing;
}

function focusCommandInput() {
  window.setTimeout(() => {
    if (!state.isProcessing) {
      elements.commandInput.focus();
    }
  }, 30);
}

function showFatalError(error) {
  setLoadingMessage(
    `FALHA AO ABRIR O ARQUIVO: ${formatErrorMessage(error)}`
  );

  elements.loadingScreen.classList.remove("is-hidden");
  elements.application.classList.add("is-hidden");
}

function formatErrorMessage(error) {
  const message = String(
    error?.message || "Erro desconhecido."
  );

  if (
    message.toLowerCase().includes(
      "anonymous sign-ins are disabled"
    )
  ) {
    return "O login anônimo não está ativado.";
  }

  if (
    message.toLowerCase().includes(
      "invalid api key"
    )
  ) {
    return "A chave pública do Supabase está incorreta.";
  }

  if (
    message.toLowerCase().includes(
      "failed to fetch"
    )
  ) {
    return "Não foi possível alcançar o Supabase.";
  }

  return message;
}

/* ==========================================================
   UTILIDADES
   ========================================================== */

function generatePlayerCode() {
  return [
    "ARQ",
    generateRandomPart(4),
    generateRandomPart(4)
  ].join("-");
}

function generateRandomPart(length) {
  const characters =
    "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  const values = new Uint32Array(length);

  crypto.getRandomValues(values);

  return Array.from(values, value => {
    return characters[value % characters.length];
  }).join("");
}

function wait(milliseconds) {
  return new Promise(resolve => {
    window.setTimeout(resolve, milliseconds);
  });
}
