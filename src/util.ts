/** Adresa z IMAP envelope. */
export interface EnvelopeAddress {
  name?: string;
  address?: string;
}

/** Naformátuje seznam adres na čitelný řetězec: `Jméno <a@b.cz>, c@d.cz`. */
export function formatAddresses(list?: EnvelopeAddress[] | null): string {
  if (!list || list.length === 0) return "";
  return list
    .map((a) => (a.name ? `${a.name} <${a.address ?? ""}>` : a.address ?? ""))
    .filter(Boolean)
    .join(", ");
}

/**
 * Převede vstup na datum. Podporuje ISO (`2026-06-01`) i relativní formát
 * (`30m`, `2h`, `7d`, `2w`). Relativní = "před X od teď".
 */
export function parseDateInput(input: string): Date {
  const s = input.trim();
  const rel = s.match(/^(\d+)\s*([mhdw])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMs: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return new Date(Date.now() - n * unitMs[rel[2].toLowerCase()]);
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `Neplatné datum: "${input}". Použij ISO (2026-06-01) nebo relativní (7d, 2h, 30m, 2w).`,
    );
  }
  return d;
}

/** Uzel IMAP bodyStructure (zjednodušeně — jen co potřebujeme). */
interface BodyStructureNode {
  disposition?: string | null;
  childNodes?: BodyStructureNode[] | null;
}

/** Projde strukturu těla a zjistí, jestli e-mail obsahuje přílohu. */
export function structureHasAttachment(node?: BodyStructureNode | null): boolean {
  if (!node) return false;
  if (node.disposition && String(node.disposition).toLowerCase() === "attachment") {
    return true;
  }
  if (Array.isArray(node.childNodes)) {
    return node.childNodes.some(structureHasAttachment);
  }
  return false;
}

/** Zajistí prefix "Re: " v předmětu odpovědi (bez duplikace). */
export function replySubject(subject?: string | null): string {
  const s = (subject ?? "").trim();
  if (/^re:/i.test(s)) return s;
  return `Re: ${s}`;
}

/** Vytvoří citovaný text původní zprávy pro draft odpovědi. */
export function quoteOriginal(opts: {
  fromText: string;
  date?: Date | null;
  body?: string | null;
}): string {
  const when = opts.date ? opts.date.toLocaleString("cs-CZ") : "dříve";
  const attribution = `Dne ${when} napsal(a) ${opts.fromText}:`;
  const quoted = (opts.body ?? "")
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\n${attribution}\n${quoted}\n`;
}
