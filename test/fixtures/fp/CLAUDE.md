# FP regression fixture

Every reference in this file is a KNOWN false-positive class. driftlint must stay silent.

We use `Next.js` and deploy with Docker. Build with `npm run build`.

Project layout:

```
src/
├── page/
├── types/
└── utils/
```

Settings live in `settings.local.json` and `app.local.yaml`.
Scaffold new inputs as `internal/impl/foo/input.go`, tests as `src/path/to/test.test.ts`.
Build output goes to `dist/` and `builddir/`.
Mappings use the `.csx` extension. LINQ chains like `items.Where(x => x.Id)` reference `x.Id` and `InstanceTransition.Body`.
Versions `1.2.3` and `v2.0.1` are tags; `console.log` is an API, not a file.

<!-- driftlint-ignore -->
`docs/never-existed.md` is referenced on purpose under an ignore marker.
