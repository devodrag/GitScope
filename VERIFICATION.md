# GitScope release verification

## Verified

| Check | Result |
| --- | --- |
| TypeScript strict check, ESLint and Vite production build | Passed |
| Vitest | 4 passed |
| Rust check and Clippy with warnings treated as errors | Passed |
| Rust unit and SQLx integration tests | 5 passed |
| Explicit live GitHub integration | Passed for filtered repository search, repository details, user and organization profiles, and a two-repository comparison |
| Browser UI integration using test-only IPC | Passed for light/dark, a 780×600 viewport, keyboard navigation, command palette, search filters, simulated connection errors, watchlist, collections, comparison, and Russian localization |
| Release build | Compiled against Ubuntu 22.04 libraries; x86-64 ELF requires glibc 2.34 |
| Native development runtime | Launched in X11 on EndeavourOS with WebKitGTK 2.52.6. Live dashboard, search, repository details and SQLite snapshots verified |

The offline test checks stale cached responses and request cancellation with
a failed connection. SQLite integration tests verify persistence across
reopening the database, rollback on invalid collection membership, release
notification baselines, and cache clearing.

## Previous release performance (0.1.0)

Measured on EndeavourOS under X11 with WebKitGTK 2.52.6. Measurements include
the GitScope, WebKit content and WebKit network processes. CPU is the
average percentage of one logical core over the sample.

| Scenario | Sample | PSS | RSS sum | CPU |
| --- | ---: | ---: | ---: | ---: |
| Development build, loaded overview | 5 s | 174.6 MiB | 272.1 MiB | 0.40% |
| Release build, loaded overview during startup | 5 s | 390.9 MiB | 637.8 MiB | 64.79% |
| Release build, loaded overview after settling | 10 s | 338.9 MiB | 584.4 MiB | 0.00% |
| Release build, repository overview after settling | 10 s | 358.4 MiB | 603.8 MiB | 0.00% |

PSS weights shared pages proportionally. RSS counts shared pages for each
process. The release overview exceeded the 100–200 MiB target at rest,
and the repository overview was slightly above 350 MiB in this run.
The startup sample overlapped GitHub data loading and was not a peak
memory measurement. Use `python3 scripts/profile-linux.py PID` to
repeat the measurement on another machine.

## Previous release packages (0.1.0)

| Format | Build result |
| --- | --- |
| `GitScope_0.1.0_amd64.deb` | Produced by Tauri; package metadata and payload checked |
| `GitScope-0.1.0-1.x86_64.rpm` | Produced by Tauri; payload checked |
| `GitScope_0.1.0_amd64.AppImage` | Produced from the Tauri AppDir with the official AppImage runtime, supplied to appimagetool locally because the container had no network |
| `gitscope` | Stand-alone executable with the embedded Vite production bundle |

On EndeavourOS under X11, the binaries extracted from the DEB and RPM
and the AppImage in extraction mode each opened a GitScope window and
fetched all five pages of public projects for the default GitHub organization.
The package-manager installation steps on Debian and Fedora, and FUSE
mount mode for the AppImage, were not exercised.

## Remaining verification

GitHub Device Flow requires a registered OAuth Client ID, real account
approval and a system keyring. Public browsing, error handling, and
persistence were tested; the signed-in OAuth exchange and contribution
calendar await a real account. Wayland-specific behavior was not tested.

## Native X11 checks

The demo ran in a dedicated test directory. The application restored a
900×640 window at its saved X11 coordinates (180, 195). F11 entered and
left fullscreen. Ctrl+K opened a real repository and saving it initialized
its release baseline in SQLite. No GitHub account was connected.

## GitScope 0.1.1 changes

- Cached dashboard data stays visible during background refresh.
- Activity charts reuse geometry and update the pointer overlay once per
  animation frame. Bar series are drawn as a single SVG path.
- Metric values, chart data, page content, tabs and dialogs have bounded
  entrance animations. The chart animation and reduced-motion handling were
  exercised by the UI integration test.
- The standalone installer supplies an icon, a user-local menu entry and a
  lightweight WebKit launcher. The install script was tested with an isolated
  XDG data directory.
- Repository commit history and chart counts use one IPC request.

The 0.1.1 standalone build was started on EndeavourOS and loaded the public
dashboard and ripgrep from GitHub. The 0.1.1 AppImage started in extraction
mode and fetched all five dashboard pages. The DEB and RPM were rebuilt
and their metadata or payload was inspected.

| 0.1.1 on EndeavourOS/X11 with the lightweight launcher | PSS | RSS sum | CPU, one core |
| --- | ---: | ---: | ---: |
| Overview, 10 s at rest | 320.8 MiB | 554.6 MiB | 0.00% |
| Repository, 10 s at rest | 344.0 MiB | 578.5 MiB | 0.10% |

## GitScope 0.1.2

A WebKitGTK 4.1 test window on EndeavourOS/X11 and AMD Radeon Renoir ran
the production frontend builds with identical local fixtures. The test
scrolled 20 repository cards and rotated between Overview, Explore and
Settings. Intervals use browser animation-frame timestamps, with an
active desktop session. They do not measure physical display refresh.

| Build and renderer | Median scroll frame interval | Scroll p95 | Navigation frame p95 |
| --- | ---: | ---: | ---: |
| 0.1.1, installed software mode | 164 ms | 176 ms | 183 ms |
| 0.1.1, default renderer, comparison run | 19 ms | 50 ms | 57 ms |
| 0.1.2, default renderer, comparison run | 18 ms | 27 ms | 43 ms |

The installed launcher no longer overrides WebKit compositing. It was
started through the Linux applications menu and inspected in the native
window. Samples of the active application's process tree were 341.3 and
393.3 MiB PSS (32.26% and 56.19% of one CPU core). User navigation and
background requests overlapped these samples, so they are not idle
measurements.

TypeScript, ESLint, production frontend, four frontend unit tests, Rust
unit and SQLite integration tests, Clippy and the browser integration
suite passed. The UI suite exercised cached and uncached profiles during
a limit, reset time, quota display and the masked token dialog. The live
guest GitHub test passed repository search, profile lookup and
repository details. Authenticated requests and persistent token storage
require a real user token and an initialized system keyring.

Tauri produced the standalone executable, DEB and RPM. The AppImage
uses the existing WebKitGTK AppDir, rebuilt with the 0.1.2 binary. The
DEB version and RPM payload were inspected and the AppImage opened a
native window on EndeavourOS in extraction mode.
