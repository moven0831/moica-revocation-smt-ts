import * as fs from "node:fs";
import * as crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { SMT, type HashFunction } from "@zk-kit/smt";

interface SnapshotData {
  serialsHash: string;
  root: string;
  count: number;
  nodes: [string, string[]][];
}

/**
 * Compute SHA-256 hex digest of a file's contents.
 */
export function computeFileHash(filePath: string): string {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Serialize an SMT to a gzipped JSON snapshot file.
 */
export function saveSnapshot(
  snapshotPath: string,
  tree: SMT,
  root: bigint,
  count: number,
  serialsHash: string,
): void {
  const nodesMap = (tree as any).nodes as Map<bigint, bigint[]>;
  const nodes: [string, string[]][] = [];

  for (const [key, value] of nodesMap) {
    nodes.push([
      "0x" + BigInt(key).toString(16),
      value.map((v: bigint) => "0x" + BigInt(v).toString(16)),
    ]);
  }

  const data: SnapshotData = {
    serialsHash,
    root: "0x" + root.toString(16),
    count,
    nodes,
  };

  const json = JSON.stringify(data);
  const compressed = gzipSync(Buffer.from(json));
  fs.writeFileSync(snapshotPath, compressed);
}

/**
 * Load an SMT from a gzipped JSON snapshot file.
 * Returns null if the file doesn't exist, is corrupt, or the hash doesn't match.
 */
export function loadSnapshot(
  snapshotPath: string,
  expectedHash: string,
  hashFn: HashFunction,
): { tree: SMT; root: bigint; count: number } | null {
  if (!fs.existsSync(snapshotPath)) return null;

  try {
    const compressed = fs.readFileSync(snapshotPath);
    const json = gunzipSync(compressed).toString("utf-8");
    const data: SnapshotData = JSON.parse(json);

    if (data.serialsHash !== expectedHash) {
      console.log("Snapshot hash mismatch, will rebuild.");
      return null;
    }

    const tree = new SMT(hashFn, true);
    const nodesMap = (tree as any).nodes as Map<bigint, bigint[]>;

    for (const [key, value] of data.nodes) {
      nodesMap.set(BigInt(key), value.map((v: string) => BigInt(v)));
    }

    const root = BigInt(data.root);
    (tree as any).root = root;

    return { tree, root, count: data.count };
  } catch (err) {
    console.error("Failed to load snapshot:", err);
    return null;
  }
}

const GITHUB_REPO = "moven0831/moica-revocation-smt";

/**
 * Download a snapshot from the GitHub release "snapshot-latest".
 * Returns true on success.
 */
export async function downloadSnapshot(
  generation: string,
  destPath: string,
): Promise<boolean> {
  const url = `https://github.com/${GITHUB_REPO}/releases/download/snapshot-latest/${generation}-tree-snapshot.json.gz`;

  try {
    console.log(`Downloading snapshot from ${url}...`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) {
      console.log(`Snapshot download failed: ${response.status}`);
      return false;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(destPath, buffer);
    console.log(`Snapshot downloaded (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
    return true;
  } catch (err) {
    console.log(`Snapshot download error: ${err}`);
    return false;
  }
}
