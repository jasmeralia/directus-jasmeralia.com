import { vi } from "vitest";

export type DirectusMockRoute = {
  match: string | RegExp;
  data: unknown;
};

const matchesRoute = (url: string, match: string | RegExp): boolean => {
  if (typeof match === "string") return url.includes(match);
  match.lastIndex = 0;
  return match.test(url);
};

export const mockDirectusFetch = (routes: DirectusMockRoute[]) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    void init;
    const url = input instanceof Request ? input.url : String(input);
    const route = routes.find(({ match }) => matchesRoute(url, match));
    if (!route) throw new Error(`No Directus mock route matched: ${url}`);
    return Response.json({ data: route.data });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};
