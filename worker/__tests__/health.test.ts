import { describe, expect, it } from "vitest";
import app from "../index";

describe("GET /api/health", () => {
  it("API が応答する", async () => {
    const res = await app.request("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});
