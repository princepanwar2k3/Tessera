import { describe, expect, it } from "vitest";
import { buildHostConfig, DEFAULT_RESOURCE_CAPS } from "../../src/docker/container-config.js";

describe("buildHostConfig", () => {
  it("caps memory, cpu and pids — we are running strangers' images", () => {
    const cfg = buildHostConfig(DEFAULT_RESOURCE_CAPS, "/data/artifacts/j1");

    expect(cfg.Memory).toBe(512 * 1024 * 1024);
    expect(cfg.NanoCpus).toBe(1_000_000_000);
    expect(cfg.PidsLimit).toBe(128);
    expect(cfg.ReadonlyRootfs).toBe(true);
  });

  it("hardens with no-new-privileges by default", () => {
    expect(buildHostConfig(DEFAULT_RESOURCE_CAPS, "/d").SecurityOpt).toEqual([
      "no-new-privileges",
    ]);
  });

  it("drops the flag only when an operator opts out explicitly", () => {
    const cfg = buildHostConfig(
      { ...DEFAULT_RESOURCE_CAPS, noNewPrivileges: false },
      "/d",
    );
    expect(cfg.SecurityOpt).toBeUndefined();
    // Every other control stays on: the escape hatch is narrow.
    expect(cfg.ReadonlyRootfs).toBe(true);
    expect(cfg.PidsLimit).toBe(128);
  });

  it("bind-mounts exactly one artifact directory", () => {
    expect(buildHostConfig(DEFAULT_RESOURCE_CAPS, "/data/artifacts/j1").Binds).toEqual([
      "/data/artifacts/j1:/artifacts:rw",
    ]);
  });
});
