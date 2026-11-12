import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";
import { wrapCodexProvider } from "./transport.mjs";

export default function (pi: ExtensionAPI) {
  const stats = { requests: 0, compressedBytes: 0, jsonBytes: 0 };
  const base = builtinProviders().find((provider) => provider.id === "openai-codex");
  if (!base) throw new Error("codex-no-zstd: built-in openai-codex provider not found");

  // Native registration preserves built-in OAuth, live model metadata and models.json
  // overlays. Factory registration happens before session_start, when proxy-router
  // wraps providers; therefore its per-model SOCKS/HTTP fetch remains in use.
  pi.registerProvider(wrapCodexProvider(base, stats));
  pi.registerCommand("codex-transport", {
    description: "Проверить глобальный обход zstd для Codex HTTP/SSE",
    handler: async (_args, ctx) => {
      const text = "Codex HTTP/SSE: обход zstd включён. " +
        `Преобразовано запросов в этом runtime: ${stats.requests}; ` +
        `JSON: ${stats.jsonBytes} байт, исходное zstd: ${stats.compressedBytes} байт. ` +
        "Прокси, OAuth и история не меняются; WebSocket не затрагивается.";
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.log(text);
    },
  });
}
