# Reviews

Adversarial reviews, copied here from the scratch directory so the proposals
and status notes that cite them do not have dangling references. Each was
written by a reviewer told to break a specific claim and to show its working;
each states its own provenance — the commit, the build, the served bundle — and
each has a section for measurements it took and then distrusted.

They are kept verbatim, including the parts that turned out to be wrong, because
several of the wrong measurements were wrong in an instructive way and the
retractions are the most useful paragraphs in the set.

| file | what it attacked | headline |
|---|---|---|
| `main-as-axis.md` | "Make the main line the timeline" — and the argument against it | Keep the clock, but the honesty argument defending it is self-refuting: 49.5% of Linux's commits already have their stamp moved to respect ancestry |
| `time-ticks.md` | A background calendar axis behind the stage | Reject — built to specification, it changed never more than two pixel columns on a 1600px stage, and drew nothing at all on CPython |
| `closing-shot.md` | The closing tableau's framing, across twelve entries at four viewport shapes | Caught two successive wrong fixes, one of which made coverage worse — 11.6% down to 1.89% |
| `todays-work.md` | A day's commits, immediately after they landed | Four defects in work committed hours earlier, including a readout contradicting the app's own statistic inside its own tooltip |
