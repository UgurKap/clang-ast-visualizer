#!/usr/bin/env node
/**
 * Parser tests for index.html.
 *
 * The parser lives inside index.html (single-file constraint), so this extracts
 * the block between the PARSER_START / PARSER_END markers and evaluates it.
 * That keeps one source of truth — there is no copy to drift out of sync.
 *
 *   node tools/check-parser.mjs            run the suite
 *   ... | node tools/check-parser.mjs --stdin   sanity-check an arbitrary dump
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadParser() {
  const html = readFileSync(join(root, "index.html"), "utf8");
  const s = html.indexOf("PARSER_START");
  const e = html.indexOf("/* PARSER_END");
  if (s < 0 || e < 0) throw new Error("PARSER_START/PARSER_END markers not found in index.html");
  const code = html.slice(html.indexOf("*/", s) + 2, e);
  return new Function(
    code + "\nreturn { parseAst, parseBody, tokenizeBody, primaryLabel, family, countNodes, isLocationToken };"
  )();
}

const P = loadParser();
const read = f => readFileSync(join(root, "samples", f), "utf8");

let passed = 0;
const failures = [];
function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push(`${name}\n    ${err.message}`);
  }
}
function eq(actual, expected, what = "value") {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${what}: expected ${b}, got ${a}`);
}
function ok(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------------------------------------------------------------- stdin mode */
if (process.argv.includes("--stdin")) {
  const text = readFileSync(0, "utf8");
  const root_ = P.parseAst(text);
  if (!root_) { console.error("no nodes parsed"); process.exit(1); }

  const eligible = text.split("\n").filter(l =>
    l.trim() && !/^Dumping [^:]*:\s*$/.test(l) && l.trim() !== "[Truncated]"
  ).length;
  const parsed = P.countNodes(root_) - (root_.synthetic ? 1 : 0);

  console.log(`lines eligible: ${eligible}`);
  console.log(`nodes parsed  : ${parsed}`);
  if (parsed !== eligible) {
    console.error(`FAIL: ${eligible - parsed} line(s) did not become nodes`);
    process.exit(1);
  }
  console.log("OK — every line became exactly one node");
  process.exit(0);
}

/* ------------------------------------------------------------ tokenizer units */

check("tokenizer: nested brackets inside a quoted function-pointer type", () => {
  const body = `ImplicitCastExpr <col:18> 'basic_string<char, std::char_traits<char>, std::allocator<char>> (*)(const basic_string<char> &, const basic_string<char> &)' <FunctionToPointerDecay>`;
  const n = P.parseBody(body, body);
  eq(n.kind, "ImplicitCastExpr", "kind");
  eq(n.range, "<col:18>", "range");
  eq(n.quoted.length, 1, "quoted count");
  ok(n.quoted[0].includes("(*)("), "function-pointer type kept intact");
  ok(n.rest.some(a => a.t === "angle" && a.v === "<FunctionToPointerDecay>"),
     "cast kind kept as a separate angle atom");
});

check("tokenizer: '<<' operator is not mistaken for a bracket", () => {
  const body = `BinaryOperator 0x1 <col:6, col:45> 'int' '<<'`;
  const n = P.parseBody(body, body);
  eq(n.range, "<col:6, col:45>", "range");
  eq(n.quoted, ["int", "<<"], "quoted atoms");
  eq(P.primaryLabel(n), "<<", "label");
});

check("tokenizer: <<invalid sloc>> range with nested angles", () => {
  const body = `TranslationUnitDecl 0x368dc958 <<invalid sloc>> <invalid sloc>`;
  const n = P.parseBody(body, body);
  eq(n.id, "0x368dc958", "address");
  eq(n.range, "<<invalid sloc>>", "range");
});

check("tokenizer: ComputeLHSTy='int' stays one atom", () => {
  const body = `CompoundAssignOperator 0x1 <col:52, col:58> 'int' lvalue '<<=' ComputeLHSTy='int' ComputeResultTy='int'`;
  const n = P.parseBody(body, body);
  eq(P.primaryLabel(n), "<<=", "label");
  ok(n.bare.includes("ComputeLHSTy='int'"), "key='value' bare token preserved");
});

check("tokenizer: parenthesised trailing attributes", () => {
  const a = `CXXBindTemporaryExpr <col:16, col:20> 'string' (CXXTemporary 0x448d7e48)`;
  const na = P.parseBody(a, a);
  ok(na.rest.some(x => x.t === "paren" && x.v.startsWith("(CXXTemporary")), "CXXTemporary group");

  const b = `ReturnStmt <line:6:5, col:12> nrvo_candidate(Var 0x448d5bc0 'c' 'string')`;
  const nb = P.parseBody(b, b);
  ok(nb.bare.includes("nrvo_candidate"), "word split from its paren group");
  ok(nb.rest.some(x => x.t === "paren"), "paren group captured");
});

check("tokenizer: sugared 'a':'b' types split into two quoted atoms", () => {
  const body = `DeclRefExpr <col:16> 'string':'std::basic_string<char>' lvalue ParmVar 0x448d5930 'a' 'string':'std::basic_string<char>'`;
  const n = P.parseBody(body, body);
  eq(n.quoted, ["string", "std::basic_string<char>", "a", "string", "std::basic_string<char>"],
     "quoted atoms");
  // The `:'...'` tail must not leak into bare tokens, or it shows up as an "attribute".
  eq(n.bare, ["lvalue", "ParmVar", "0x448d5930"], "bare atoms stay clean");
  eq(P.primaryLabel(n), "a", "label is the referenced name");
});

check("parser: node address is optional (produceAst strips it)", () => {
  const body = `FunctionDecl <line:4:1, line:7:1> line:4:8 str_concat 'string (string, string)'`;
  const n = P.parseBody(body, body);
  eq(n.id, null, "no address");
  eq(n.range, "<line:4:1, line:7:1>", "range still found");
  eq(P.primaryLabel(n), "str_concat", "name");
});

/* ------------------------------------------------- trivia: comments & spacing */

check("trivia: Text=\"<angle\" does not open a bracket group", () => {
  // A doc comment containing '<' produces an unbalanced angle inside a
  // DOUBLE-quoted payload. Single-quote-only tracking mis-parses this.
  const body = `TextComment <col:29, col:34> Text="<angle"`;
  const n = P.parseBody(body, body);
  eq(n.kind, "TextComment", "kind");
  eq(n.range, "<col:29, col:34>", "range is the real source range");
  eq(n.bare, ['Text="<angle"'], "Text payload stays one atom");
  ok(!n.rest.some(a => a.t === "angle"), "no spurious angle group");
  eq(P.primaryLabel(n), "<angle", "label is the comment text");
});

check("trivia: comment text containing quotes and '>'", () => {
  const body = `TextComment <col:35, col:49> Text="> and 'quotes'."`;
  const n = P.parseBody(body, body);
  eq(n.bare, [`Text="> and 'quotes'."`], "payload intact");
  eq(P.primaryLabel(n), "> and 'quotes'.", "label");
});

check("trivia: an odd number of apostrophes does not desync the tokenizer", () => {
  const body = `TextComment <col:3, col:20> Text=" don't break"`;
  const n = P.parseBody(body, body);
  eq(n.range, "<col:3, col:20>", "range still parsed");
  eq(n.bare.length, 1, "single payload atom");
});

check("trivia: comment nodes get their own family", () => {
  for (const k of ["FullComment", "ParagraphComment", "TextComment",
                   "ParamCommandComment", "BlockCommandComment"]) {
    eq(P.family(k), "comment", `family(${k})`);
  }
  const pc = P.parseBody(
    `ParamCommandComment <col:4, col:21> [in] implicitly Param="x" ParamIndex=0`, "");
  eq(P.primaryLabel(pc), "x", "ParamCommandComment shows the parameter");
});

check("trivia: a commented function still parses to the right tree", () => {
  const dump = [
    `TranslationUnitDecl`,
    "`-FunctionDecl <line:5:1, line:8:1> line:5:5 documented 'int (int)'",
    `  |-ParmVarDecl <col:16, col:20> col:20 used x 'int'`,
    `  |-CompoundStmt <col:23, line:8:1>`,
    `  \`-FullComment <line:2:3, line:3:21>`,
    `    |-ParagraphComment <line:2:3, line:3:3>`,
    `    | \`-TextComment <line:2:3, col:28> Text=" Doxygen doc comment with "`,
    `    \`-ParamCommandComment <col:4, col:21> [in] implicitly Param="x" ParamIndex=0`,
  ].join("\n");
  const root_ = P.parseAst(dump);
  eq(P.countNodes(root_), 8, "node count");
  const fn = root_.children[0];
  eq(fn.children.map(c => c.kind),
     ["ParmVarDecl", "CompoundStmt", "FullComment"], "comment is a sibling of the body");
  const full = fn.children[2];
  eq(full.children.map(c => c.kind),
     ["ParagraphComment", "ParamCommandComment"], "comment subtree intact");
});

