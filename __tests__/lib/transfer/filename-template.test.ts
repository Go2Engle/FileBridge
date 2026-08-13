import { describe, it, expect } from "vitest";
import {
  renderMoveFileName,
  MOVE_TEMPLATE_TIMESTAMP_PRESET,
} from "@/lib/transfer/filename-template";

// 2026-08-13 03:15:00 local time
const AT = new Date(2026, 7, 13, 3, 15, 0);

describe("renderMoveFileName", () => {
  describe("backwards compatibility", () => {
    it("returns the original name for an empty template", () => {
      expect(renderMoveFileName("", "report.csv", AT)).toBe("report.csv");
    });

    it("returns the original name for null/undefined (pre-existing jobs)", () => {
      expect(renderMoveFileName(null, "report.csv", AT)).toBe("report.csv");
      expect(renderMoveFileName(undefined, "report.csv", AT)).toBe("report.csv");
    });

    it("returns the original name for a whitespace-only template", () => {
      expect(renderMoveFileName("   ", "report.csv", AT)).toBe("report.csv");
    });
  });

  describe("tokens", () => {
    it("renders the date-and-time preset", () => {
      expect(renderMoveFileName(MOVE_TEMPLATE_TIMESTAMP_PRESET, "report.csv", AT)).toBe(
        "report_2026-08-13_031500.csv"
      );
    });

    it("renders individual date-part tokens", () => {
      expect(
        renderMoveFileName("{year}{month}{day}-{hour}{minute}{second}-{name}{ext}", "a.txt", AT)
      ).toBe("20260813-031500-a.txt");
    });

    it("renders datetime and timestamp", () => {
      expect(renderMoveFileName("{datetime}{ext}", "a.txt", AT)).toBe("2026-08-13_031500.txt");
      expect(renderMoveFileName("{timestamp}{ext}", "a.txt", AT)).toBe("20260813031500.txt");
    });

    it("supports prefixing as well as suffixing", () => {
      expect(renderMoveFileName("{date}_{name}{ext}", "report.csv", AT)).toBe(
        "2026-08-13_report.csv"
      );
    });

    it("leaves unrecognized tokens untouched so typos are visible", () => {
      expect(renderMoveFileName("{name}_{nope}{ext}", "report.csv", AT)).toBe(
        "report_{nope}.csv"
      );
    });
  });

  describe("filename splitting", () => {
    it("handles a file with no extension", () => {
      expect(renderMoveFileName("{name}_{date}{ext}", "README", AT)).toBe("README_2026-08-13");
    });

    it("treats a leading dot as part of the name, not an extension", () => {
      expect(renderMoveFileName("{name}_{date}{ext}", ".gitignore", AT)).toBe(
        ".gitignore_2026-08-13"
      );
    });

    it("splits on the last dot only", () => {
      expect(renderMoveFileName("{name}_{date}{ext}", "archive.tar.gz", AT)).toBe(
        "archive.tar_2026-08-13.gz"
      );
    });

    it("preserves spaces in the original name", () => {
      expect(renderMoveFileName("{name}_{date}{ext}", "daily report.csv", AT)).toBe(
        "daily report_2026-08-13.csv"
      );
    });
  });

  describe("path safety", () => {
    it("flattens path separators so a template cannot escape the move folder", () => {
      expect(renderMoveFileName("../../{name}{ext}", "report.csv", AT)).toBe(
        ".._.._report.csv"
      );
      expect(renderMoveFileName("sub\\{name}{ext}", "report.csv", AT)).toBe("sub_report.csv");
    });

    it("falls back to the original name when the template renders to nothing usable", () => {
      expect(renderMoveFileName("{unknownonly}", "report.csv", AT)).toBe("{unknownonly}");
      expect(renderMoveFileName("/", "report.csv", AT)).toBe("_");
      expect(renderMoveFileName("..", "report.csv", AT)).toBe("report.csv");
    });
  });

  describe("run consistency", () => {
    it("gives every file in one run the same stamp", () => {
      const a = renderMoveFileName(MOVE_TEMPLATE_TIMESTAMP_PRESET, "a.csv", AT);
      const b = renderMoveFileName(MOVE_TEMPLATE_TIMESTAMP_PRESET, "b.csv", AT);
      expect(a).toBe("a_2026-08-13_031500.csv");
      expect(b).toBe("b_2026-08-13_031500.csv");
    });
  });
});
