"use strict";

/* ==========================================================
   CONFIGURAÇÃO GLOBAL DO SUPABASE
   ========================================================== */

(function configureSupabaseClient() {
  const SUPABASE_URL =
    "https://kigiofnknaqkxqpcaimy.supabase.co";

  const SUPABASE_ANON_KEY =
    "sb_publishable_bpe6CO0n5BLaTJdQZHvoXw_gLGkmvFH";

  if (
    !window.supabase ||
    typeof window.supabase.createClient !== "function"
  ) {
    console.error(
      "A biblioteca oficial do Supabase não foi carregada."
    );

    return;
  }

  if (
    !SUPABASE_URL ||
    SUPABASE_URL.includes("COLE_AQUI")
  ) {
    console.error(
      "A URL do Supabase não foi configurada."
    );

    return;
  }

  if (
    !SUPABASE_ANON_KEY ||
    SUPABASE_ANON_KEY.includes("COLE_AQUI")
  ) {
    console.error(
      "A chave pública do Supabase não foi configurada."
    );

    return;
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

  window.supabaseClient = client;

  /*
    Compatibilidade com versões anteriores do projeto.
  */
  window.sb = client;
  window.supabaseApp = client;

  console.log("Supabase configurado corretamente.");
})();
