/**
 * Lyrics model and parsers.
 *
 * Three sources converge here and all three are normalised to one shape:
 *
 * - OpenSubsonic `getLyricsBySongId` — line level, plus word/syllable level
 *   (`cueLine`/`cue`) and vocal attribution (`agents`) when the server
 *   advertises the `songLyrics` v2 extension.
 * - TTML — the timed lyric format used by streaming services, and the format
 *   OpenSubsonic v2 is
 *   derived from, so an exported `.ttml` pastes straight in.
 * - LRC — plain, and "enhanced" LRC with inline `<mm:ss.xx>` word tags.
 *
 * All times are seconds from the start of the track, matching
 * `player.currentTime`, so callers never have to know which source won.
 */

/** A timed word (or syllable) inside a lyric line. */
export type LyricsWord = {
  text: string;
  start: number;
  end: number;
  /** The source had trailing whitespace, which has to come back when painted. */
  space?: boolean;
  /** A background vocal sung under the lead line. */
  background?: boolean;
};

export type LyricsLine = {
  text: string;
  start?: number;
  end?: number;
  /** Word-level timing. Absent on line-level lyrics. */
  words?: LyricsWord[];
  /** Background layer for this line, painted under the lead words. */
  backing?: LyricsWord[];
  /** A second vocalist sings this line, so it hangs off the right edge. */
  align?: "left" | "right";
  translation?: string;
  pronunciation?: string;
};

export type Lyrics = {
  lines: LyricsLine[];
  synced: boolean;
  language?: string;
  /** At least one line carries word-level timing. */
  wordByWord?: boolean;
};

/** A word with no timing of its own gets this much time so its fill completes. */
const WORD_TAIL_SECONDS = 0.4;

/** How far apart two timestamps may be and still be treated as the same line. */
const SUPPORTING_MATCH_SECONDS = 1.5;

const LRC_LINE_TIME = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const LRC_WORD_TIME = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
const LRC_BRACKETED = /\[[^\]]*\]/g;

function lrcStamp(minutes: string, seconds: string, fraction?: string): number {
  const padded = (fraction || "").padEnd(3, "0").slice(0, 3);
  return (
    Number(minutes) * 60 + Number(seconds) + (padded ? Number(padded) / 1000 : 0)
  );
}

/**
 * Build a word, leaving the optional flags off when they are false so the
 * parsed model is exactly as small as the source data.
 */
function makeWord(
  text: string,
  start: number,
  end: number,
  flags: { space?: boolean; background?: boolean } = {},
): LyricsWord {
  const word: LyricsWord = { text, start, end };
  if (flags.space) word.space = true;
  if (flags.background) word.background = true;
  return word;
}

/** `hh:mm:ss`, `mm:ss`, or a bare second count — the TTML clock-time forms. */
export function clockSeconds(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) {
    const amount = Number(part);
    if (!Number.isFinite(amount)) return null;
    seconds = seconds * 60 + amount;
  }
  return seconds;
}

/**
 * Fill in missing or degenerate end times so a word's fill always completes.
 * OpenSubsonic may omit `end` from every cue on a line, and TTML spans are not
 * required to carry one.
 */
export function completeWordTimes(
  words: LyricsWord[],
  lineEnd?: number | null,
): LyricsWord[] {
  return words.map((word, index) => {
    if (word.end > word.start) return word;
    const next = words[index + 1];
    const fallback =
      next && next.start > word.start
        ? next.start
        : lineEnd && lineEnd > word.start
          ? lineEnd
          : word.start + WORD_TAIL_SECONDS;
    return { ...word, end: fallback };
  });
}

/** The plain text of a line, reconstructed from its words. */
function wordsToText(words: LyricsWord[]): string {
  return words
    .map((word) => word.text + (word.space ? " " : ""))
    .join("")
    .trim();
}

