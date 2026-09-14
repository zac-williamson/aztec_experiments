# Infrastructure installation deadline assessment

No additional run or deadline change has been made. The serial retry failure and cleanup evidence are final and preserved.

The 300-second root npm installation deadline is an infrastructure supervision budget, not a product requirement or test assertion. Extending it in a new, separately recorded run would not turn the failed attempt into a pass or weaken application acceptance. All actual package locks, disabled install scripts, source guards, test assertions and test/suite deadlines must remain unchanged.

## Observations

- The earlier P02 Linux log reported `added 1000 packages in 37s`; it used the older dependency baseline and is context, not a timing promise for P04.
- The earlier P04 Linux log reported `added 1000 packages in 2m` for the current dependency baseline. npm rounded that duration; the raw log does not establish an exact number of seconds. That run later stalled during SDK assembly.
- The current isolated retry started root npm installation at `2026-09-12T08:49:40.396448+00:00`. It had a 300-second deadline and recorded timeout completion at `08:56:08.921568+00:00`, with measured duration 388.49 seconds. Its log has seven package deprecation notices, no successful install summary and no reported fatal package error.
- An intermediate log read contained five deprecation notices; the recovered final log contained seven. This shows some additional log activity, but does not identify how much download, unpacking or linking completed or prove continuous progress. No npm timing file or live package-count measurement was captured. Do not infer npm was nearly finished.
- The fresh Foundry download/check/extract/version stage completed in 31.06 seconds. Network throughput for that separate GitHub asset does not establish npm registry health.
- Host pressure, reduced CPU/memory quotas and delayed deadline servicing were observed. Their individual contributions are not isolated. `OOMKilled=false` is not evidence that there was no memory pressure. The stats request raced with container exit and returned zero usage, so it does not describe peak resource use.

## Proposed next experiment, not applied

Keep the same empty-cache, no-host-mount source copy and resource cap. Increase **only the root npm infrastructure stage budget from 300 to 900 seconds**, and the outer attached-run ceiling from 1,800 to **2,400 seconds** to make room for that additional 600 seconds. Leave the portal install budget at 180 seconds, compiler bootstrap at 240 seconds, full build at 900 seconds, and every existing test/suite/assertion deadline unchanged. The outer ceiling may still cut off later work if every stage consumes its maximum; any such stage is incomplete, not waived.

Add npm's timing diagnostics for the new install, with timestamped log capture and retained installation timing files before cleanup. Record that diagnostic-only argument change. Use bounded read-only progress observations to distinguish registry fetches from extraction/linking activity where the diagnostics permit. If the 900-second infrastructure stage still fails, preserve the cause and halt; do not repeatedly extend it automatically.

The outer host supervisor provides a second deadline, but neither host nor container timers guarantee prompt enforcement when the operating system/runtime cannot schedule or reap processes. Preserve actual elapsed time and cleanup results separately from configured limits. Run only after the parent completes its instrumented browser check and explicitly releases the serial execution gate.
