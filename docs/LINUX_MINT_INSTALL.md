# Install Switchbay on Linux Mint

Switchbay includes a full Linux Mint installer at `scripts/install-linux-mint.sh`. It installs the CLI, reusable TypeScript client build, authenticated local API, and an automatically restarting systemd user service.

## Quick install

On the Linux Mint machine:

```bash
curl -fsSL https://raw.githubusercontent.com/genoventures-labs/Switchbay/main/scripts/install-linux-mint.sh \
  -o /tmp/install-switchbay.sh
chmod +x /tmp/install-switchbay.sh
OPENAI_API_KEY="your-key" /tmp/install-switchbay.sh
```

You may export `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, or local-provider configuration instead. Existing values in `~/.switchbay/service.env` are preserved when the installer is rerun.

The installer will ask for `sudo` only to install Linux packages through `apt`. Switchbay itself, its API token, source checkout, and systemd service are installed for the current user.

## Installed layout

```text
~/.local/bin/switchbay                  CLI link
~/.local/share/switchbay/source/        Git checkout
~/.switchbay/service/index.js           API service bundle
~/.switchbay/api-token                  Private bearer token
~/.switchbay/service.env                Provider credentials
~/.config/systemd/user/switchbay-api.service
```

The API listens only on `127.0.0.1:7349` by default.

## Service commands

```bash
systemctl --user status switchbay-api
systemctl --user restart switchbay-api
systemctl --user stop switchbay-api
journalctl --user -u switchbay-api -f
```

The service starts with the user's systemd session. To keep user services running after logout on a headless box, enable lingering once:

```bash
sudo loginctl enable-linger "$USER"
```

## Updating

Run the installer again. It fast-forwards the checkout, rebuilds Switchbay, preserves the token and provider environment, and restarts the service.

## Connect another local app

Read the token from `~/.switchbay/api-token` and use the reusable client described in [API_INTEGRATION.md](API_INTEGRATION.md):

```ts
import { Switchbay } from "@genoventures/switchbay";

const bay = new Switchbay({
  token: (await Bun.file(`${process.env.HOME}/.switchbay/api-token`).text()).trim(),
  clientId: "my-linux-app",
  workspace: "/absolute/path/to/project",
});
```
