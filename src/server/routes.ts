import { Hono } from "hono";
import {
  VALID_ISSUER_IDS,
  getProof,
  getTreeState,
  isLoading,
  getAllStates,
} from "./tree-store.js";

const startedAt = Date.now();

export const app = new Hono();

const HEX_RE = /^[0-9a-fA-F]+$/;

/**
 * Convert all BigInt values in a proof object to "0x" + hex strings.
 */
function serializeProof(proof: any): any {
  if (typeof proof === "bigint") {
    return "0x" + proof.toString(16);
  }
  if (Array.isArray(proof)) {
    return proof.map(serializeProof);
  }
  if (proof !== null && typeof proof === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(proof)) {
      result[key] = serializeProof(value);
    }
    return result;
  }
  return proof;
}

app.get("/proof/:issuerId/:sn", (c) => {
  const { issuerId, sn } = c.req.param();

  if (!VALID_ISSUER_IDS.includes(issuerId)) {
    return c.json({ error: "Invalid issuerId" }, 400);
  }

  if (!HEX_RE.test(sn) || sn.length > 64) {
    return c.json({ error: "Invalid serial number" }, 400);
  }

  if (isLoading(issuerId)) {
    return c.json({ error: "Tree not yet loaded" }, 503);
  }

  const state = getTreeState(issuerId);
  if (!state) {
    return c.json({ error: "No data available" }, 404);
  }

  try {
    const proof = getProof(issuerId, sn);
    if (!proof) {
      return c.json({ error: "No data available" }, 404);
    }

    const serialized = serializeProof(proof);
    return c.json({
      issuerId,
      serialNumber: sn,
      ...serialized,
    });
  } catch (err) {
    console.error(`Error generating proof for ${issuerId}/${sn}:`, err);
    return c.json({ error: "Internal server error" }, 500);
  }
});

app.get("/status", (c) => {
  const uptimeMs = Date.now() - startedAt;
  return c.json({
    generations: getAllStates(),
    uptimeSeconds: Math.floor(uptimeMs / 1000),
  });
});
