import { describe, it, expect } from "vitest";
import { globToRegex } from "@/lib/storage/interface";

describe("globToRegex()", () => {
  it("empty string matches everything", () => {
    const re = globToRegex("");
    expect(re.test("anything.txt")).toBe(true);
    expect(re.test("")).toBe(true);
  });

  it("matches a simple wildcard extension pattern", () => {
    const re = globToRegex("*.csv");
    expect(re.test("report.csv")).toBe(true);
    expect(re.test("data.CSV")).toBe(true); // case-insensitive
    expect(re.test("report.txt")).toBe(false);
  });

  it("matches a literal filename", () => {
    const re = globToRegex("config.json");
    expect(re.test("config.json")).toBe(true);
    expect(re.test("config.xml")).toBe(false);
    expect(re.test("myconfig.json")).toBe(false);
  });

  it("matches filenames with prefix wildcards", () => {
    const re = globToRegex("report_*");
    expect(re.test("report_2024.xlsx")).toBe(true);
    expect(re.test("report_")).toBe(true);
    expect(re.test("export_2024.xlsx")).toBe(false);
  });

  it("handles comma-separated patterns as OR", () => {
    const re = globToRegex("*.csv, *.txt");
    expect(re.test("data.csv")).toBe(true);
    expect(re.test("notes.txt")).toBe(true);
    expect(re.test("image.png")).toBe(false);
  });

  it("handles three or more patterns", () => {
    const re = globToRegex("*.csv, *.txt, *.json");
    expect(re.test("data.csv")).toBe(true);
    expect(re.test("notes.txt")).toBe(true);
    expect(re.test("config.json")).toBe(true);
    expect(re.test("photo.jpg")).toBe(false);
  });

  it("treats ? as a single-character wildcard", () => {
    const re = globToRegex("file?.txt");
    expect(re.test("fileA.txt")).toBe(true);
    expect(re.test("file1.txt")).toBe(true);
    expect(re.test("file.txt")).toBe(false); // no char in place of ?
    expect(re.test("fileAB.txt")).toBe(false); // two chars
  });

  it("escapes regex special characters in patterns", () => {
    // Dots in glob patterns should be literal dots, not regex any-char
    const re = globToRegex("file.txt");
    expect(re.test("file.txt")).toBe(true);
    expect(re.test("fileXtxt")).toBe(false);
  });

  it("strips extra whitespace around comma-separated patterns", () => {
    const re = globToRegex("  *.csv  ,  *.json  ");
    expect(re.test("data.csv")).toBe(true);
    expect(re.test("config.json")).toBe(true);
  });

  it("ignores empty segments in comma-separated patterns", () => {
    const re = globToRegex("*.csv,,*.json");
    expect(re.test("data.csv")).toBe(true);
    expect(re.test("config.json")).toBe(true);
  });
});
