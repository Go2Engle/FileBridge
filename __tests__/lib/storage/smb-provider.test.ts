// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Readable } from "stream";
import { createRequire } from "module";

vi.mock("@/lib/logger", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { SmbProvider } from "@/lib/storage/smb";

/* eslint-disable @typescript-eslint/no-explicit-any */
const nodeRequire = createRequire(import.meta.url);
const forge: any = nodeRequire("v9u-smb2/lib/tools/smb2-forge");
const originalRequest = forge.request;

type Handler = (params: any, cb: (err: any, res?: any) => void) => void;
let handlers: Record<string, Handler>;
let calls: { name: string; params: any }[];

function smbError(code: string) {
  return Object.assign(new Error(code), { code });
}

/** Fake v9u-smb2 client: only the methods SmbProvider uses. */
function fakeClient(overrides: Record<string, any> = {}) {
  return {
    readdir: vi.fn(),
    createReadStream: vi.fn(),
    writeFile: vi.fn((_p: string, _c: Buffer, _o: any, cb: any) => cb(null)),
    mkdir: vi.fn((_p: string, cb: any) => cb(null)),
    disconnect: vi.fn(),
    socket: { destroy: vi.fn() },
    ...overrides,
  };
}

function makeProvider(client = fakeClient()) {
  const provider = new SmbProvider("smb.test", 445, { username: "u", password: "p", share: "s" });
  const p = provider as any;
  p.client = client;
  // Reconnects install a fresh fake client instead of a real v9u-smb2 one.
  vi.spyOn(provider, "connect").mockImplementation(async () => {
    p.closed = false;
    p.client = fakeClient(client);
  });
  return { provider, p, client };
}

beforeEach(() => {
  calls = [];
  handlers = {
    open: (_params, cb) => cb(null, { FileId: "fid", EndofFile: Buffer.alloc(8) }),
    create: (_params, cb) => cb(null, { FileId: "fid" }),
    set_info: (_params, cb) => cb(null),
    write: (_params, cb) => cb(null),
    close: (_params, cb) => cb(null),
  };
  forge.request = vi.fn((name: string, params: any, _conn: any, cb: any) => {
    calls.push({ name, params });
    handlers[name](params, cb);
  });
});

afterEach(() => {
  forge.request = originalRequest;
  vi.useRealTimers();
});

describe("listing", () => {
  const entries = [
    { name: "a.csv", size: 1, mtime: "2026-01-01T00:00:00Z", isDirectory: () => false },
    { name: "b.txt", size: 2, mtime: "2026-01-02T00:00:00Z", isDirectory: () => false },
    { name: "sub", size: 0, mtime: "2026-01-03T00:00:00Z", isDirectory: () => true },
  ];

  it("listFiles converts the path, skips directories and applies the filter", async () => {
    const client = fakeClient({ readdir: vi.fn((_p, _o, cb) => cb(null, entries)) });
    const { provider } = makeProvider(client);

    const files = await provider.listFiles("/in/box", "*.csv");

    expect(client.readdir.mock.calls[0][0]).toBe("in\\box");
    expect(files).toEqual([
      { name: "a.csv", size: 1, modifiedAt: new Date("2026-01-01T00:00:00Z"), isDirectory: false },
    ]);
  });

  it("listDirectory returns files and folders at the share root", async () => {
    const client = fakeClient({ readdir: vi.fn((_p, _o, cb) => cb(null, entries)) });
    const { provider } = makeProvider(client);

    const listing = await provider.listDirectory("/");

    expect(client.readdir.mock.calls[0][0]).toBe("");
    expect(listing.map((e) => [e.name, e.isDirectory])).toEqual([
      ["a.csv", false],
      ["b.txt", false],
      ["sub", true],
    ]);
  });

  it("listing errors propagate", async () => {
    const err = smbError("STATUS_ACCESS_DENIED");
    const client = fakeClient({ readdir: vi.fn((_p, _o, cb) => cb(err)) });
    const { provider } = makeProvider(client);

    await expect(provider.listFiles("/x")).rejects.toBe(err);
    await expect(provider.listDirectory("/x")).rejects.toBe(err);
  });
});

describe("downloadFile()", () => {
  function streamingClient() {
    return fakeClient({
      createReadStream: vi.fn((_p, _o, cb) => cb(null, Readable.from([Buffer.from("data")]))),
    });
  }

  it("opens read-only and returns a stream", async () => {
    const { provider } = makeProvider(streamingClient());

    const stream = await provider.downloadFile("/dir/file.bin");

    expect(calls[0]).toMatchObject({ name: "open", params: { path: "dir\\file.bin" } });
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe("data");
  });

  it("reconnects and retries after a request timeout", async () => {
    const { provider, p } = makeProvider(streamingClient());
    const first = p.client;
    let attempts = 0;
    handlers.open = (_params, cb) =>
      ++attempts === 1 ? cb(smbError("SMB_REQUEST_TIMEOUT")) : cb(null, { FileId: "fid" });

    await expect(provider.downloadFile("/f")).resolves.toBeInstanceOf(Readable);
    expect(provider.connect).toHaveBeenCalledTimes(1);
    expect(first.disconnect).toHaveBeenCalledTimes(1);
  });

  it("closes the opened handle when the stream cannot be created", async () => {
    const err = smbError("STATUS_INVALID_PARAMETER");
    const client = fakeClient({ createReadStream: vi.fn((_p, _o, cb) => cb(err)) });
    const { provider } = makeProvider(client);

    await expect(provider.downloadFile("/f")).rejects.toBe(err);
    expect(calls.map((c) => c.name)).toEqual(["open", "close"]);
  });

  it("gives up after three stale-session failures", async () => {
    const { provider } = makeProvider(streamingClient());
    handlers.open = (_params, cb) => cb(smbError("SMB_CONNECTION_CLOSED"));

    await expect(provider.downloadFile("/f")).rejects.toMatchObject({ code: "SMB_CONNECTION_CLOSED" });
    expect(provider.connect).toHaveBeenCalledTimes(2);
  });

  it("suppresses the library's double-close error when the stream is destroyed", async () => {
    const stream = new Readable({ read() {} });
    stream._destroy = (_err, cb) => cb(smbError("STATUS_FILE_CLOSED"));
    const client = fakeClient({ createReadStream: vi.fn((_p, _o, cb) => cb(null, stream)) });
    const { provider } = makeProvider(client);

    const result = await provider.downloadFile("/f");
    const onError = vi.fn();
    result.on("error", onError);
    await new Promise<void>((resolve) => result.on("close", () => resolve()).destroy());

    expect(onError).not.toHaveBeenCalled();
  });
});

describe("uploadFile()", () => {
  it("buffers small files with a known size", async () => {
    const { provider, client } = makeProvider();

    await provider.uploadFile(Readable.from([Buffer.from("hello")]), "/out/a.txt", 5);

    expect(client.writeFile).toHaveBeenCalledWith("out\\a.txt", Buffer.from("hello"), { flags: "w" }, expect.any(Function));
  });

  it("rejects a buffered upload whose size does not match the hint", async () => {
    const { provider, client } = makeProvider();

    await expect(provider.uploadFile(Readable.from([Buffer.from("hi")]), "/a", 5)).rejects.toThrow(
      "SMB upload byte mismatch",
    );
    expect(client.writeFile).not.toHaveBeenCalled();
  });

  it("resolves the size of unknown-length streams before uploading", async () => {
    const { provider, client } = makeProvider();

    await provider.uploadFile(Readable.from(["ab", "cd"]), "/a");

    expect(client.writeFile.mock.calls[0][1]).toEqual(Buffer.from("abcd"));
  });

  it("propagates writeFile errors", async () => {
    const err = smbError("STATUS_DISK_FULL");
    const { provider } = makeProvider(fakeClient({ writeFile: vi.fn((_p, _c, _o, cb) => cb(err)) }));

    await expect(provider.uploadFile(Readable.from(["x"]), "/a", 1)).rejects.toBe(err);
  });

  it("streams large files: pre-allocates, writes, verifies size and always closes", async () => {
    const { provider } = makeProvider();
    const sizeHint = 300 * 1024 * 1024; // above the buffered limit

    await expect(
      provider.uploadFile(Readable.from([Buffer.from("abc"), Buffer.from("def")]), "/big.bin", sizeHint),
    ).rejects.toThrow(`expected ${sizeHint}, wrote 6`);

    expect(calls.map((c) => c.name)).toEqual(["create", "set_info", "write", "close"]);
    expect(calls[1].params.FileInfoClass).toBe("FileEndOfFileInformation");
    expect(calls[2].params.Buffer).toEqual(Buffer.from("abcdef"));
  });
});

describe("deleteFile()", () => {
  it("opens, marks for deletion and closes the handle", async () => {
    const { provider } = makeProvider();

    await provider.deleteFile("/dir/old.txt");

    expect(calls.map((c) => c.name)).toEqual(["create", "set_info", "close"]);
    expect(calls[0].params.path).toBe("dir\\old.txt");
    expect(calls[1].params.FileInfoClass).toBe("FileDispositionInformation");
  });

  it("closes the handle and rejects when marking fails", async () => {
    const { provider } = makeProvider();
    handlers.set_info = (_params, cb) => cb(smbError("STATUS_CANNOT_DELETE"));

    await expect(provider.deleteFile("/a")).rejects.toMatchObject({ code: "STATUS_CANNOT_DELETE" });
    expect(calls.map((c) => c.name)).toEqual(["create", "set_info", "close"]);
  });

  it("reconnects on STATUS_FILE_CLOSED and retries", async () => {
    const { provider } = makeProvider();
    let attempts = 0;
    handlers.create = (_params, cb) =>
      ++attempts === 1 ? cb(smbError("STATUS_FILE_CLOSED")) : cb(null, { FileId: "fid" });

    await provider.deleteFile("/a");
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("waits and retries on sharing violations and STATUS_PENDING", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider();
    const codes = ["STATUS_SHARING_VIOLATION", "STATUS_PENDING"];
    handlers.create = (_params, cb) => {
      const code = codes.shift();
      if (code) cb(smbError(code));
      else cb(null, { FileId: "fid" });
    };

    const done = provider.deleteFile("/a");
    await vi.runAllTimersAsync();
    await expect(done).resolves.toBeUndefined();
    expect(provider.connect).not.toHaveBeenCalled();
  });

  it("does not retry other errors", async () => {
    const { provider } = makeProvider();
    handlers.create = (_params, cb) => cb(smbError("STATUS_OBJECT_NAME_NOT_FOUND"));

    await expect(provider.deleteFile("/a")).rejects.toMatchObject({ code: "STATUS_OBJECT_NAME_NOT_FOUND" });
    expect(calls).toHaveLength(1);
  });

  it("stops retrying once the provider is disconnected", async () => {
    const { provider } = makeProvider();
    handlers.create = (_params, cb) => {
      void provider.disconnect();
      cb(smbError("SMB_REQUEST_TIMEOUT"));
    };

    await expect(provider.deleteFile("/a")).rejects.toMatchObject({ code: "SMB_CLIENT_CLOSED" });
    expect(provider.connect).not.toHaveBeenCalled();
  });
});

describe("moveFile()", () => {
  it("opens with DELETE access, renames and closes", async () => {
    const { provider } = makeProvider();

    await provider.moveFile("/in/a.txt", "/done/a.txt");

    expect(calls.map((c) => c.name)).toEqual(["open", "set_info", "close"]);
    expect(calls[1].params.FileInfoClass).toBe("FileRenameInformation");
    expect(calls[1].params.Buffer.includes(Buffer.from("done\\a.txt", "utf16le"))).toBe(true);
  });

  it("reconnects after a timeout and waits out sharing violations", async () => {
    vi.useFakeTimers();
    const { provider } = makeProvider();
    const codes = ["SMB_REQUEST_TIMEOUT", "STATUS_SHARING_VIOLATION", "STATUS_PENDING"];
    handlers.open = (_params, cb) => {
      const code = codes.shift();
      if (code) cb(smbError(code));
      else cb(null, { FileId: "fid" });
    };

    const done = provider.moveFile("/a", "/b");
    await vi.runAllTimersAsync();
    await expect(done).resolves.toBeUndefined();
    expect(provider.connect).toHaveBeenCalledTimes(1);
  });

  it("closes the handle and rejects when the rename fails", async () => {
    const { provider } = makeProvider();
    handlers.set_info = (_params, cb) => cb(smbError("STATUS_OBJECT_NAME_COLLISION"));

    await expect(provider.moveFile("/a", "/b")).rejects.toMatchObject({ code: "STATUS_OBJECT_NAME_COLLISION" });
    expect(calls.at(-1)?.name).toBe("close");
  });
});

describe("createDirectory()", () => {
  it("creates the folder at the converted path", async () => {
    const { provider, client } = makeProvider();

    await provider.createDirectory("/a/b");

    expect(client.mkdir.mock.calls[0][0]).toBe("a\\b");
  });

  it("propagates errors", async () => {
    const err = smbError("STATUS_OBJECT_NAME_COLLISION");
    const { provider } = makeProvider(fakeClient({ mkdir: vi.fn((_p, cb) => cb(err)) }));

    await expect(provider.createDirectory("/a")).rejects.toBe(err);
  });
});
