# Interrupted Firefox lifecycle079

Report application-5b32576c-51f2-47f3-86d2-899509667301.json records
HARNESS_SAMPLING_GAP,562560ms elapsed,1740304KiB peak, successful cleanup.
The last sample was68602ms after20:39:37UTC startup. macOS power-management
log records Clamshell Sleep at21:40:45BST (20:40:45UTC), lasting495seconds,
then DarkWake at21:49:00BST, matching report completion. No browser launched.
This is a host suspension, not an application or Firefox proof failure.

Keep the sampling-gap rejection and540second deadline unchanged. One new run
on the now-awake host uses /usr/bin/caffeinate -i for command lifetime only;
this prevents idle sleep, not lid closure or deliberate system sleep. No retry
loop or deadline extension is introduced.
