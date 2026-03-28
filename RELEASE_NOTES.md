# v0.6.6

## Fixes

- **Template browser no longer blocks last items** — The description preview at the bottom of the template picker no longer pushes items out of view when scrolling down.
- **Plugin panels now open correctly when only one plugin is installed** — Clicking a plugin's sidebar button had no effect if it was the only plugin; this is now fixed.
- **Removed automatic session color lines** — Sessions no longer show an auto-assigned colored border based on the git branch name. Only user-chosen colors are displayed.

## Improved

- **Importing duplicate templates is now silently skipped** — Re-importing a template bundle that contains templates matching existing or built-in names will skip them without creating duplicates.
