# Project icons

Every project row, conversation row, and chat header shows a small icon for the project it belongs
to. aqqua picks one in this order:

1. **The avatar you chose.** Set per project, it wins over everything else.
2. **A favicon found in the workspace.** aqqua looks in the well-known places (`favicon.svg`,
   `public/favicon.ico`, `app/icon.png`, and friends), follows a `<link rel="icon">` in `index.html`
   or a root route, and honors an explicit `iconPath` in `aqqua.json`.
3. **A folder glyph**, when neither of the above turns anything up.

Step 2 is what most web projects want and needs no setup. Projects that have no favicon to find —
an API, a CLI, a library, a plain data directory — land on the folder glyph and are hard to tell
apart in a long sidebar. That is what avatars are for.

## Choosing an avatar

When you add a project, aqqua asks you to confirm its automatic icon or choose an avatar before it
creates the project. For an existing project, right-click it in the web or desktop sidebar and open
**Project settings**, or open **Settings → Project Icons** on mobile. The picker offers up to
twelve gradients plus an initials field:

- **Gradients** are generated, not stored as images. Each swatch is seeded from the project's
  workspace path, so two projects with the same name still get different artwork, and the same
  project always looks the same on every device you open it from.
- **Initials** default to the project's initials and accept up to three characters. Clear the field
  for a plain gradient.
- **Use project favicon** clears the avatar and puts the project back on favicon discovery.

A grouped project — one repository checked out in several places, or reachable through several
environments — gets one icon per entry, so you can give a worktree or a remote checkout its own
colour if that helps you tell them apart.

The artwork matches [vercel/avatar](https://github.com/vercel/avatar), but aqqua generates it
locally. Nothing is requested from a third party, no project name leaves your machine, and avatars
render offline, over relay, and on mobile.

## Mobile

Mobile renders, chooses, and clears the same project avatars as web and desktop. Changes travel in
the environment's project read model, so every connected client sees the same icon without storing
an image or making an extra asset request.
