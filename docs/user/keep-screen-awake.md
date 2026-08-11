# Keep the screen awake while agents run

In the desktop app, enable **Settings → General → Keep screen awake** to prevent the computer and
display from sleeping while an eligible agent session is starting or running.

The desktop app watches agents hosted by that desktop, including local secondary backends such as
WSL. Agents reached through saved remote, SSH, or relay environments do not keep the desktop awake.
Provider-native child activity remains owned by its parent thread instead of creating another sleep
blocker request.

The blocker is released when the final local agent stops, its environment disconnects, the setting
is disabled, or the desktop app quits. During a renderer reload or window replacement, the main
process retains an active request while the new renderer restores its settings and environment
state. If no renderer reports authoritative state, the orphaned request expires after two hours.

Closing a laptop lid still follows the operating system's power settings. The preference is off by
default and is stored locally for the desktop client.