function parseLrcWords(body: string): LyricsWord[] {
  const tags = [...body.matchAll(LRC_WORD_TIME)];
  if (!tags.length) return [];
  const words: LyricsWord[] = [];
  let closing: number | undefined;
  for (let index = 0; index < tags.length; index += 1) {
    const tag = tags[index];
    const from = (tag.index ?? 0) + tag[0].length;
    const to =
      index + 1 < tags.length ? tags[index + 1].index ?? body.length : body.length;
    const raw = body.slice(from, to);
    const start = lrcStamp(tag[1], tag[2], tag[3]);
    if (!raw.trim()) {
      // A tag with no text behind it only closes the word before it.
      closing = start;
      continue;
    }
    const nextTag = tags[index + 1];
    const next = nextTag ? lrcStamp(nextTag[1], nextTag[2], nextTag[3]) : undefined;
    const text = raw.replace(/\s+$/, "");
    words.push(
      makeWord(text, start, next ?? start + WORD_TAIL_SECONDS, {
        space: raw.length > text.length,
      }),
    );
  }
  return completeWordTimes(words, closing);
}

export function parseLrc(value: string): Lyrics | null {
  const lines: LyricsLine[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const stamps = [...rawLine.matchAll(LRC_LINE_TIME)];
    if (!stamps.length) continue;
    const body = rawLine
      .replace(LRC_LINE_TIME, "")
      .replace(LRC_BRACKETED, "");
    const words = parseLrcWords(body);
    const text = words.length ? wordsToText(words) : body.trim();
    for (const stamp of stamps) {
      const line: LyricsLine = {
        text,
        start: lrcStamp(stamp[1], stamp[2], stamp[3]),
      };
      // Repeating one line at several timestamps makes its inline word times
      // ambiguous, so only a single-stamp line keeps them.
      if (stamps.length === 1 && words.length) line.words = words;
      lines.push(line);
    }
  }
  if (!lines.length) return null;
  lines.sort((left, right) => (left.start ?? 0) - (right.start ?? 0));
  return {
    lines,
    synced: true,
    wordByWord: lines.some((line) => line.words?.length),
  };
}

export function parsePlainLyrics(value: string): Lyrics | null {
  if (!value.trim()) return null;
  return {
    synced: false,
    lines: value.split(/\r?\n/).map((text) => ({ text })),
  };
}

/* ------------------------------------------------------------------ TTML -- */

/**
 * Read an attribute by local name, ignoring any namespace prefix. TTML uses
 * `itunes:timing`, `ttm:role` and `xml:lang`, and a document that never
 * declared those prefixes still carries the data under a literal name.
 */
function readAttribute(element: Element, name: string): string | null {
  for (const attribute of Array.from(element.attributes)) {
    if (attribute.localName === name || attribute.name === name) {
      return attribute.value;
    }
  }
  return null;
}

/** Text of an element, with `<br>` standing in for a space. */
function readInlineText(element: Element): string {
  let text = "";
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === 3) text += node.nodeValue ?? "";
    else if (node.nodeType === 1) {
      const child = node as Element;
      text += child.localName === "br" ? " " : readInlineText(child);
    }
  }
  return text;
}

/** Text of an element on one line, the way a lyric line is collapsed. */
function readText(element: Element): string {
  return readInlineText(element).replace(/\s+/g, " ").trim();
}

/** `<translations><translation for="…">` keyed by the `for` reference. */
function readReferences(
  document: Document,
  container: string,
  item: string,
): Map<string, string> {
  const references = new Map<string, string>();
  for (const scope of Array.from(document.getElementsByTagName(container))) {
    for (const child of Array.from(scope.getElementsByTagName(item))) {
      const key = readAttribute(child, "for");
      const text = readText(child);
      if (key && text) references.set(key, text);
    }
  }
  return references;
}

function readTtmlWords(
  paragraph: Element,
  lineEnd: number | null,
): { words: LyricsWord[]; backing: LyricsWord[] } {
  const words: LyricsWord[] = [];
  const backing: LyricsWord[] = [];
  const collect = (scope: Element, background: boolean) => {
    for (const node of Array.from(scope.childNodes)) {
      if (node.nodeType !== 1) continue;
      const element = node as Element;
      if (element.localName !== "span") continue;
      if (readAttribute(element, "role") === "x-bg") {
        collect(element, true);
        continue;
      }
      const start = clockSeconds(readAttribute(element, "begin"));
      if (start === null) {
        collect(element, background);
        continue;
      }
      const raw = readInlineText(element);
      const text = raw.replace(/\s+/g, " ").trim();
      if (!text) continue;
      const end = clockSeconds(readAttribute(element, "end")) ?? start;
      (background ? backing : words).push(
        makeWord(text, start, end, {
          space: /\s$/.test(raw),
          background,
        }),
      );
    }
  };
  collect(paragraph, false);
  return {
    words: completeWordTimes(words, lineEnd),
    backing: completeWordTimes(backing, lineEnd),
  };
}