check("trivia: real doc-comment dump (samples/comments.txt)", () => {
  const root_ = P.parseAst(read("comments.txt"));
  eq(root_.kind, "FunctionDecl", "root kind");
  eq(root_.title, "documented", "Dumping title");
  eq(root_.children.map(c => c.kind),
     ["ParmVarDecl", "CompoundStmt", "FullComment"], "top-level children");

  const kinds = [];
  (function walk(n) { kinds.push(n.kind); (n.children || []).forEach(walk); })(root_);
  eq(kinds.filter(k => k === "TextComment").length, 5, "TextComment count");

  // The worst real line: '>' plus nested unescaped double quotes plus an apostrophe.
  const nasty = [];
  (function walk(n) {
    if (/Text="> and/.test(n.raw || "")) nasty.push(n);
    (n.children || []).forEach(walk);
  })(root_);
  eq(nasty.length, 1, "found the pathological TextComment");
  const t = nasty[0];
  eq(t.range, "<col:20, col:57>", "range not swallowed by the '>' in the text");
  eq(t.rest.filter(a => a.t === "angle").length, 0, "no spurious angle group");
  eq(P.primaryLabel(t), `> and 'quotes' and "doubles" and don't`, "full text recovered");
});

check("trivia: CRLF line endings and trailing whitespace", () => {
  const dump = "TranslationUnitDecl\r\n" +
               "`-FunctionDecl <line:1:1> line:1:5 f 'int ()'  \r\n";
  const root_ = P.parseAst(dump);
  eq(root_.kind, "TranslationUnitDecl", "root parsed despite CR");
  eq(root_.children.length, 1, "child attached");
  eq(root_.children[0].kind, "FunctionDecl", "child kind has no stray \\r");
  eq(P.primaryLabel(root_.children[0]), "f", "trailing spaces ignored");
  ok(!JSON.stringify(root_).includes("\\r"), "no carriage return survives into the tree");
});

check("trivia: blank lines, and a source that is only comments", () => {
  eq(P.parseAst(""), null, "empty input yields no tree");
  eq(P.parseAst("   \n\t\n  "), null, "whitespace-only input yields no tree");

  // Comment-only source compiles fine and returns a bare root.
  const lone = P.parseAst("TranslationUnitDecl\n");
  eq(lone.kind, "TranslationUnitDecl", "lone root kind");
  eq(lone.children.length, 0, "no children");
  eq(P.countNodes(lone), 1, "single node");
});

/* --------------------------------------------------------------- golden tree */

check("golden: the user's sample parses to the expected tree", () => {
  const root_ = P.parseAst(read("expected-ast.txt"));
  eq(root_.kind, "TranslationUnitDecl", "root kind");
  eq(P.countNodes(root_), 21, "total nodes");
  eq(root_.children.map(c => c.kind),
     ["UsingDirectiveDecl", "FunctionDecl"], "root children");

  const fn = root_.children[1];
  eq(P.primaryLabel(fn), "str_concat", "function name");
  eq(fn.children.map(c => c.kind),
     ["ParmVarDecl", "ParmVarDecl", "CompoundStmt"], "function children");
  eq(fn.children.slice(0, 2).map(P.primaryLabel), ["a", "b"], "parameter names");

  const compound = fn.children[2];
  eq(compound.children.map(c => c.kind), ["DeclStmt", "ReturnStmt"], "body children");

  const varDecl = compound.children[0].children[0];
  eq(varDecl.kind, "VarDecl", "VarDecl kind");
  eq(P.primaryLabel(varDecl), "c", "variable name");

  // Deep chain: ExprWithCleanups > CXXBindTemporaryExpr > CXXOperatorCallExpr
  const call = varDecl.children[0].children[0].children[0];
  eq(call.kind, "CXXOperatorCallExpr", "operator call kind");
  eq(P.primaryLabel(call), "+", "operator spelling");

  // DeclRefExpr must show the referenced name, not its type.
  const declRef = call.children[1].children[0];
  eq(declRef.kind, "DeclRefExpr", "DeclRefExpr kind");
  eq(P.primaryLabel(declRef), "a", "referenced parameter name");

  // A node whose only payload is a type shows the type, not the (CXXTemporary 0x..) group.
  const bindTemp = varDecl.children[0].children[0];
  eq(bindTemp.kind, "CXXBindTemporaryExpr", "CXXBindTemporaryExpr kind");
  ok(P.primaryLabel(bindTemp).startsWith("basic_string<"),
     `expected the type, got ${JSON.stringify(P.primaryLabel(bindTemp))}`);

  // Overrides: has no quoted atoms, so it still falls back to its bracket payload.
  const ov = P.parseBody("Overrides: [ 0x1 BaseA::run 'void ()' ]", "");
  ok(P.primaryLabel(ov).includes("BaseA::run"), "Overrides: payload used as label");
});

check("golden: every line round-trips into raw", () => {
  const text = read("expected-ast.txt");
  const lines = text.split("\n").filter(l => l.trim());
  const seen = [];
  (function walk(n) { seen.push(n.raw); (n.children || []).forEach(walk); })(P.parseAst(text));
  eq(seen.length, lines.length, "node count vs line count");
  eq(new Set(seen).size, new Set(lines).size, "distinct raw lines preserved");
});

/* ----------------------------------------------------------- edge-case tree */

check("edge cases: <<<NULL>>> placeholders and depth assignment", () => {
  const root_ = P.parseAst(read("edge-cases.txt"));
  eq(root_.kind, "FunctionDecl", "root kind");

  const nulls = [];
  (function walk(n) {
    if (n.kind === "<<<NULL>>>") nulls.push(n);
    (n.children || []).forEach(walk);
  })(root_);
  eq(nulls.length, 2, "two NULL children");
  eq(P.family("<<<NULL>>>"), "pseudo", "NULL is a pseudo node");
  eq(P.primaryLabel(nulls[0]), "", "NULL has no label");

  const forStmt = root_.children[1].children[1];
  eq(forStmt.kind, "ForStmt", "ForStmt located");
  eq(forStmt.children.map(c => c.kind),
     ["<<<NULL>>>", "<<<NULL>>>", "BinaryOperator", "UnaryOperator", "CompoundStmt"],
     "ForStmt children in order");
});

/* ------------------------------------------------------------- forest shape */

check("forest: multiple roots join under a synthetic node", () => {
  const root_ = P.parseAst(read("forest.txt"));
  ok(root_.synthetic, "synthetic root created");
  eq(root_.children.length, 2, "two roots");
  eq(root_.children.map(c => c.kind), ["CXXRecordDecl", "FunctionDecl"], "root kinds");
  eq(root_.children.map(c => c.title), ["Derived", "freefn"], "Dumping titles captured");
});

check("forest: base specifiers and Overrides: are pseudo nodes", () => {
  const root_ = P.parseAst(read("forest.txt"));
  const derived = root_.children[0];

  const bases = derived.children.filter(c => c.kind === "public" || c.kind === "private");
  eq(bases.map(c => c.kind), ["public", "private"], "base specifier kinds");
  eq(bases.map(P.primaryLabel), ["BaseA", "BaseB"], "base class names");
  eq(bases.map(c => P.family(c.kind)), ["pseudo", "pseudo"], "classified as pseudo");

  const overrides = [];
  (function walk(n) {
    if (n.kind === "Overrides:") overrides.push(n);
    (n.children || []).forEach(walk);
  })(derived);
  eq(overrides.length, 2, "two Overrides: nodes");
  ok(overrides[0].raw.includes("BaseA::run"), "square-bracket payload retained in raw");

  const defData = derived.children.find(c => c.kind === "DefinitionData");
  ok(defData, "DefinitionData present");
  eq(P.family("DefinitionData"), "pseudo", "DefinitionData is pseudo");
  eq(defData.children.length, 6, "DefinitionData children");
});

/* ------------------------------------------------------------ classification */

check("classification: families map as documented", () => {
  const cases = {
    FunctionDecl: "decl", ParmVarDecl: "decl", CXXRecordDecl: "decl",
    CompoundStmt: "stmt", ReturnStmt: "stmt", ForStmt: "stmt",
    ImplicitCastExpr: "expr", IntegerLiteral: "expr", BinaryOperator: "expr",
    BuiltinType: "type", PointerType: "type",
    OverrideAttr: "attr", VisibilityAttr: "attr",
    TemplateArgument: "pseudo", ClassTemplateSpecialization: "template",
    "<<<NULL>>>": "pseudo", public: "pseudo", DefinitionData: "pseudo",
  };
  for (const [kind, want] of Object.entries(cases)) {
    eq(P.family(kind), want, `family(${kind})`);
  }
});

/* --------------------------------------------------------------------- report */

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.error("  FAIL  " + f);
  process.exit(1);
}
