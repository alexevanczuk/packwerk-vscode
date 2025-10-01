# Packwerk for Visual Studio Code

This extension provides an interface to packwerk for vscode.

[packwerk](https://github.com/Shopify/packwerk/) helps modularize large Rails monoliths

[packwerk-vscode in Code Market Place](https://marketplace.visualstudio.com/items?itemName=Gusto.packwerk-vscode)

![exec on save](./images/packwerkvscode.gif)

## Stability

This is an alpha extension that is not guaranteed to work. We encourage you to experiment with it and provide feedback!

## Configuration

Specify configuration (via navigating to `File > Preferences > Workspace Settings` and editing file `settings.json):`

```javascript
{
  // If not specified, uses `bin/packwerk check` (default and recommended, as this is what the packwerk setup guide recommends for executing packwerk)
  // You may want to change this if, for example, you have a remote development environment that executes packwerk in a remote box.
  "ruby.packwerk.executable": "",

  // default true
  "ruby.packwerk.onSave": true
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

     # This creates a .vsix file (e.g., packwerk-vscode-0.0.5.vsix)
     # Install it via VSCode:
     # - Open VSCode
     # - Go to Extensions (Cmd+Shift+X)
     # - Click "..." menu → "Install from VSIX..."
     # - Select the .vsix file
     ```

3. **Test the extension:**
   - Open a Ruby project with packwerk/packs configured
   - Open a Ruby file with packwerk violations
   - You should see code actions (lightbulb icon) on violation lines:
     - "Make constant public with # pack_public: true" for privacy violations
     - "Add dependency from X to Y" for dependency violations
     - "Run pks update" to update package_todo.yml files

# License

This software is released under the MIT License, see [LICENSE.txt](LICENSE.txt).

# Kudos

Thanks to https://github.com/misogi/vscode-ruby-rubocop which this was modeled off of.
