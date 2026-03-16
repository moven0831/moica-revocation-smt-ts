import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseCrl } from "../src/fetch-crl.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("CRL Parser", function () {
  this.timeout(60000);

  it("should parse a real G2 CRL from network", async function () {
    const url = "https://moica.nat.gov.tw/repository/MOICA/CRL2/complete.crl";
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      this.skip();
      return;
    }
    if (!response.ok) {
      this.skip();
      return;
    }
    const derBuffer = await response.arrayBuffer();
    const result = parseCrl(derBuffer);

    expect(result.serials).to.be.an("array");
    expect(result.serials.length).to.be.greaterThan(100000);
    expect(result.crlNumber).to.not.equal("unknown");
    expect(result.lastUpdate).to.be.instanceOf(Date);

    // Serial numbers should be hex strings
    for (const serial of result.serials.slice(0, 10)) {
      expect(serial).to.match(/^[0-9a-f]+$/i);
    }

    console.log(
      `G2 CRL: ${result.serials.length} serials, CRL #${result.crlNumber}`
    );
  });

  it("should parse G3 CRL from local fixture", function () {
    const fixturePath = path.join(
      __dirname,
      "fixtures",
      "MOICA-G3-complete.crl"
    );
    const derBuffer = fs.readFileSync(fixturePath);
    const result = parseCrl(derBuffer.buffer);

    expect(result.serials).to.be.an("array");
    expect(result.serials.length).to.be.greaterThan(50000);
    expect(result.crlNumber).to.not.equal("unknown");
    expect(result.lastUpdate).to.be.instanceOf(Date);
    expect(result.nextUpdate).to.be.instanceOf(Date);

    // Serial numbers should be valid hex strings
    for (const serial of result.serials.slice(0, 10)) {
      expect(serial).to.match(/^[0-9a-f]+$/i);
    }

    console.log(
      `G3 CRL: ${result.serials.length} serials, CRL #${result.crlNumber}`
    );
  });
});