/**
 * Parse TTML lyrics. Returns null when the text is not TTML, so this can
 * be tried in front of the other formats.
 */
export function parseTtml(value: string): Lyrics | null {
  if (typeof DOMParser === "undefined") return null;
  if (!/<\s*tt[\s>]/i.test(value)) return null;
  let document: Document;
  try {
    document = new DOMParser().parseFromString(value, "text/xml");
  } catch {
    return null;
  }
  if (document.querySelector("parsererror")) return null;
  const paragraphs = Array.from(document.getElementsByTagName("p"));
  if (!paragraphs.length) return null;
  const translations = readReferences(document, "translations", "translation");
  const transliterations = readReferences(
    document,
    "transliterations",
    "transliteration",
  );
  const lines: LyricsLine[] = [];
  let wordByWord = false;
  for (const paragraph of paragraphs) {
    const start = clockSeconds(readAttribute(paragraph, "begin"));
    const end = clockSeconds(readAttribute(paragraph, "end"));
    const key = readAttribute(paragraph, "key");
    const agent = readAttribute(paragraph, "agent");
    const { words, backing } = readTtmlWords(paragraph, end);
    if (words.length) wordByWord = true;
    const line: LyricsLine = { text: readText(paragraph) };
    if (start !== null) line.start = start;
    if (end !== null) line.end = end;
    if (words.length) line.words = words;
    if (backing.length) line.backing = backing;
    if (agent && agent !== "v1") line.align = "right";
    const translation = key ? translations.get(key) : undefined;
    if (translation) line.translation = translation;
    const pronunciation = key ? transliterations.get(key) : undefined;
    if (pronunciation) line.pronunciation = pronunciation;
    lines.push(line);
  }
  const tt = document.getElementsByTagName("tt")[0] ?? document.documentElement;
  const language = tt ? readAttribute(tt, "lang") : null;
  const lyrics: Lyrics = {
    lines,
    synced: lines.some((line) => line.start !== undefined),
    wordByWord,
  };
  if (language) lyrics.language = language;
  return lyrics;
}

/**
 * Normalise any pasted lyric text: TTML first, then LRC, then plain. TTML is
 * cheap to rule out because it has to open with a `<tt>` element.
 */
export function parseLyricsText(value: string): Lyrics | null {
  return parseTtml(value) || parseLrc(value) || parsePlainLyrics(value);
}

/* ------------------------------------------- OpenSubsonic structured lyrics -- */

export type StructuredCue = {
  start?: number;
  end?: number;
  value?: string;
};

export type StructuredCueLine = {
  index?: number;
  start?: number;
  end?: number;
  value?: string;
  agentId?: string;
  cue?: StructuredCue[];
};

export type StructuredAgent = {
  id?: string;
  /** `main`, `bg`, `voice`, `group`. */
  role?: string;
  name?: string;
};

export type StructuredLyrics = {
  lang?: string;
  offset?: number;
  synced?: boolean;
  /** `main`, `translation`, or `pronunciation`. */
  kind?: string;
  line?: { value?: string; start?: number }[];
  cueLine?: StructuredCueLine[];
  agents?: StructuredAgent[];
};

/** Positive offsets show lyrics sooner, so they are subtracted. */
function makeShifter(offset: number) {
  const seconds = (Number.isFinite(offset) ? offset : 0) / 1000;
  return (value: number) => Math.max(0, value - seconds);
}

function structuredWords(
  group: StructuredCueLine[],
  roles: Map<string, string>,
  shift: (value: number) => number,
  lineEnd: number | undefined,
): { words: LyricsWord[]; backing: LyricsWord[] } {
  const words: LyricsWord[] = [];
  const backing: LyricsWord[] = [];
  for (const cueLine of group) {
    const role = cueLine.agentId ? roles.get(cueLine.agentId) ?? "main" : "main";
    const background = role === "bg";
    for (const cue of cueLine.cue ?? []) {
      const raw = cue.value ?? "";
      const text = raw.replace(/\s+$/, "");
      // A whitespace-only cue carries no glyphs; the previous word keeps the gap.
      if (!text) continue;
      const start = shift((cue.start ?? cueLine.start ?? 0) / 1000);
      const end = shift((cue.end ?? 0) / 1000);
      (background ? backing : words).push(
        makeWord(text, start, end, {
          space: raw.length > text.length,
          background,
        }),
      );
    }
  }
  return {
    words: completeWordTimes(
      words.sort((left, right) => left.start - right.start),
      lineEnd,
    ),
    backing: completeWordTimes(
      backing.sort((left, right) => left.start - right.start),
      lineEnd,
    ),
  };
}

