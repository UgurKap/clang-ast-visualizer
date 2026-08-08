# Third-party notices

This project is MIT licensed (see `LICENSE`). It bundles one third-party component,
listed below with its full license text as required by that license.

---

## d3-hierarchy 3.1.2

- **License:** ISC
- **Copyright:** 2010-2021 Mike Bostock
- **Homepage:** https://github.com/d3/d3-hierarchy
- **Used for:** `d3.tree()` / `d3.hierarchy()` — the Buchheim tidy-tree layout.
- **Where it lives:** the minified UMD build is inlined into `index.html` inside a fenced
  `<script>` block, and the original file is kept at `vendor/d3-hierarchy.min.js`.
  Because `index.html` contains a copy of the software, the notice below is reproduced in
  that file as well.

```
Copyright 2010-2021 Mike Bostock

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

---

## Not bundled

For the avoidance of doubt, these are used but impose no bundling obligation:

- **Compiler Explorer (godbolt.org)** — called at runtime over its public HTTP API. No
  Compiler Explorer code ships with this project. See https://github.com/compiler-explorer/compiler-explorer.
- **Clang / LLVM** — runs on Compiler Explorer's servers, not here. Its output (AST dumps)
  is data returned by that service.
- **Node.js and Python** — used only to run the test suite and a local static server
  during development; neither is redistributed.

The `samples/*.txt` fixtures are output produced by clang from `samples/*.cpp`, which are
short original snippets written for this project.
