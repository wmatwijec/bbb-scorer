App Deployment & Update WorkflowOverview  Frontend: Hosted on Cloudflare Pages (auto-deploys on push)  

Backend: pwa-players-backend repository hosted on Render.com (handles database for active golf rounds during play and final completed rounds)  
Main Repository: This repository (frontend code)  
Local Development: VS Code + GitHub Desktop on POP!_OS

Update WorkflowMake changes  Open the correct repository in VS Code:  Main frontend repo for UI/app changes  
pwa-players-backend repo for server/database changes

Edit code (Auto Save is enabled).

Work on a feature branch (strongly recommended for any significant changes)  Create a new branch in the repository you are updating (e.g. feature/persistence-updates).  
This protects the stable main branch used for live golf rounds.

Commit changes  In VS Code Source Control view: stage files → write commit message → commit.  
Or use GitHub Desktop.

Push to GitHub  Push the branch (Push origin).  
This automatically triggers builds on Cloudflare (frontend) and Render.com (backend).

Check build & deployment status  On GitHub: Check commit status (green/red checks from Cloudflare and Render).  
Cloudflare Dashboard → Pages project for frontend builds and preview URLs.  
Render Dashboard → pwa-players-backend service for backend/database deployment logs.

Test the update  Use Cloudflare Preview URL for frontend changes.  
Test backend/database behavior during a golf round if possible (rounds in progress + completed rounds).  
Verify data is correctly saved and retrieved.

Merge to main (when fully tested and working)  Switch to main branch.  
Merge your feature branch into main.  
Push main if needed.

Final deployment  Pushing to main on both repositories automatically updates the live app.  
The live version (used 6-8 times per week during golf rounds) is now updated.

Quick RemindersUpdate the correct repository: frontend vs pwa-players-backend.  
Always use a feature branch for bigger changes to keep the live golf app stable.  
Check both Cloudflare and Render dashboards after pushing.  
Test thoroughly before merging to main since the app is used frequently during play.

