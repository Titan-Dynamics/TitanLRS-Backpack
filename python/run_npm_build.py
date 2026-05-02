import subprocess, os, sys
Import("env")

# Only run when explicitly requested (set BUILD_WEB=1 to trigger).
# This avoids the ~30s npm rebuild on every C++ compile cycle.
if os.environ.get("BUILD_WEB"):
    html_dir = os.path.join(env["PROJECT_DIR"], "html")
    if os.path.isdir(html_dir):
        print("Running npm run build:all ...")
        result = subprocess.run(
            ["npm", "run", "build:all"],
            cwd=html_dir,
            shell=(sys.platform == "win32"),
        )
        if result.returncode != 0:
            sys.exit(result.returncode)
