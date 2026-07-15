"use strict";

/* ==========================================================
   CONFIGURAÇÃO DO SUPABASE
   ========================================================== */

(function initializeSupabase() {
  const SUPABASE_URL =
    "https://kigiofnknaqkxqpcaimy.supabase.co";

  const SUPABASE_ANON_KEY =
    "sb_publishable_bpe6CO0n5BLaTJdQZHvoXw_gLGkmvFH";

  if (!SUPABASE_URL || SUPABASE_URL.includes("COLE-AQUI")) {
    throw new Error(
      "A URL do Supabase ainda não foi configurada no config.js."
    );
  }

  if (
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes("COLE-AQUI")
  ) {
    throw new Error(
      "A chave pública do Supabase ainda não foi configurada no config.js."
    );
  }

  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    throw new Error(
      "A biblioteca Supabase não foi carregada antes do config.js."
    );
  }

  const client = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );

  /*
    Nome principal usado pelo novo admin.js.
  */
  window.supabaseClient = client;

  /*
    Nomes alternativos para manter compatibilidade
    com os arquivos antigos do projeto.
  */
  window.sb = client;
  window.supabaseApp = client;

  console.log("Cliente Supabase configurado.");
})();
