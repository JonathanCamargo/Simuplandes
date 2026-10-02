/**
 * A safe, hand-written recursive-descent expression compiler for
 * `MotorDrive.expression` (D4).
 *
 * `expr-eval` <= 2.0.2 (the version the phase's research suggested) has two
 * unpatched High-severity advisories: GHSA-jc85-fpwf-qm7x / CVE-2025-12735
 * (arbitrary code execution via crafted variables/functions passed to
 * `evaluate`) and GHSA-8gw3-rxh4-v6jx / CVE-2025-13204 (prototype pollution
 * leading to code execution). No patched `expr-eval` release exists.
 * Expressions arrive in user-opened `.simup.json` files (untrusted input),
 * so this module hand-writes a small recursive-descent parser compiled once
 * to closures instead: no `eval`, no `new Function`, no `expr-eval`.
 *
 * Identifiers are resolved ONLY through `Map`s built with `new Map([...])`
 * (`VARIABLES`, `CONSTANTS`, `FUNCTIONS`) — never a plain object indexed by
 * user text, never `in`/`hasOwnProperty`, never `eval`/`new Function`/`with`.
 * `.` is legal only inside a number literal, so there is no member access;
 * `constructor`, `__proto__` and other non-whitelisted names are simply
 * absent from the maps and are rejected as "unknown identifier".
 */

/** Thrown when a source expression cannot be parsed or compiled. Carries the offending character position. */
export class ExpressionError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(`${message} (at position ${position})`);
    this.name = "ExpressionError";
    this.position = position;
  }
}

/** A compiled expression: the original source and a closure that evaluates it at a given `t`. */
export interface CompiledExpression {
  readonly source: string;
  evaluate(t: number): number;
}

const MAX_SOURCE_LENGTH = 1000;
const MAX_NESTING_DEPTH = 64;

/** The only free variable an expression may reference: time (or the driven scrubber value), in seconds/units. */
const VARIABLES = new Map<string, true>([["t", true]]);

/** Named numeric constants. */
const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E],
]);

type FunctionArity = number | "variadic";

interface FunctionEntry {
  readonly arity: FunctionArity;
  readonly fn: (...args: number[]) => number;
}

/** Whitelisted math functions callable from an expression. */
const FUNCTIONS = new Map<string, FunctionEntry>([
  ["sin", { arity: 1, fn: Math.sin }],
  ["cos", { arity: 1, fn: Math.cos }],
  ["tan", { arity: 1, fn: Math.tan }],
  ["asin", { arity: 1, fn: Math.asin }],
  ["acos", { arity: 1, fn: Math.acos }],
  ["atan", { arity: 1, fn: Math.atan }],
  ["atan2", { arity: 2, fn: (y: number, x: number) => Math.atan2(y, x) }],
  ["sinh", { arity: 1, fn: Math.sinh }],
  ["cosh", { arity: 1, fn: Math.cosh }],
  ["tanh", { arity: 1, fn: Math.tanh }],
  ["sqrt", { arity: 1, fn: Math.sqrt }],
  ["abs", { arity: 1, fn: Math.abs }],
  ["exp", { arity: 1, fn: Math.exp }],
  ["log", { arity: 1, fn: Math.log }],
  ["log10", { arity: 1, fn: Math.log10 }],
  ["min", { arity: "variadic", fn: (...args: number[]) => Math.min(...args) }],
  ["max", { arity: "variadic", fn: (...args: number[]) => Math.max(...args) }],
  ["floor", { arity: 1, fn: Math.floor }],
  ["ceil", { arity: 1, fn: Math.ceil }],
  ["round", { arity: 1, fn: Math.round }],
  ["sign", { arity: 1, fn: Math.sign }],
  ["pow", { arity: 2, fn: (base: number, exp: number) => Math.pow(base, exp) }],
]);

type TokenType = "number" | "ident" | "+" | "-" | "*" | "/" | "^" | "(" | ")" | "," | "end";

interface Token {
  readonly type: TokenType;
  readonly value: string;
  readonly pos: number;
}

function isDigit(c: string | undefined): boolean {
  return c !== undefined && c >= "0" && c <= "9";
}

function isIdentStart(c: string | undefined): boolean {
  return c !== undefined && ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_");
}

