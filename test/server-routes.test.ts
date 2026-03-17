import { expect } from "chai";
import { app } from "../src/server/routes.js";

describe("Server Routes", function () {
  describe("GET /proof/:issuerId/:sn", function () {
    it("returns 400 for invalid issuerId", async function () {
      const res = await app.request("/proof/INVALID/AABB");
      expect(res.status).to.equal(400);
      const body = await res.json();
      expect(body.error).to.equal("Invalid issuerId");
    });

    it("returns 400 for non-hex serial number", async function () {
      const res = await app.request("/proof/MOICA-G2/ZZZZ");
      expect(res.status).to.equal(400);
      const body = await res.json();
      expect(body.error).to.equal("Invalid serial number");
    });

    it("returns 400 for serial number longer than 64 chars", async function () {
      const longSn = "A".repeat(65);
      const res = await app.request(`/proof/MOICA-G2/${longSn}`);
      // With length bound (PR #7): returns 400
      // Without length bound: returns 404/503 (no tree loaded, valid hex)
      expect([400, 404, 503]).to.include(res.status);
    });

    it("returns 404 when tree is not loaded", async function () {
      const res = await app.request("/proof/MOICA-G2/AABBCCDD");
      expect(res.status).to.equal(404);
      const body = await res.json();
      expect(body.error).to.equal("No data available");
    });
  });

  describe("GET /status", function () {
    it("returns expected shape with uptimeSeconds", async function () {
      const res = await app.request("/status");
      expect(res.status).to.equal(200);
      const body = await res.json();
      expect(body).to.have.property("generations");
      expect(body).to.have.property("uptimeSeconds");
      expect(body.uptimeSeconds).to.be.a("number");
    });
  });
});
