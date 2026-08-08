# clang-ast-to-graph

Paste C++ source, get an interactive diagram of its Clang AST.

Open `index.html` in a browser. That's the whole install — one self-contained
file with no build step and no dependencies.

![the tool rendering the AST of a small function](docs/screenshot.png)

## How it works

The page sends your source to [Compiler Explorer](https://godbolt.org)'s public API,
which compiles it and returns the AST dump. The page parses that text and lays it out
as a tidy tree.

It uses CE's `produceAst` backend option rather than passing `-Xclang -ast-dump` as a
compiler flag. The raw flag dumps the *entire* translation unit (e.g. `#include <string>`
alone produces ~54,000 lines), so the server truncates the response and your own code
gets cut off. `produceAst` scopes the dump to your code.

## Privacy

Your source is sent to godbolt.org to be compiled. The page requests
`allowStoreCodeDebug: false` so the code is not stored for sharing. There is no
local-compile mode.

## Usage

- **Compiler** — clang only (AST dump format is clang-specific). Defaults to clang 22.1.0.
- **Extra flags** — passed as `userArguments`, e.g. `-std=c++20`.
- **Comments** — on by default; sends `-fparse-all-comments` so comments adjacent to a
  declaration show up as nodes. Uncheck to keep only doc comments (`///`, `/** */`).
  Comments in statement position are always discarded by clang.
- **Click a node** for its source range, types, attributes, and the verbatim dump line.
- **Click a `+N` / `−` badge** to collapse or expand a subtree.
- **Drag** to pan, **scroll** to zoom, or use the **+** / **−** buttons.
  **Fit** frames the whole tree, **Reset** returns to 100%.
- **SVG / PNG** export the current tree. PNG is capped at 16,384px.

Node colors follow the AST class: Decl, Stmt, Expr, Type, Attr, Template, and a muted
"pseudo" style for synthetic lines (`<<<NULL>>>`, base specifiers, `DefinitionData`, etc.).

## Development

```
node tools/check-parser.mjs                        # parser test suite
some-dump | node tools/check-parser.mjs --stdin    # assert every line becomes a node
```

The parser lives inside `index.html` between the `PARSER_START` / `PARSER_END` markers;
the test runner extracts and evaluates that block, so there is no second copy to drift.

`samples/` holds fixtures generated from real clang output:

| file | covers |
|---|---|
| `expected-ast.txt` | golden `produceAst` output for `samples/sample.cpp` |
| `edge-cases.txt` | `<<<NULL>>>` placeholders, `'<<='` operators, shift expressions |
| `forest.txt` | multi-root `Dumping x:` blocks, `public`/`private` bases, `Overrides:` |
| `comments.txt` | doc-comment nodes with hostile text (quotes, angles, apostrophes) |

### Re-vendoring d3-hierarchy

`d3-hierarchy` 3.1.2 (ISC, 14.8 KB minified) is inlined in `index.html` for
`d3.tree()`'s Buchheim tidy layout; `vendor/` keeps the original copy. To update:

```
npm pack d3-hierarchy@3.1.2 && tar xzf d3-hierarchy-3.1.2.tgz
cp package/dist/d3-hierarchy.min.js vendor/
```

Then replace the fenced vendored block in `index.html` with the new file's contents,
keeping the ISC notice in the banner above it.

## License

MIT — see [`LICENSE`](LICENSE).

The bundled copy of `d3-hierarchy` is ISC licensed; its full notice is in
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) and in the vendored block of
`index.html`.
