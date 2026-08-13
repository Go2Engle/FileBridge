/**
 * Filename templating for the "move" post-transfer action.
 *
 * A job may define a template that renames the source file as it is moved into
 * the archive folder — most commonly to stamp it with a date so that a source
 * producing the same filename every day doesn't collide in the archive.
 *
 * An empty template means "keep the original filename", which is the behaviour
 * every job had before this feature existed.
 */

/** Tokens available in a move filename template, with human-readable examples. */
export const MOVE_TEMPLATE_TOKENS: { token: string; description: string }[] = [
  { token: "{name}", description: "Filename without extension" },
  { token: "{ext}", description: "Extension including the dot (empty if none)" },
  { token: "{date}", description: "2026-08-13" },
  { token: "{time}", description: "031500" },
  { token: "{datetime}", description: "2026-08-13_031500" },
  { token: "{timestamp}", description: "20260813031500" },
  { token: "{year}", description: "2026" },
  { token: "{month}", description: "08" },
  { token: "{day}", description: "13" },
  { token: "{hour}", description: "03" },
  { token: "{minute}", description: "15" },
  { token: "{second}", description: "00" },
];

/** Convenience preset offered in the UI — the common "append date and time" case. */
export const MOVE_TEMPLATE_TIMESTAMP_PRESET = "{name}_{date}_{time}{ext}";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Splits a filename into its base name and extension (".tar.gz" counts as ".gz"). */
function splitName(fileName: string): { name: string; ext: string } {
  const dot = fileName.lastIndexOf(".");
  // A leading dot means a dotfile (".gitignore"), not an extension.
  if (dot <= 0) return { name: fileName, ext: "" };
  return { name: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

/**
 * Renders a move filename template.
 *
 * @param template  The job's template. Empty/whitespace-only returns `fileName` unchanged.
 * @param fileName  The original source filename (no directory component).
 * @param at        Timestamp to stamp into the name — the job run's start time, so that
 *                  every file moved by a single run shares one consistent suffix.
 *                  Interpreted in the server's local timezone, matching cron schedules.
 */
export function renderMoveFileName(
  template: string | null | undefined,
  fileName: string,
  at: Date
): string {
  const tpl = (template ?? "").trim();
  if (!tpl) return fileName;

  const { name, ext } = splitName(fileName);
  const year = String(at.getFullYear());
  const month = pad(at.getMonth() + 1);
  const day = pad(at.getDate());
  const hour = pad(at.getHours());
  const minute = pad(at.getMinutes());
  const second = pad(at.getSeconds());

  const date = `${year}-${month}-${day}`;
  const time = `${hour}${minute}${second}`;

  const values: Record<string, string> = {
    name,
    ext,
    date,
    time,
    datetime: `${date}_${time}`,
    timestamp: `${year}${month}${day}${time}`,
    year,
    month,
    day,
    hour,
    minute,
    second,
  };

  const rendered = tpl.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key] : match
  );

  return sanitizeFileName(rendered, fileName);
}

/**
 * Keeps a rendered name confined to the move folder: a template must never be
 * able to introduce path separators or traverse upwards. Falls back to the
 * original filename if the template renders to nothing usable.
 */
function sanitizeFileName(rendered: string, fallback: string): string {
  const flat = rendered.replace(/[/\\]/g, "_").trim();
  if (!flat || flat === "." || flat === "..") return fallback;
  return flat;
}