function isIdentPart(c: string | undefined): boolean {
  return isIdentStart(c) || isDigit(c);
}

const SIMPLE_TOKENS = new Set<string>(["+", "-", "*", "/", "^", "(", ")", ","]);

/** Scans `source` into a flat token list, ending with an `"end"` sentinel token. Throws `ExpressionError` on any unrecognized character. */
function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let i = 0;

  const scanExponent = (from: number): number => {
    let j = from;
    if (source[j] === "e" || source[j] === "E") {
      let k = j + 1;
      if (source[k] === "+" || source[k] === "-") k++;
      if (isDigit(source[k])) {
        k++;
        while (isDigit(source[k])) k++;
        j = k;
      }
    }
    return j;
  };

  while (i < n) {
    const c = source[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") {
      i++;
      continue;
    }
    const start = i;

    if (isDigit(c)) {
      i++;
      while (isDigit(source[i])) i++;
      if (source[i] === "." && isDigit(source[i + 1])) {
        i++;
        while (isDigit(source[i])) i++;
      }
      i = scanExponent(i);
      tokens.push({ type: "number", value: source.slice(start, i), pos: start });
      continue;
    }

    if (c === "." && isDigit(source[i + 1])) {
      i++;
      while (isDigit(source[i])) i++;
      i = scanExponent(i);
      tokens.push({ type: "number", value: source.slice(start, i), pos: start });
      continue;
    }

    if (isIdentStart(c)) {
      i++;
      while (isIdentPart(source[i])) i++;
      tokens.push({ type: "ident", value: source.slice(start, i), pos: start });
      continue;
    }

    if (SIMPLE_TOKENS.has(c)) {
      tokens.push({ type: c as TokenType, value: c, pos: start });
      i++;
      continue;
    }

    throw new ExpressionError(`unexpected character "${c}"`, start);
  }

  tokens.push({ type: "end", value: "", pos: n });
  return tokens;
}

type AstNode =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "var" }
  | { readonly kind: "const"; readonly value: number }
  | { readonly kind: "neg"; readonly arg: AstNode }
  | {
      readonly kind: "bin";
      readonly op: "+" | "-" | "*" | "/" | "^";
      readonly left: AstNode;
      readonly right: AstNode;
    }
  | { readonly kind: "call"; readonly name: string; readonly args: readonly AstNode[] };

/**
 * Recursive-descent parser. Grammar (lowest precedence first):
 *   expr   := term (('+'|'-') term)*
 *   term   := unary (('*'|'/') unary)*
 *   unary  := ('-'|'+') unary | power
 *   power  := primary ('^' unary)?              (right-assoc)
 *   primary := number | identifier | identifier '(' args ')' | '(' expr ')'
 */
