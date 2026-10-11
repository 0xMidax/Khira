/**
 * KQL — a small JQL-like query language.
 *
 *   project = KHR AND assignee = me() AND status != Done ORDER BY priority DESC, created
 *   type in (bug, story) and (priority >= high or due < 7d) and text ~ "login"
 *   assignee is empty and sprint in openSprints()
 */

export const KQL_FIELDS = [
  "project",
  "key",
  "status",
  "category",
  "type",
  "priority",
  "assignee",
  "reporter",
  "label",
  "sprint",
  "release",
  "parent",
  "created",
  "updated",
  "due",
  "resolved",
  "estimate",
  "text",
  "title",
  "triage",
] as const;
export type KqlField = (typeof KQL_FIELDS)[number];
export type KqlOp = "=" | "!=" | ">" | ">=" | "<" | "<=" | "~" | "!~" | "in" | "not in" | "is empty" | "is not empty";
export type KqlValue = { kind: "str"; v: string } | { kind: "num"; v: number } | { kind: "fn"; name: string; args: string[] };

export type KqlNode =
  | { type: "and" | "or"; left: KqlNode; right: KqlNode }
  | { type: "not"; expr: KqlNode }
  | { type: "clause"; field: KqlField; op: KqlOp; values: KqlValue[] };

export type KqlOrder = { field: KqlField; dir: "asc" | "desc" };
export type KqlQuery = { where: KqlNode | null; orderBy: KqlOrder[] };

export class KqlError extends Error {
  constructor(
    message: string,
    public pos: number,
  ) {
    super(message);
  }
}

type Tok = { t: "word" | "str" | "num" | "op" | "(" | ")" | "," | "eof"; v: string; pos: number };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, v: c, pos: i++ });
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < src.length) j++;
        s += src[j++];
      }
      if (j >= src.length) throw new KqlError("Unclosed quote", i);
      out.push({ t: "str", v: s, pos: i });
      i = j + 1;
      continue;
    }
    const op = /^(!=|>=|<=|!~|=|>|<|~)/.exec(src.slice(i));
    if (op) {
      out.push({ t: "op", v: op[1], pos: i });
      i += op[1].length;
      continue;
    }
    const w = /^[^\s()",'=!<>~]+/.exec(src.slice(i));
    if (!w) throw new KqlError(`Unexpected "${c}"`, i);
    out.push({ t: /^-?\d+(\.\d+)?$/.test(w[0]) ? "num" : "word", v: w[0], pos: i });
    i += w[0].length;
  }
  out.push({ t: "eof", v: "", pos: src.length });
  return out;
}

const kw = (tok: Tok, word: string) => tok.t === "word" && tok.v.toLowerCase() === word;

export function parseKql(src: string): KqlQuery {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const expect = (t: Tok["t"], what: string) => {
    const tok = next();
    if (tok.t !== t) throw new KqlError(`Expected ${what}`, tok.pos);
    return tok;
  };

  function value(): KqlValue {
    const tok = next();
    if (tok.t === "str") return { kind: "str", v: tok.v };
    if (tok.t === "num") return { kind: "num", v: Number(tok.v) };
    if (tok.t === "word") {
      if (peek().t === "(") {
        next();
        const args: string[] = [];
        while (peek().t !== ")") {
          const a = next();
          if (a.t === "eof") throw new KqlError("Unclosed function call", a.pos);
          if (a.t !== ",") args.push(a.v);
        }
        next();
        return { kind: "fn", name: tok.v.toLowerCase(), args };
      }
      return { kind: "str", v: tok.v };
    }
    throw new KqlError("Expected a value", tok.pos);
  }

  function clause(): KqlNode {
    const f = next();
    if (f.t !== "word") throw new KqlError("Expected a field name", f.pos);
    const field = f.v.toLowerCase() as KqlField;
    if (!KQL_FIELDS.includes(field)) throw new KqlError(`Unknown field "${f.v}". Try: ${KQL_FIELDS.join(", ")}`, f.pos);

    const t = peek();
    if (kw(t, "is")) {
      next();
      const negate = kw(peek(), "not") ? (next(), true) : false;
      const e = next();
      if (!kw(e, "empty") && !kw(e, "null")) throw new KqlError('Expected "empty" after "is"', e.pos);
      return { type: "clause", field, op: negate ? "is not empty" : "is empty", values: [] };
    }
    let op: KqlOp;
    if (kw(t, "in")) {
      next();
      op = "in";
    } else if (kw(t, "not") && kw(toks[p + 1], "in")) {
      p += 2;
      op = "not in";
    } else if (t.t === "op") {
      op = next().v as KqlOp;
    } else throw new KqlError(`Expected an operator after ${f.v} (=, !=, >, <, ~, in, is empty)`, t.pos);

    if (op === "in" || op === "not in") {
      if (peek().t === "word" && toks[p + 1]?.t === "(") return { type: "clause", field, op, values: [value()] }; // e.g. in openSprints()
      expect("(", '"(" after in');
      const values: KqlValue[] = [];
      while (peek().t !== ")") {
        values.push(value());
        if (peek().t === ",") next();
        else if (peek().t !== ")") throw new KqlError('Expected "," or ")"', peek().pos);
      }
      next();
      if (!values.length) throw new KqlError("Empty list", t.pos);
      return { type: "clause", field, op, values };
    }
    return { type: "clause", field, op, values: [value()] };
  }

  function primary(): KqlNode {
    if (peek().t === "(") {
      next();
      const e = or();
      expect(")", '")"');
      return e;
    }
    if (kw(peek(), "not")) {
      next();
      return { type: "not", expr: primary() };
    }
    return clause();
  }
  function and(): KqlNode {
    let left = primary();
    while (kw(peek(), "and")) {
      next();
      left = { type: "and", left, right: primary() };
    }
    return left;
  }
  function or(): KqlNode {
    let left = and();
    while (kw(peek(), "or")) {
      next();
      left = { type: "or", left, right: and() };
    }
    return left;
  }

  const where = peek().t === "eof" || kw(peek(), "order") ? null : or();
  const orderBy: KqlOrder[] = [];
  if (kw(peek(), "order")) {
    next();
    if (!kw(next(), "by")) throw new KqlError('Expected "by" after "order"', toks[p - 1].pos);
    do {
      const f = next();
      const field = f.v.toLowerCase() as KqlField;
      if (f.t !== "word" || !KQL_FIELDS.includes(field)) throw new KqlError(`Can't order by "${f.v}"`, f.pos);
      const dir = kw(peek(), "desc") ? (next(), "desc" as const) : kw(peek(), "asc") ? (next(), "asc" as const) : "asc";
      orderBy.push({ field, dir });
    } while (peek().t === "," && next());
  }
  if (peek().t !== "eof") throw new KqlError(`Unexpected "${peek().v}"`, peek().pos);
  return { where, orderBy };
}

/** "7d" / "-2w" / "1m" / "12h" → Date relative to now (positive = future). Also ISO dates. */
export function parseRelativeDate(s: string, now = new Date()): Date | null {
  const m = /^([+-]?\d+)([hdwm])$/i.exec(s.trim());
  if (m) {
    const n = Number(m[1]);
    const d = new Date(now);
    const unit = m[2].toLowerCase();
    if (unit === "h") d.setHours(d.getHours() + n);
    if (unit === "d") d.setDate(d.getDate() + n);
    if (unit === "w") d.setDate(d.getDate() + n * 7);
    if (unit === "m") d.setMonth(d.getMonth() + n);
    return d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}
