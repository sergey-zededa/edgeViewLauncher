# Testing the Electron to Tauri Auto-Updater

To test the auto-update from your old Electron-based version to the new Tauri-based version, you need to understand one key concept: **the app requesting the update is still the old Electron app**.

This means you must temporarily provide an update package that satisfies `electron-updater` (the library your old app uses), which expects a standard Electron release format, not a Tauri one.

Specifically, for macOS, `electron-updater` expects a `latest-mac.yml` file and a `.zip` file containing your `.app` bundle.

Here is the step-by-step guide to testing this locally before pushing anything to GitHub:

### Step 1: Build the New Tauri App
First, generate the release build of your new Tauri application.
\`\`\`bash
npm run build
\`\`\`
This will create a macOS `.app` bundle, typically located at:
\`src-tauri/target/release/bundle/macos/EdgeView Launcher.app\`

### Step 2: Create the Electron-Compatible Zip
`electron-updater` on macOS does not update from `.dmg` files; it downloads a `.zip`, extracts the `.app`, and swaps it with the running one.

Zip the Tauri `.app` bundle exactly as Electron expects it:
\`\`\`bash
cd "src-tauri/target/release/bundle/macos/"
ditto -c -k --sequesterRsrc --keepParent "EdgeView Launcher.app" EdgeViewLauncher-0.2.0-mac.zip
\`\`\`

### Step 3: Calculate the SHA512 Checksum
`electron-updater` verifies the integrity of the downloaded zip using a Base64-encoded SHA512 hash. Run this command to generate it:
\`\`\`bash
shasum -a 512 EdgeViewLauncher-0.2.0-mac.zip | cut -f1 -d' ' | xxd -r -p | base64
\`\`\`
*(Copy the output string, you will need it in the next step).*

### Step 4: Create the `latest-mac.yml` File
Create a new folder somewhere on your machine (e.g., `~/Desktop/update-server`) and move your `EdgeViewLauncher-0.2.0-mac.zip` into it.

In that same folder, create a file named `latest-mac.yml` with the following content:

\`\`\`yaml
version: 0.2.0
files:
  - url: EdgeViewLauncher-0.2.0-mac.zip
    sha512: <PASTE_YOUR_BASE64_HASH_HERE>
    size: <FILE_SIZE_IN_BYTES>
path: EdgeViewLauncher-0.2.0-mac.zip
sha512: <PASTE_YOUR_BASE64_HASH_HERE>
releaseDate: '2026-03-20T12:00:00.000Z'
\`\`\`
*(Make sure to replace the `sha512` fields with the string from Step 3, and the `size` field with the exact file size of the zip in bytes).*

### Step 5: Host the Files Locally
Open your terminal, navigate to the folder containing your zip and `latest-mac.yml`, and start a simple local HTTP server:
\`\`\`bash
cd ~/Desktop/update-server
python3 -m http.server 8080
\`\`\`
Your "fake" GitHub releases page is now running locally at `http://localhost:8080`.

### Step 6: Test with the Old Electron App
Now you need to run your **old** Electron version and point its updater to your local server instead of GitHub.

If you are running the old Electron code in development mode, find where `autoUpdater` is initialized in your `electron-main.js` (or similar) and temporarily override the feed URL:

\`\`\`javascript
const { autoUpdater } = require('electron-updater');

// Temporarily point to your local test server
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'http://localhost:8080'
});

autoUpdater.checkForUpdates();
\`\`\`

### What to look for:
1. The old Electron app should hit `http://localhost:8080/latest-mac.yml`. (You will see the request in your Python server terminal).
2. It should recognize version `0.2.0` as newer than its current version.
3. It will download the `.zip` file, verify the SHA512 hash, and prompt to restart/install.
4. Upon restart, macOS will launch the **Tauri** version of the app.

### ⚠️ Critical Warning for Production:
When you eventually do this for real on GitHub, you must upload **both** the Tauri `.dmg`/`.tar.gz` artifacts (for future Tauri-to-Tauri updates) **AND** the manually zipped `.app` + `latest-mac.yml` (so the existing Electron users can bridge over to Tauri).

Also, macOS will completely block the update if the **Code Signing Certificate** or the **Bundle Identifier** (`com.edgeview.launcher`) of the new Tauri app doesn't perfectly match the old Electron app. Make sure your local test environments match production as closely as possible!
