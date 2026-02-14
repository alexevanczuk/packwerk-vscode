# Development

## Git workflow
- All work should be done on a new branch off of a fresh `main` branch
- Create branches with the format `ae-<descriptive-name>`

## Building
- After every change, bump the version in `package.json` and compile a new `.vsix` for local install: `npx vsce package --no-yarn`
- Run `npx tsc --noEmit` to type check before committing
- Delete old `.vsix` files when creating new ones (only keep the latest)
- To install the latest vsix: `./scripts/install`
