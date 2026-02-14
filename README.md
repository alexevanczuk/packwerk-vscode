# Pks for Visual Studio Code

This extension provides an interface to pks for vscode.

[pks](https://github.com/alexevanczuk/packs) helps modularize large Rails monoliths

## Installation

### VS Code
Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=alexevanczuk.pks-vscode)

### Cursor
Install from the [Open VSX Registry](https://open-vsx.org/extension/alexevanczuk/pks-vscode):
```bash
cursor --install-extension alexevanczuk.pks-vscode
```

![exec on save](./images/pksvscode.gif)

## Stability

This is an alpha extension that is not guaranteed to work. We encourage you to experiment with it and provide feedback!

## Configuration

Specify configuration (via navigating to `File > Preferences > Workspace Settings` and editing file `settings.json):`

```javascript
{
  // If not specified, uses `pks check` (default)
  // You may want to change this if, for example, you have a remote development environment that executes pks in a remote box.
  "ruby.pks.executable": "",

  // default true
  "ruby.pks.onSave": true
}
```

# Development

## Setup

Please install packages with yarn:

```bash
yarn install
```

You could install TSLint extension for .ts files.

Please format code using prettier:

```bash
yarn prettier src/* test/* --write
```

## Building and Testing Locally

To build and test the extension locally in VSCode:

1. **Build the extension:**
   ```bash
   yarn run compile
   ```

2. **Install the extension locally:**
   - Open VSCode
   - Press `F5` to open a new Extension Development Host window with the extension loaded
   - Alternatively, package and install manually:
     ```bash
     # Install vsce if you don't have it
     npm install -g vsce

     # Package the extension
     vsce package

     # This creates a .vsix file (e.g., pks-vscode-0.0.5.vsix)
     # Install it via VSCode:
     # - Open VSCode
     # - Go to Extensions (Cmd+Shift+X)
     # - Click "..." menu → "Install from VSIX..."
     # - Select the .vsix file
     ```

3. **Test the extension:**
   - Open a Ruby project with pks configured
   - Open a Ruby file with pks violations
   - You should see code actions (lightbulb icon) on violation lines:
     - "Make constant public with # pack_public: true" for privacy violations
     - "Add dependency from X to Y" for dependency violations
     - "Run pks update" to update package_todo.yml files

## Publishing

This extension is published to both the VS Code Marketplace and Open VSX Registry (for Cursor compatibility).

### Publishing to VS Code Marketplace

```bash
# Install vsce if you don't have it
npm install -g vsce

# Publish (requires VS Code Marketplace token)
vsce publish
```

### Publishing to Open VSX Registry

```bash
# Install ovsx if you don't have it
npm install -g ovsx

# Create namespace (first time only, after signing Publisher Agreement)
ovsx create-namespace alexevanczuk -p YOUR_OPENVSX_TOKEN

# Publish to Open VSX
ovsx publish -p YOUR_OPENVSX_TOKEN
```

**Note:** You must sign the Eclipse Foundation Publisher Agreement at https://open-vsx.org/user-settings/extensions before publishing to Open VSX.

# License

This software is released under the MIT License, see [LICENSE.txt](LICENSE.txt).

# Kudos

Thanks to https://github.com/misogi/vscode-ruby-rubocop which this was modeled off of.
