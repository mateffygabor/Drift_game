# Security Policy

## Supported versions

Only the latest code on the `main` branch is supported. Fixes are not
backported to older commits.

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report them privately through GitHub instead: open the repository's
**Security** tab and click **Report a vulnerability**. Include the steps to
reproduce the problem and which part it affects (browser game, ESP32 firmware
or tools).

You should get a reply within a week. Once the issue is confirmed and fixed,
you are welcome to disclose it publicly.

## Scope and known limitations

- The game is a static web page with no server-side code and no accounts.
  Settings, lap times and ghosts are stored only in the player's own browser
  (`localStorage`), so they can be edited by that player. This is expected.
- The ESP32 WiFi firmware runs a WebSocket server without authentication.
  Anyone on the controller's network can read the button stream; incoming
  messages are ignored. Use a strong password in `secrets.h` (see
  [docs/CONTROLLER_BUILD.md](docs/CONTROLLER_BUILD.md)).
- WiFi names and passwords belong in the git-ignored `secrets.h` files.
  Never commit real credentials.
