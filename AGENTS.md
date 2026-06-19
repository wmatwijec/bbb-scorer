cat > AGENTS.md << 'EOF'
# AGENTS.md - bbb-scorer PWA

Simple vanilla JavaScript Progressive Web App.  
No build tools, no package.json, no framework.

### Core Files
- `index.html` — Main entry point **and** contains all application logic and UI (monolithic)
- `app-v23.js` — No longer used for logic (kept only if referenced; most code moved into index.html)
- `sw.js` — Service Worker for offline support and caching
- `manifest.json` — PWA install metadata and icons

### Critical Constraints (agents frequently get these wrong)
- No Node.js / npm — open via local HTTP server only. `file://` protocol breaks the Service Worker.
- `sw.js` must remain in the project root.
- After editing `sw.js`:
  1. DevTools → Application → Service Workers → **Unregister**
  2. Hard refresh (`Ctrl + Shift + R` or `Ctrl + F5`)
- Major changes: Update script references in `index.html` and consider renaming JS files for cache busting.

### Local Development Commands
```bash
npx serve .                  # Recommended for testing SW
# or
python3 -m http.server 8080

xdg-open http://localhost:8080