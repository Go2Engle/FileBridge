// @vitest-environment node
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { SmbProvider } from "@/lib/storage/smb";

function fakeClient() {
  return {
    close: vi.fn(),
    disconnect: vi.fn(),
    socket: { destroy: vi.fn() },
  };
}

function makeProvider() {
  return new SmbProvider("smb.test", 445, { username: "u", password: "p", share: "s" });
}

describe("SmbProvider.disconnect()", () => {
  it("tears down the connection instead of sending a file CLOSE", async () => {
    const provider = makeProvider();
    const client = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = client;

    await provider.disconnect();

    // client.close(file, cb) closes a FILE handle. Calling it with no args was
    // the source of the 60s-later "a is not a function" uncaughtException.
    expect(client.close).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledTimes(1);
    expect(client.socket.destroy).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((provider as any).client).toBeNull();
  });

  it("still destroys the socket when disconnect() throws", async () => {
    const provider = makeProvider();
    const client = fakeClient();
    client.disconnect.mockImplementation(() => {
      throw new Error("not initialised");
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (provider as any).client = client;

    await expect(provider.disconnect()).resolves.toBeUndefined();
    expect(client.socket.destroy).toHaveBeenCalledTimes(1);
  });

  it("closes a real v9u-smb2 client without leaving timers behind", async () => {
    vi.useFakeTimers();
    try {
      const provider = makeProvider();
      await provider.connect(); // creates the client; TCP is deferred
      await provider.disconnect();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SmbProvider reconnect", () => {
  it("does not tear down a client that a concurrent operation already replaced", async () => {
    const provider = makeProvider();
    const stale = fakeClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = provider as any;
    p.client = stale;
    const fresh: ReturnType<typeof fakeClient>[] = [];
    vi.spyOn(provider, "connect").mockImplementation(async () => {
      const c = fakeClient();
      fresh.push(c);
      p.client = c;
    });

    // Two operations failed on the same stale client and both ask to reconnect.
    await Promise.all([p.reconnect(stale), p.reconnect(stale)]);

    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(stale.disconnect).toHaveBeenCalledTimes(1);
    expect(fresh[0].disconnect).not.toHaveBeenCalled();
    expect(p.client).toBe(fresh[0]);
  });
});
