import { afterEach, beforeEach, vi } from "vitest";

process.env.TZ = "UTC";

const installUnexpectedFetchStub = () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    throw new Error(`Unexpected network call in test: ${url}`);
  });
};

installUnexpectedFetchStub();

beforeEach(() => {
  installUnexpectedFetchStub();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
