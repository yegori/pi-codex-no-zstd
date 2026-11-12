import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Opt-in only: explicitly load with -e and invoke /codex-synthetic-probe.
// Uses Pi's existing credentials. Never reads project files or prints headers/tokens.
export default function (pi: ExtensionAPI) {
  pi.registerCommand("codex-synthetic-probe", {
    description: "Send one synthetic Codex transport test (uses model quota)",
    handler: async (_args, ctx) => {
      const model = ctx.model;
      if (!model || model.provider !== "openai-codex") {
        throw new Error("Select an openai-codex model before running this probe");
      }
      const body = {
        model: model.id,
        instructions: "Diagnostic transport test. Ignore filler. Reply OK only. Do not call tools.",
        input: [{ role: "user", content: "a".repeat(140000) }],
        stream: true, store: false, reasoning: { effort: "low" },
      };
      let status: number | undefined;
      const result = await ctx.modelRegistry.complete(model, {
        messages: [{ role: "user", content: "Synthetic check only.", timestamp: Date.now() }],
      }, {
        transport: "sse", timeoutMs: 45000,
        onPayload: () => body,
        onResponse: response => { status = response.status; },
      });
      const text = result.content.filter(block => block.type === "text").map(block => block.text).join("");
      const ok = status === 200 && result.stopReason === "stop" && text.trim() === "OK";
      console.log(JSON.stringify({ probe: "synthetic Codex HTTP/SSE", jsonBytes: Buffer.byteLength(JSON.stringify(body)), status, stopReason: result.stopReason, ok }));
      if (!ok) {
        process.exitCode = 1;
        throw new Error("Synthetic transport probe failed; no private payload logged");
      }
      pi.sendUserMessage("/codex-transport", { expandPromptTemplates: true });
    },
  });
}
