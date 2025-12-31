# Flaim Chrome Extension

Automatically sync your ESPN fantasy credentials to Flaim.

## Development

```bash
# Install dependencies
cd extension
npm install

# Build the extension
npm run build

# Development mode (with hot reload)
npm run dev
```

## Loading the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/dist` folder

## Testing

1. Make sure the Flaim dev server is running (`npm run dev` from project root)
2. Load the extension in Chrome
3. Generate a pairing code at `http://localhost:3000/extension`
4. Click the extension icon and enter the code
5. Log into ESPN.com
6. Click "Sync to Flaim" in the extension

## Icons

The extension requires icons in the following sizes:
- 16x16 (toolbar)
- 48x48 (extensions page)
- 128x128 (Chrome Web Store)

Place PNG files in `assets/icons/`:
- `icon-16.png`
- `icon-48.png`
- `icon-128.png`

## Publishing

See the Chrome Extension plan document at `docs/dev/CHROME_EXTENSION_PLAN.md` for Chrome Web Store submission requirements.
