# Running aqqua in the Background

On a Linux host, aqqua can run as a background service for your user. It starts when the machine
boots and keeps running after you log out.

## Manage the Service

Install it with the latest aqqua release:

```sh
npx aqqua@latest service install
```

Check whether it is installed:

```sh
npx aqqua@latest service status
```

Update or repair it:

```sh
npx aqqua@latest service update
```

Stop it and remove it from startup:

```sh
npx aqqua@latest service uninstall
```

Updating restarts aqqua briefly. Let active agent work and terminal commands finish first.

## Using It with aqqua Connect

aqqua Connect may offer to install the service during setup so the host stays reachable after you log
out. This is only an onboarding shortcut: the service and aqqua Connect are managed separately.

Signing out of aqqua Connect does not remove the service. Use `aqqua service uninstall` when you no longer
want aqqua to start in the background.

The background service currently requires Linux with systemd.
