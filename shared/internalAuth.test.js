"use strict";

const { signInternalToken, verifyInternalToken } = require("./internalAuth");

const makeKeys = async () => {
  const { generateKeyPair, exportPKCS8, exportSPKI } = await import("jose");
  const { privateKey, publicKey } = await generateKeyPair("EdDSA");
  const privatePem = await exportPKCS8(privateKey);
  const publicPem = await exportSPKI(publicKey);
  return { privatePem, publicPem };
};

describe("internalAuth", () => {
  it("token ok -> verify succeeds", async () => {
    const { privatePem, publicPem } = await makeKeys();
    const token = await signInternalToken(
      { sub: "scheduler" },
      {
        issuer: "astraai-internal",
        audience: "tickerscanner",
        scope: "fundamentals:update-user-daily-scores",
        ttlSeconds: 60,
        privateKey: privatePem,
      }
    );
    const payload = await verifyInternalToken(token, {
      issuer: "astraai-internal",
      audience: "tickerscanner",
      scope: "fundamentals:update-user-daily-scores",
      publicKey: publicPem,
    });
    expect(payload.sub).toBe("scheduler");
  });

  it("missing token -> verify fails", async () => {
    await expect(verifyInternalToken("", { publicKey: "x" })).rejects.toThrow();
  });

  it("incorrect scope -> verify fails", async () => {
    const { privatePem, publicPem } = await makeKeys();
    const token = await signInternalToken(
      { sub: "scheduler", scp: "wrong:scope" },
      {
        issuer: "astraai-internal",
        audience: "tickerscanner",
        ttlSeconds: 60,
        privateKey: privatePem,
      }
    );
    await expect(
      verifyInternalToken(token, {
        issuer: "astraai-internal",
        audience: "tickerscanner",
        scope: "fundamentals:update-user-daily-scores",
        publicKey: publicPem,
      })
    ).rejects.toThrow();
  });
});
