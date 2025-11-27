# How to Rebuild EdgeView Launcher

## Quick Rebuild (Development)

```bash
cd /Users/sseper/Desktop/Projects/edgeViewLauncher
go build -o edgeview-backend
```

**Important**: The binary name **must be** `edgeview-backend` (not `edgeViewLauncher`) because that's what `electron-main.js` looks for.

## After Rebuilding

1. **Kill the running app** completely (Cmd+Q or quit from menu bar)
2. **Restart the app** - it will automatically start the new `edgeview-backend` binary
3. The new changes will be active

## Verify Changes

Check the console logs:
- **Old version**: Shows verbose packet logs like `DEBUG: [WS->TCP] Writing 112 bytes (response #206, preview: 48545454...)`
- **New version**: Silent data transfer, only connection start/end logs

## What Gets Built

- **Development**: `edgeview-backend` in the project root (used by Electron in dev mode)
- **Production**: Backend gets packaged into the Electron app bundle

## Common Issues

**"Still seeing old logs after restart"**
- Make sure you ran: `go build -o edgeview-backend` (not `-o edgeViewLauncher`)
- Completely quit the app (not just close window)
- Check `ls -lah edgeview-backend` - should show recent timestamp

**"Backend won't start"**
- Check `electron-main.js` logs for the path it's trying to use
- In dev mode it looks for: `<project-root>/edgeview-backend`
