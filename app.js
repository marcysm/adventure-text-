"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const statusElement = document.getElementById("system-status");
  const testButton = document.getElementById("test-button");

  if (!statusElement || !testButton) {
    console.error("Elementos principais da página não foram encontrados.");
    return;
  }

  statusElement.textContent = "Arquivos carregados corretamente.";
  statusElement.classList.add("is-success");

  testButton.addEventListener("click", () => {
    statusElement.textContent =
      "TESTE CONCLUÍDO: a interface está funcionando.";

    statusElement.classList.remove("is-error");
    statusElement.classList.add("is-success");
  });
});
