import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SMT } from "@zk-kit/smt";
import { poseidonHash } from "../utils/poseidon.js";
import {
  computeFileHash,
  saveSnapshot,
  loadSnapshot,
  downloadSnapshot,
} from "../utils/tree-snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../../data");

const ISSUER_TO_DIR: Record<string, string> = {
  "MOICA-G2": "g2",
  "MOICA-G3": "g3",
};

export const VALID_ISSUER_IDS = Object.keys(ISSUER_TO_DIR);

interface TreeState {
  tree: SMT;
  root: bigint;
  count: number;
  crlNumber: string | null;
  loadedAt: string;
}

const trees = new Map<string, TreeState>();
let loading = new Set<string>();

function dataDir(issuerId: string): string {
  return path.join(DATA_DIR, ISSUER_TO_DIR[issuerId]);
}

function serialsPath(issuerId: string): string {
  return path.join(dataDir(issuerId), "revoked-serials.json");
}

function rootPath(issuerId: string): string {
  return path.join(dataDir(issuerId), "root.json");
}

function snapshotPath(issuerId: string): string {
  return path.join(dataDir(issuerId), "tree-snapshot.json.gz");
}

function generationId(issuerId: string): string {
  return ISSUER_TO_DIR[issuerId];
}

/**
 * Build SMT with async yields every 10K inserts to keep event loop responsive.
 */
async function buildSmtAsync(serials: string[]): Promise<{ tree: SMT; root: bigint }> {
  const tree = new SMT(poseidonHash, true);
  const BATCH = 10_000;

  for (let i = 0; i < serials.length; i++) {
    const key = BigInt("0x" + serials[i]);
    tree.add(key, 1n);

    if ((i + 1) % BATCH === 0) {
      console.log(`  Inserted ${i + 1}/${serials.length}...`);
      await new Promise<void>((r) => setImmediate(r));
    }
  }

  return { tree, root: tree.root as bigint };
}

export async function loadGeneration(issuerId: string): Promise<void> {
  const sp = serialsPath(issuerId);
  if (!fs.existsSync(sp)) {
    console.log(`${issuerId}: No serials file found, skipping.`);
    return;
  }

  loading.add(issuerId);
  const startTime = Date.now();

  const serialsHash = computeFileHash(sp);
  let tree: SMT;
  let root: bigint;
  let count: number;
  let source: string;

  // Try local snapshot
  const snap = snapshotPath(issuerId);
  const loaded = loadSnapshot(snap, serialsHash, poseidonHash);

  if (loaded) {
    tree = loaded.tree;
    root = loaded.root;
    count = loaded.count;
    source = "local snapshot";
  } else {
    // Try downloading from GitHub release
    const downloaded = await downloadSnapshot(generationId(issuerId), snap);
    const fromRemote = downloaded
      ? loadSnapshot(snap, serialsHash, poseidonHash)
      : null;

    if (fromRemote) {
      tree = fromRemote.tree;
      root = fromRemote.root;
      count = fromRemote.count;
      source = "downloaded snapshot";
    } else {
      // Fallback: build from scratch
      const serials: string[] = JSON.parse(fs.readFileSync(sp, "utf-8"));
      console.log(`${issuerId}: Building SMT from ${serials.length} serials...`);

      const result = await buildSmtAsync(serials);
      tree = result.tree;
      root = result.root;
      count = serials.length;
      source = "built from scratch";

      // Save snapshot for next time
      saveSnapshot(snap, tree, root, count, serialsHash);
      const snapshotSize = (fs.statSync(snap).size / 1024 / 1024).toFixed(1);
      console.log(`${issuerId}: Snapshot saved (${snapshotSize}MB)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  let crlNumber: string | null = null;
  const rp = rootPath(issuerId);
  if (fs.existsSync(rp)) {
    try {
      const rootData = JSON.parse(fs.readFileSync(rp, "utf-8"));
      crlNumber = rootData.crlNumber ?? null;
    } catch {
      // ignore
    }
  }

  trees.set(issuerId, {
    tree,
    root,
    count,
    crlNumber,
    loadedAt: new Date().toISOString(),
  });
  loading.delete(issuerId);

  console.log(`${issuerId}: Ready — ${count} entries, root=0x${root.toString(16).slice(0, 16)}…, ${elapsed}s (${source})`);
}

export function getTreeState(issuerId: string): TreeState | undefined {
  return trees.get(issuerId);
}

export function isLoading(issuerId: string): boolean {
  return loading.has(issuerId);
}

export function getProof(issuerId: string, serialHex: string) {
  const state = trees.get(issuerId);
  if (!state) return undefined;
  const key = BigInt("0x" + serialHex);
  return state.tree.createProof(key);
}

export function getAllStates(): Record<string, { loaded: boolean; count: number; root: string; crlNumber: string | null; loadedAt: string } | { loaded: false }> {
  const result: Record<string, any> = {};
  for (const issuerId of VALID_ISSUER_IDS) {
    const state = trees.get(issuerId);
    if (state) {
      result[issuerId] = {
        loaded: true,
        count: state.count,
        root: "0x" + state.root.toString(16),
        crlNumber: state.crlNumber,
        loadedAt: state.loadedAt,
      };
    } else {
      result[issuerId] = { loaded: false };
    }
  }
  return result;
}

export function startWatcher(): void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  for (const issuerId of VALID_ISSUER_IDS) {
    const sp = serialsPath(issuerId);
    const dir = path.dirname(sp);
    if (!fs.existsSync(dir)) continue;

    fs.watch(dir, (eventType, filename) => {
      if (filename !== "revoked-serials.json") return;

      // Debounce 500ms
      const existing = debounceTimers.get(issuerId);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        issuerId,
        setTimeout(async () => {
          debounceTimers.delete(issuerId);
          console.log(`${issuerId}: File change detected, rebuilding...`);
          try {
            // Delete stale snapshot so loadGeneration rebuilds from scratch
            const snap = snapshotPath(issuerId);
            if (fs.existsSync(snap)) fs.unlinkSync(snap);
            await loadGeneration(issuerId);
          } catch (err) {
            console.error(`${issuerId}: Rebuild failed:`, err);
          }
        }, 500)
      );
    });

    console.log(`${issuerId}: Watching ${dir} for changes`);
  }
}

export async function initAll(): Promise<void> {
  const promises = VALID_ISSUER_IDS.map((id) => loadGeneration(id));
  await Promise.all(promises);
  startWatcher();
}
