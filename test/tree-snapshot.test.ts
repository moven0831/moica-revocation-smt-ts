import { expect } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { poseidonHash } from "../src/utils/poseidon.js";
import { buildSmtFromSerials } from "../src/build-smt.js";
import { saveSnapshot, loadSnapshot } from "../src/utils/tree-snapshot.js";

describe("Tree Snapshot", function () {
  this.timeout(30000);

  const testSerials = [
    "100048210DD2DF2E128096A9282B5EC5",
    "200048210DD2DF2E128096A9282B5EC5",
    "300048210DD2DF2E128096A9282B5EC5",
  ];

  let tmpDir: string;
  let serialsPath: string;
  let snapshotPath: string;
  let serialsHash: string;

  beforeEach(function () {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "smt-test-"));
    serialsPath = path.join(tmpDir, "revoked-serials.json");
    snapshotPath = path.join(tmpDir, "tree-snapshot.json.gz");
    fs.writeFileSync(serialsPath, JSON.stringify(testSerials));
    serialsHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(serialsPath))
      .digest("hex");
  });

  afterEach(function () {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("saveSnapshot -> loadSnapshot produces same root and count", function () {
    const { tree, root, count } = buildSmtFromSerials(testSerials);
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);

    const loaded = loadSnapshot(snapshotPath, serialsHash, poseidonHash);
    expect(loaded).to.not.be.null;
    expect(loaded!.root).to.equal(root);
    expect(loaded!.count).to.equal(count);
  });

  it("loadSnapshot returns null when hash doesn't match", function () {
    const { tree, root, count } = buildSmtFromSerials(testSerials);
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);

    const loaded = loadSnapshot(snapshotPath, "wrong-hash", poseidonHash);
    expect(loaded).to.be.null;
  });

  it("loadSnapshot returns null for corrupted gzip data", function () {
    fs.writeFileSync(snapshotPath, Buffer.from("not valid gzip data"));
    const loaded = loadSnapshot(snapshotPath, serialsHash, poseidonHash);
    expect(loaded).to.be.null;
  });

  it("loadSnapshot returns null for non-existent file", function () {
    const loaded = loadSnapshot(
      path.join(tmpDir, "nonexistent.json.gz"),
      serialsHash,
      poseidonHash,
    );
    expect(loaded).to.be.null;
  });

  it("loaded tree can generate valid membership proof", function () {
    const { tree, root, count } = buildSmtFromSerials(testSerials);
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);

    const loaded = loadSnapshot(snapshotPath, serialsHash, poseidonHash);
    expect(loaded).to.not.be.null;

    // Verify that the loaded tree can generate a valid membership proof
    const key = BigInt("0x" + testSerials[0]);
    const proof = loaded!.tree.createProof(key);
    expect(proof.membership).to.be.true;
    expect(loaded!.tree.verifyProof(proof)).to.be.true;
  });

  it("loaded tree can generate valid non-membership proof", function () {
    const { tree, root, count } = buildSmtFromSerials(testSerials);
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);

    const loaded = loadSnapshot(snapshotPath, serialsHash, poseidonHash);
    expect(loaded).to.not.be.null;

    const key = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF");
    const proof = loaded!.tree.createProof(key);
    expect(proof.membership).to.be.false;
    expect(loaded!.tree.verifyProof(proof)).to.be.true;
  });

  it("loadSnapshot returns null for tampered snapshot", function () {
    const { tree, root, count } = buildSmtFromSerials(testSerials);
    saveSnapshot(snapshotPath, tree, root, count, serialsHash);

    // Tamper with the snapshot by modifying the serialsHash inside
    const compressed = fs.readFileSync(snapshotPath);
    const json = gunzipSync(compressed).toString("utf-8");
    const data = JSON.parse(json);
    // Change the serialsHash so it no longer matches expectedHash
    data.serialsHash = "tampered-hash";
    const tampered = gzipSync(Buffer.from(JSON.stringify(data)));
    fs.writeFileSync(snapshotPath, tampered);

    const loaded = loadSnapshot(snapshotPath, serialsHash, poseidonHash);
    expect(loaded).to.be.null;
  });
});
