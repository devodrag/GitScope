# GitScope roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Linux environment, references, Tauri, React, architecture | Implemented and checked |
| 2 | Desktop shell, design system, themes and components | Checked in WebKitGTK and UI suite |
| 3 | SQLite migrations, GitHub REST/GraphQL, cache, device OAuth | Public data and storage checked; OAuth exchange requires a real account |
| 4 | Overview, Explore, repositories, developers, organizations | Checked with live GitHub |
| 5 | Compare, Trending, Watchlist, Collections, Activity | Implemented; comparison, persistence and notifications tested |
| 6 | Desktop integration, localization, accessibility, visual review | X11, keyboard UI, light/dark and narrow layout checked |
| 7 | Performance measurements and tuning | PSS, RSS and CPU sampled |
| 8 | Rust, frontend and native integration checks | Passed checks in VERIFICATION.md |
| 9 | Linux bundles and installation documentation | Ubuntu-based x86-64 release, DEB, RPM and AppImage produced |

## Design references

- Skillset supplies the four-card KPI row, gray canvas and white rail, tight
  repository rows and asymmetric analytics grid. Its rounded chart bars
  use contrast to highlight the selected period.
- Web Design supplies the black active navigation pill, inset surfaces,
  larger radii, floating controls, and a single high-contrast feature panel.
  The 3D scene outside the product frame is omitted.
- Pay supplies the inset chart surface, lightweight icon rail, restrained
  graph annotations, generous horizontal spacing, and broad white gutter.

GitScope uses a 224 px light rail with a 72 px compact mode, filter pills,
a 24 px card radius, a warm-gray canvas, and one strongly contrasted KPI.
The analytics row places a wide activity chart next to a language panel.
The lower row pairs a compact repository table with a public event timeline.
