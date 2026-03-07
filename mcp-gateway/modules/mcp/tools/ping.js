// modules/mcp/tools/ping.js
"use strict";

module.exports = {
  name: "ping",
  description: "Simple connectivity check. Returns pong with the input message echoed back.",
  inputSchema: {
    message: { type: "string", description: "Optional message to echo", required: false },
  },
  async handler(_ctx, input) {
    return {
      ok: true,
      data: {
        pong: true,
        echo: input?.message ?? null,
        ts: new Date().toISOString(),
      },
    };
  },
};
