# Pks for Visual Studio Code

A VS Code extension for [pks](https://github.com/alexevanczuk/packs), a tool for modularizing large Rails monoliths.

## Installation

Install from [Open VSX](https://open-vsx.org/extension/alexevanczuk/pks-vscode):

```bash
# VS Code
code --install-extension alexevanczuk.pks-vscode

# Cursor
cursor --install-extension alexevanczuk.pks-vscode
```

## Features

- **Automatic violation checking** - runs `pks check` on save
- **Code actions** for violations:
  - Add missing dependency to package.yml
  - Make constant public with `# pack_public: true`
  - Add violations to package_todo.yml (per-file, per-pack, or all)
- **Commands** (via Command Palette):
  - `Pks: Run pks check (all files)`
  - `Pks: Go to package.yml` - jump to the package.yml for the current file
  - `Pks: Toggle highlight violations` - highlight all violations including those in package_todo.yml
  - `Pks: Refresh constant definitions`
- **Clickable links** in package.yml (dependencies) and package_todo.yml (constants)

## Configuration

Configure in VS Code settings (`settings.json`):

```json
{
  "ruby.pks.executable": "pks check",
  "ruby.pks.onSave": true
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `ruby.pks.executable` | `pks check` | Base command for pks check |
| `ruby.pks.onSave` | `true` | Run pks check on save |

## License

MIT License - see [LICENSE.txt](LICENSE.txt).

## Kudos

Thanks to https://github.com/misogi/vscode-ruby-rubocop which this was modeled off of.
