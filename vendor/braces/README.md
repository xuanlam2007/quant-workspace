Local security patch of MIT-licensed micromatch/braces 3.0.3 for GHSA-vfj7-8cjw-p6xm. Upstream has no published fixed version as of 2026-10-10.

The parser rejects nesting beyond 64 stack entries, including parentheses and unclosed groups. Compile, expand and stringify also cap walker depth for caller-supplied ASTs, including cyclic input. The upstream debug log in compile was removed. Normal expansion, escaping and ranges retain upstream behavior. The npm override uses this local package; this is a maintained mitigation, not an upstream release or an ignored advisory.

Run `node --test vendor/braces/security.test.cjs` for the depth-limit and compatibility regressions. Replace this override with an upstream patched release when available, after those checks pass. LICENSE preserves upstream attribution.
