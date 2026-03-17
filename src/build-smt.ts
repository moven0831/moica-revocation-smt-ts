import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { SMT } from "@zk-kit/smt";
import { poseidonHash } from "./utils/poseidon.js";
import { computeFileHash, saveSnapshot } from "./utils/tree-snapshot.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");
const GENERATIONS = ["g2", "g3"];

export interface SmtResult {
  root: bigint;
  tree: SMT;
  count: number;
}

/**
 * Build an SMT from an array of hex serial number strings.
 * Each serial is inserted as key=BigInt("0x"+serial), value=1n.
 */
export function buildSmtFromSerials(serials: string[]): SmtResult {
  const tree = new SMT(poseidonHash, true);

  for (let i = 0; i < serials.length; i++) {
    const key = BigInt("0x" + serials[i]);
    tree.add(key, 1n);

    if ((i + 1) % 50000 === 0) {
      console.log(`  Inserted ${i + 1}/${serials.length}...`);
    }
  }

  return {
    root: tree.root as bigint,
    tree,
    count: serials.length,
  };
}

/**
 * Generate a non-membership proof for a given serial number.
 */
export function generateProof(tree: SMT, serialHex: string) {
  const key = BigInt("0x" + serialHex);
  return tree.createProof(key);
}

async function main() {
  for (const gen of GENERATIONS) {
    const serialsPath = path.join(DATA_DIR, gen, "revoked-serials.json");
    if (!fs.existsSync(serialsPath)) {
      console.log(`${gen.toUpperCase()}: No serials file found, skipping.`);
      continue;
    }

    console.log(`${gen.toUpperCase()}: Loading serials...`);
    const serials: string[] = JSON.parse(
      fs.readFileSync(serialsPath, "utf-8")
    );
    console.log(
      `${gen.toUpperCase()}: Building SMT from ${serials.length} serials...`
    );

    const startTime = Date.now();
    const { root, tree, count } = buildSmtFromSerials(serials);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`${gen.toUpperCase()}: Root = 0x${root.toString(16)}`);
    console.log(`${gen.toUpperCase()}: ${count} entries in ${elapsed}s`);

    // Save snapshot
    const serialsHash = computeFileHash(serialsPath);
    const snapshotPath = path.join(DATA_DIR, gen, "tree-snapshot.json.gz");
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);
    const snapshotSize = (fs.statSync(snapshotPath).size / 1024 / 1024).toFixed(1);
    console.log(`${gen.toUpperCase()}: Snapshot saved (${snapshotSize}MB)`);

    // Update root.json
    const rootPath = path.join(DATA_DIR, gen, "root.json");
    const existing = fs.existsSync(rootPath)
      ? JSON.parse(fs.readFileSync(rootPath, "utf-8"))
      : {};
    fs.writeFileSync(
      rootPath,
      JSON.stringify(
        {
          ...existing,
          root: "0x" + root.toString(16),
          count,
        },
        null,
        2
      )
    );
  }

  // Update metadata
  const metadataPath = path.join(DATA_DIR, "metadata.json");
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
    : {};
  metadata.lastSmtBuild = new Date().toISOString();
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  console.log("\nDone.");
}

// Only run main() when executed directly (not imported)
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("build-smt.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