/** Match a supporting track onto the main lines by nearest start time. */
function attachSupporting(
  lines: LyricsLine[],
  supporting: { start: number; value: string }[] | null,
  field: "translation" | "pronunciation",
) {
  if (!supporting?.length) return;
  const used = new Set<number>();
  for (const line of lines) {
    if (line.start === undefined) continue;
    let best = -1;
    let bestDistance = Infinity;
    supporting.forEach((item, index) => {
      if (used.has(index)) return;
      const distance = Math.abs(item.start - line.start!);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    if (best >= 0 && bestDistance <= SUPPORTING_MATCH_SECONDS) {
      used.add(best);
      line[field] = supporting[best].value;
    }
  }
}

/**
 * Turn OpenSubsonic `structuredLyrics` into the shared model. Word-level
 * timing, background vocals, duet alignment and translation tracks are all
 * optional; anything the server omits simply stays undefined.
 */
export function lyricsFromStructured(
  entries: StructuredLyrics[] | undefined,
): Lyrics | null {
  if (!entries?.length) return null;
  const mains = entries.filter(
    (entry) => (entry.kind ?? "main") === "main" && entry.line?.length,
  );
  // A server may publish several main tracks (one per language), so prefer a
  // synced one rather than letting an unsynced sibling hide the word timing.
  const main = mains.find((entry) => entry.synced === true) ?? mains[0];
  if (!main) return null;
  const shift = makeShifter(main.offset ?? 0);
  const roles = new Map(
    (main.agents ?? []).map((agent) => [agent.id ?? "", agent.role ?? "main"]),
  );
  const groups = new Map<number, StructuredCueLine[]>();
  for (const cueLine of main.cueLine ?? []) {
    const index = cueLine.index ?? -1;
    const bucket = groups.get(index);
    if (bucket) bucket.push(cueLine);
    else groups.set(index, [cueLine]);
  }
  const lines: LyricsLine[] = [];
  let wordByWord = false;
  main.line!.forEach((line, index) => {
    const start =
      typeof line.start === "number" && Number.isFinite(line.start)
        ? shift(line.start / 1000)
        : undefined;
    const group = groups.get(index) ?? [];
    const lead =
      group.find((cueLine) => {
        const role = cueLine.agentId
          ? roles.get(cueLine.agentId) ?? "main"
          : "main";
        return role === "main";
      }) ?? group[0];
    const end =
      typeof lead?.end === "number" ? shift(lead.end / 1000) : undefined;
    const { words, backing } = structuredWords(group, roles, shift, end);
    const secondary = group.some((cueLine) => {
      const role = cueLine.agentId
        ? roles.get(cueLine.agentId) ?? "main"
        : "main";
      return role !== "main" && role !== "bg";
    });
    if (words.length) wordByWord = true;
    lines.push({
      text: line.value ?? "",
      start,
      end,
      words: words.length ? words : undefined,
      backing: backing.length ? backing : undefined,
      align: secondary ? "right" : undefined,
    });
  });
  const supporting = (kind: string) => {
    const entry = entries.find((item) => item.kind === kind && item.line?.length);
    if (!entry) return null;
    const shiftEntry = makeShifter(entry.offset ?? 0);
    return entry.line!
      .filter(
        (line): line is { value?: string; start: number } =>
          typeof line.start === "number" && Number.isFinite(line.start),
      )
      .map((line) => ({ start: shiftEntry(line.start / 1000), value: line.value ?? "" }));
  };
  attachSupporting(lines, supporting("translation"), "translation");
  attachSupporting(lines, supporting("pronunciation"), "pronunciation");
  const lyrics: Lyrics = {
    lines,
    synced: main.synced === true && lines.some((line) => line.start !== undefined),
    wordByWord,
  };
  if (main.lang && main.lang !== "und" && main.lang !== "xxx")
    lyrics.language = main.lang;
  return lyrics;
}
