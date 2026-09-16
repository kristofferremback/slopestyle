---
name: slopshare
description: Use when a task needs a secret, API key, token, password, or other credential from Kris written to a file on this machine.
---

# Slopshare

`slopshare` gets a secret from Kris into a file on the machine that runs the CLI. Kris pastes the value on any tailnet device, his browser encrypts it to a key only this machine holds, and `slopshare wait` writes the plaintext with mode 0600. The value never passes through the conversation.

Source and security model: <https://github.com/kristofferremback/slopshare>.

## Get a secret

1. **Choose the destination.** Pick the absolute path the consuming program reads. The file lands on this machine, and delivery replaces an existing file at that path.
2. **Create a slot.**

   ```bash
   slopshare create --name "Threa OpenRouter key" --path "$HOME/.config/threa/openrouter-key"
   ```

   `--name` is the heading Kris sees above the paste box, so name the secret the way he knows it. `--ttl SECONDS` (60 to 86400, default 900) sets how long the link stays open. The command prints `link:`, `id:`, `expires:` and the `wait` command.
3. **Send Kris the link** in a normal message, with one line saying what to paste. The link is safe in chat: the key sits in the `#fragment`, only Kris's Tailscale login opens the page, and a slot accepts one value.
4. **Wait for delivery** with `slopshare wait <id>`. It blocks until Kris sends, so run it in the background or with a timeout past the link's expiry. On success it prints `wrote PATH (N bytes)`, and Kris's page flips to Delivered. `wait` runs only on the machine that ran `create`, because the slot's private key lives in `~/.local/state/slopshare/keys/`.
5. **Use the file.** Point the consumer at the path or `cat` it into the command that needs it. Keep the value out of messages, logs, and commits unless Kris asks to see it. The page trims whitespace at both ends before sending.

Done means `wait` printed `wrote PATH` and the consumer reads the file.

## Failures

- `slot is expired`: Kris didn't send in time. Create a new slot and send the new link.
- `slot is delivered`: another `wait` already wrote the file. Check the path.
- `no key for slot`: the slot came from another machine or its key file is gone. Create a new slot here.
- `the value could not be decrypted`: nothing was written. The server showed Kris a different slot than this CLI created. Stop and report it to Kris rather than retrying.
- `HTTP 403 not allowed`: this machine is outside the server's node allowlist. Report it; the allowlist is Kris's decision.
- `set SLOPSHARE_URL or write the agent API URL`, or `slopshare: command not found`: this machine isn't set up. Setup is below.

## Set up a machine

The server runs on homelab. A client machine needs Bun, Tailscale, and the CLI:

```bash
git clone https://github.com/kristofferremback/slopshare.git ~/dev/slopshare
cd ~/dev/slopshare && bun install
ln -s ~/dev/slopshare/cli.ts ~/.local/bin/slopshare
suffix=$(tailscale status --json | jq -r .MagicDNSSuffix)
mkdir -p ~/.config/slopshare && echo "http://homelab.$suffix:20161" > ~/.config/slopshare/url
```

The machine's Tailscale node name must also be in `SLOPSHARE_ALLOWED_NODES` in homelab's `~/.config/slopshare/server.env`. Ask Kris before changing that allowlist.
