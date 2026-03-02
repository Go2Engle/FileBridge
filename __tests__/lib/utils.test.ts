import { describe, it, expect } from "vitest";
import { cn, formatBytes, formatDuration, parseDBDate } from "@/lib/utils";

describe("cn()", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("deduplicates conflicting Tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("returns empty string for no inputs", () => {
    expect(cn()).toBe("");
  });

  it("handles undefined and null gracefully", () => {
    expect(cn(undefined, null, "visible")).toBe("visible");
  });
});

describe("formatBytes()", () => {
  it("returns '0 B' for zero bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes correctly", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes correctly", () => {
    expect(formatBytes(1000)).toBe("1 KB");
  });

  it("formats megabytes correctly", () => {
    expect(formatBytes(1_000_000)).toBe("1 MB");
  });

  it("formats gigabytes correctly", () => {
    expect(formatBytes(1_000_000_000)).toBe("1 GB");
  });

  it("respects the decimals parameter", () => {
    expect(formatBytes(1500, 1)).toBe("1.5 KB");
    expect(formatBytes(1500, 0)).toBe("2 KB");
  });
});

describe("formatDuration()", () => {
  it("formats sub-second durations in ms", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("formats durations less than a minute in seconds", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatDuration(59999)).toBe("60.0s");
  });

  it("formats durations of a minute or more", () => {
    expect(formatDuration(60000)).toBe("1m 0s");
    expect(formatDuration(90000)).toBe("1m 30s");
    expect(formatDuration(3661000)).toBe("61m 1s");
  });
});

describe("parseDBDate()", () => {
  it("parses SQLite datetime strings as UTC", () => {
    const d = parseDBDate("2024-01-15 10:30:00");
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(0); // January
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(10);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it("parses ISO strings with timezone indicator as-is", () => {
    const d = parseDBDate("2024-01-15T10:30:00Z");
    expect(d.getUTCHours()).toBe(10);
  });

  it("parses ISO strings with positive offset", () => {
    const d = parseDBDate("2024-01-15T10:30:00+05:00");
    expect(d.getUTCHours()).toBe(5);
  });

  it("returns a valid Date object", () => {
    const d = parseDBDate("2024-06-01 00:00:00");
    expect(d).toBeInstanceOf(Date);
    expect(isNaN(d.getTime())).toBe(false);
  });
});