class Parser {
  private pos = 0;
  private depth = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: TokenType, message: string): Token {
    const tok = this.peek();
    if (tok.type !== type) throw new ExpressionError(message, tok.pos);
    return this.advance();
  }

  /** Parses the whole token stream and confirms nothing is left over. */
  parseProgram(): AstNode {
    const node = this.parseExpr();
    const tok = this.peek();
    if (tok.type !== "end") {
      throw new ExpressionError(`unexpected token "${tok.value}"`, tok.pos);
    }
    return node;
  }

  private parseExpr(): AstNode {
    this.depth++;
    if (this.depth > MAX_NESTING_DEPTH) {
      throw new ExpressionError("expression nested too deeply", this.peek().pos);
    }
    let node = this.parseTerm();
    while (this.peek().type === "+" || this.peek().type === "-") {
      const op = this.advance().type as "+" | "-";
      const right = this.parseTerm();
      node = { kind: "bin", op, left: node, right };
    }
    this.depth--;
    return node;
  }

  private parseTerm(): AstNode {
    let node = this.parseUnary();
    while (this.peek().type === "*" || this.peek().type === "/") {
      const op = this.advance().type as "*" | "/";
      const right = this.parseUnary();
      node = { kind: "bin", op, left: node, right };
    }
    return node;
  }

  private parseUnary(): AstNode {
    const tok = this.peek();
    if (tok.type === "-" || tok.type === "+") {
      this.advance();
      const arg = this.parseUnary();
      return tok.type === "-" ? { kind: "neg", arg } : arg;
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    const base = this.parsePrimary();
    if (this.peek().type === "^") {
      this.advance();
      const exponent = this.parseUnary();
      return { kind: "bin", op: "^", left: base, right: exponent };
    }
    return base;
  }

  private parsePrimary(): AstNode {
    const tok = this.peek();

    if (tok.type === "number") {
      this.advance();
      return { kind: "num", value: Number(tok.value) };
    }

    if (tok.type === "(") {
      this.advance();
      const node = this.parseExpr();
      this.expect(")", "expected closing parenthesis");
      return node;
    }

    if (tok.type === "ident") {
      this.advance();
      const name = tok.value;

      if (this.peek().type === "(") {
        this.advance();
        const args: AstNode[] = [];
        if (this.peek().type !== (")" as TokenType)) {
          args.push(this.parseExpr());
          while (this.peek().type === ",") {
            this.advance();
            args.push(this.parseExpr());
          }
        }
        this.expect(")", "expected closing parenthesis");

        const entry = FUNCTIONS.get(name);
        if (!entry) throw new ExpressionError(`unknown function "${name}"`, tok.pos);
        if (entry.arity === "variadic") {
          if (args.length < 1) {
            throw new ExpressionError(`function "${name}" expects at least 1 argument`, tok.pos);
          }
        } else if (args.length !== entry.arity) {
          throw new ExpressionError(
            `function "${name}" expects ${entry.arity} argument(s), got ${args.length}`,
            tok.pos,
          );
        }
        return { kind: "call", name, args };
      }

      if (VARIABLES.has(name)) return { kind: "var" };
      if (CONSTANTS.has(name)) return { kind: "const", value: CONSTANTS.get(name)! };
      throw new ExpressionError(`unknown identifier "${name}"`, tok.pos);
    }

    throw new ExpressionError(
      tok.type === "end" ? "unexpected end of expression" : `unexpected token "${tok.value}"`,
      tok.pos,
    );
  }
}

/** Compiles an AST node into a closure `(t) => number`. Never throws at evaluation time. */
function compileNode(node: AstNode): (t: number) => number {
  switch (node.kind) {
    case "num": {
      const value = node.value;
      return () => value;
    }
    case "var":
      return (t: number) => t;
    case "const": {
      const value = node.value;
      return () => value;
    }
    case "neg": {
      const arg = compileNode(node.arg);
      return (t: number) => -arg(t);
    }
    case "bin": {
      const left = compileNode(node.left);
      const right = compileNode(node.right);
      const op = node.op;
      if (op === "+") return (t: number) => left(t) + right(t);
      if (op === "-") return (t: number) => left(t) - right(t);
      if (op === "*") return (t: number) => left(t) * right(t);
      if (op === "/") return (t: number) => left(t) / right(t);
      return (t: number) => Math.pow(left(t), right(t)); // op === "^"
    }
    case "call": {
      const entry = FUNCTIONS.get(node.name)!;
      const argFns = node.args.map(compileNode);
      const fn = entry.fn;
      return (t: number) => fn(...argFns.map((argFn) => argFn(t)));
    }
  }
}

/**
 * Compiles a motor-drive expression source string once into a
 * `CompiledExpression`. Throws `ExpressionError` for any parse/validation
 * failure; `evaluate` itself never throws (non-finite results, e.g. from
 * `1/0` or `sqrt(-1)`, are returned as-is — callers such as `drives.ts`
 * decide whether a non-finite value makes the motor invalid).
 */
export function compileExpression(source: string): CompiledExpression {
  if (source.trim().length === 0) {
    throw new ExpressionError("expression is empty", 0);
  }
  if (source.length > MAX_SOURCE_LENGTH) {
    throw new ExpressionError(
      `expression exceeds maximum length of ${MAX_SOURCE_LENGTH} characters`,
      0,
    );
  }

  const tokens = tokenize(source);
  const parser = new Parser(tokens);
  const ast = parser.parseProgram();
  const evaluateNode = compileNode(ast);

  return {
    source,
    evaluate(t: number): number {
      return evaluateNode(t);
    },
  };
}
