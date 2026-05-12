import { describe, expect, it } from "vitest";
import { RpcPool } from "../src/index.js";

describe("RpcPool", () => {
  it("sorts endpoints by priority", () => {
    const pool = new RpcPool([
      { id: "b", name: "Backup", url: "https://backup.example", chainName: "base", priority: 2 },
      { id: "a", name: "Primary", url: "https://primary.example", chainName: "base", priority: 1 }
    ]);

    expect(pool.endpointsFor("base").map((endpoint) => endpoint.id)).toEqual(["a", "b"]);
  });
});
