# Branch activity overview

Implemented locally on 2026-09-08. Not published.

Open a history and choose **All branches** beside the playback controls. The activity overview represents every side thread with work in progress at the playhead, across the complete compiled history. MAIN has a separate prominent reference line. Desktop shows individual activity lines up to 1,024; smaller or exceptionally crowded views use labeled groups whose membership sums to the same total.

This is an activity view, not a replacement drawing of the Git graph. The lines are deliberately not connected into invented merge paths. Their markers show progress through each thread's activity interval. Use **Choose a branch**, or click a line/group, then **Trace branch** to load its detailed graph, highlight that thread, and open its commit inspector. Selecting pauses playback so the choices do not move away while being inspected.

The count means threads with visible commits whose compiled activity interval contains the playhead. It excludes MAIN and fully collapsed threads with no visible nodes. A dormant thread stops being active after its last work; this differs from “unmerged,” which can remain true indefinitely. Unknown or omitted source history is not invented. The ordinary streamed graph counter now says “At least” because its resident threads cannot establish the total for the complete history.

## Data and performance

`scripts/package-catalog.mjs` derives the full activity index before splitting geometry into pages. The index is stored as a separate gzip payload with a content-addressed `.overview.bin` filename, byte length, and SHA-256 in the manifest. `scripts/catalog-release.mjs` includes and verifies it in a release. Existing packages remain compatible and do not advertise the overview if they do not contain this data.

The browser downloads the index only when the overview is opened. It verifies compressed size and hash, bounds decoded size, and validates the records before showing counts. Geometry window changes cannot change this count. While the activity view is open, the hidden graph renderer does not draw underneath it; its playback and streaming lifecycle continue. The overview uses a canvas with a capped backing resolution and a time interval index instead of thousands of DOM elements.

Local Kubernetes and Linux packages were prepared from their existing matching full plans, retaining their geometry. The activity index does not require changing lane assignment or recompiling the layout. The workspace's separate 240-lane/4-pixel graph experiment predates this implementation and is not evidence that published geometry has been regenerated.

## Validation

- Kubernetes: 284 active side branches at performance time 6,814.0392 seconds.
- Linux: 600 active side branches at performance time 21,213.8237 seconds; MAIN is represented separately.
- Browser checks compare overview totals against an independent sweep of every interval in the packaged index, resize to phone groups without losing members, and trace a selected branch back into the graph.
- Unit checks cover 601 simultaneous synthetic branches, grouping conservation, backward seeks, nested intervals, complete versus resident scope, and corrupt activity downloads.
- Release tests verify that the optional payload is included and that corruption is rejected.
- Tests use the shared native-media mute fixture. Measured browser frame rates describe this machine, not physical iOS or Android performance.

The diagnostic screenshots are saved locally in `x/overview-validation/`. The large-repository browser cases require prepared local packages and explicitly skip when these are absent; the fixture interaction checks run without them. The optional activity indexes currently weigh 870,167 bytes for Kubernetes and 1,694,688 bytes for Linux. Ordinary playback does not fetch them.

## Remaining release work

Publish new catalog packages together with the app to make the overview available on the hosted shelf. The weekly packaging workflow will generate the optional index using the updated packaging script; this implementation does not publish or change the agreed weekly cadence. Physical-device validation and further visual refinement remain separate from the verified count and selection behavior.
