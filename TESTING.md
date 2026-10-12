# Testing Gripflow locally

Run everything from the repository root. On Windows PowerShell use `npm.cmd`.

```bash
npm install
npm run typecheck          # strict TypeScript across all packages
npm test                   # unit + React (jsdom) tests for every package
npm run build              # core, react, tree, kanban, presets, nestjs-adapter
npm run verify:packages    # exports exist, no undeclared imports, "use client" only on React bundles
npm run pack:all           # -> artifacts/tarballs/gripflow-*-0.1.0.tgz (exactly what npm would ship)
```

## Trying the tarballs in your own app

The tarballs depend on each other by exact version, so install them together and add `overrides`:

```json
{
  "dependencies": {
    "@gripflow/react": "file:../Gripflow/artifacts/tarballs/gripflow-react-0.1.0.tgz"
  },
  "overrides": {
    "@gripflow/core": "file:../Gripflow/artifacts/tarballs/gripflow-core-0.1.0.tgz"
  }
}
```

Once the packages are on npm this is simply `npm i @gripflow/react`.

> The Next.js demo app and its Playwright e2e suite were removed on request. The package
> `repository.url` is still a placeholder (`REPLACE-ME`); replace it before publishing.
