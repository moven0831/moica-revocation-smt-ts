import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as x509 from "@peculiar/x509";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CRL_URLS: Record<string, string> = {
  g2: "https://moica.nat.gov.tw/repository/MOICA/CRL2/complete.crl",
  // G3 CRL URL is currently returning 404. Update when the correct URL is known.
  // g3: "https://moica.nat.gov.tw/repository/MOICA/CRL3/complete.crl",
};

const DATA_DIR = path.resolve(__dirname, "../data");

export interface CrlResult {
  crlNumber: string;
  serials: string[];
  lastUpdate: Date;
  nextUpdate: Date | undefined;
}

async function downloadCrl(url: string): Promise<ArrayBuffer> {
  console.log(`Downloading CRL from ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to download CRL: ${response.status} ${response.statusText}`
    );
  }
  return response.arrayBuffer();
}

/**
 * Parse a DER-encoded CRL and extract revoked serial numbers + metadata.
 */
export function parseCrl(derBuffer: ArrayBuffer): CrlResult {
  const crl = new x509.X509Crl(derBuffer);

  // Extract CRL number from extension OID 2.5.29.20
  let crlNumber = "unknown";
  for (const ext of crl.extensions) {
    if (ext.type === "2.5.29.20") {
      // Extension value is DER-encoded INTEGER (tag 0x02, length, value bytes)
      const bytes = new Uint8Array(ext.value);
      if (bytes[0] === 0x02) {
        let offset = 1;
        let len = bytes[offset++];
        if (len & 0x80) {
          const numLenBytes = len & 0x7f;
          len = 0;
          for (let i = 0; i < numLenBytes; i++) {
            len = (len << 8) | bytes[offset++];
          }
        }
        const intBytes = bytes.slice(offset, offset + len);
        // Skip leading zero byte (sign padding)
        const start = intBytes[0] === 0 ? 1 : 0;
        let bigVal = 0n;
        for (const b of intBytes.slice(start)) {
          bigVal = (bigVal << 8n) | BigInt(b);
        }
        crlNumber = bigVal.toString(10);
      }
      break;
    }
  }

  // Extract revoked certificate serial numbers
  const serials: string[] = [];
  if (crl.entries) {
    for (const entry of crl.entries) {
      serials.push(entry.serialNumber);
    }
  }

  serials.sort();

  return {
    crlNumber,
    serials,
    lastUpdate: crl.thisUpdate,
    nextUpdate: crl.nextUpdate,
  };
}

function hasChanged(generation: string, newCrlNumber: string): boolean {
  const rootPath = path.join(DATA_DIR, generation, "root.json");
  if (!fs.existsSync(rootPath)) return true;
  const stored = JSON.parse(fs.readFileSync(rootPath, "utf-8"));
  return stored.crlNumber !== newCrlNumber;
}

function saveSerials(generation: string, result: CrlResult): void {
  const genDir = path.join(DATA_DIR, generation);
  fs.mkdirSync(genDir, { recursive: true });
  fs.writeFileSync(
    path.join(genDir, "revoked-serials.json"),
    JSON.stringify(result.serials, null, 2)
  );
  console.log(`Saved ${result.serials.length} serials for ${generation}`);
}

async function main() {
  let anyChanged = false;

  for (const [gen, url] of Object.entries(CRL_URLS)) {
    try {
      const derBuffer = await downloadCrl(url);
      const result = parseCrl(derBuffer);

      console.log(
        `${gen.toUpperCase()}: CRL #${result.crlNumber}, ${result.serials.length} revoked certs`
      );

      if (!hasChanged(gen, result.crlNumber)) {
        console.log(`${gen.toUpperCase()}: No change, skipping.`);
        continue;
      }

      saveSerials(gen, result);
      anyChanged = true;

      // Write partial root.json (SMT root filled in by build-smt.ts)
      const rootPath = path.join(DATA_DIR, gen, "root.json");
      const existing = fs.existsSync(rootPath)
        ? JSON.parse(fs.readFileSync(rootPath, "utf-8"))
        : {};
      fs.writeFileSync(
        rootPath,
        JSON.stringify(
          {
            ...existing,
            crlNumber: result.crlNumber,
            timestamp: new Date().toISOString(),
            count: result.serials.length,
          },
          null,
          2
        )
      );
    } catch (err) {
      console.error(`Error processing ${gen}:`, err);
    }
  }

  // Write metadata
  const metadataPath = path.join(DATA_DIR, "metadata.json");
  const metadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, "utf-8"))
    : {};
  metadata.lastRun = new Date().toISOString();
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  // Output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${anyChanged}\n`);
  }

  console.log(`\nDone. Changed: ${anyChanged}`);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("fetch-crl.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
