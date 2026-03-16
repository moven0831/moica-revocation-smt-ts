import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "../data");

const ISSUER_IDS: Record<string, string> = {
  g2: ethers.id("MOICA-G2"),
  g3: ethers.id("MOICA-G3"),
};

const SMT_ROOT_STORAGE_ABI = [
  "function setRoot(bytes32 issuerId, uint256 newRoot, uint256 crlNumber) external",
  "function getRoot(bytes32 issuerId) external view returns (uint256)",
  "function roots(bytes32 issuerId) external view returns (uint256 root, uint256 crlNumber, uint256 updatedAt)",
];

async function main() {
  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  const contractAddress = process.env.CONTRACT_ADDRESS;

  if (!rpcUrl || !privateKey || !contractAddress) {
    console.error(
      "Missing env vars: RPC_URL, RELAYER_PRIVATE_KEY, CONTRACT_ADDRESS"
    );
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(
    contractAddress,
    SMT_ROOT_STORAGE_ABI,
    wallet
  );

  for (const [gen, issuerId] of Object.entries(ISSUER_IDS)) {
    const rootPath = path.join(DATA_DIR, gen, "root.json");
    if (!fs.existsSync(rootPath)) {
      console.log(`${gen.toUpperCase()}: No root.json found, skipping.`);
      continue;
    }

    const data = JSON.parse(fs.readFileSync(rootPath, "utf-8"));
    if (!data.root || !data.crlNumber) {
      console.log(
        `${gen.toUpperCase()}: Missing root or crlNumber, skipping.`
      );
      continue;
    }

    const newRoot = BigInt(data.root);
    const crlNumber = BigInt(data.crlNumber);

    // Check on-chain state
    const [, onChainCrlNumber] = await contract.roots(issuerId);
    if (onChainCrlNumber >= crlNumber) {
      console.log(
        `${gen.toUpperCase()}: On-chain CRL ${onChainCrlNumber} >= ${crlNumber}, skipping.`
      );
      continue;
    }

    console.log(
      `${gen.toUpperCase()}: Posting root 0x${newRoot.toString(16).slice(0, 16)}... (CRL #${crlNumber})`
    );
    const tx = await contract.setRoot(issuerId, newRoot, crlNumber);
    console.log(`${gen.toUpperCase()}: TX ${tx.hash}`);
    await tx.wait();
    console.log(`${gen.toUpperCase()}: Confirmed.`);
  }

  console.log("Done.");
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("post-root.ts");
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
