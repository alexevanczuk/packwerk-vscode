# Development

- After every change, bump the version in `package.json` and compile a new `.vsix` for local install: `npx vsce package`
- Run `npx tsc --noEmit` to type check before committing
