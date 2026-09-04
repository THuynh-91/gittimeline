/**
 * Canonical, provider-neutral data model.
 *
 * Everything that can influence a visible claim carries `Provenance`.
 * The raw graph (commits + edges) is immutable once a dataset is finalized;
 * threads, activity, layout and choreography are derived layers.
 */

export type Sha = string;
export type UnixMs = number;

export type Provenance = 'exact' | 'derived' | 'aggregate' | 'estimated' | 'unknown';

export const ENGINE = {
  modelSchemaVersion: 1,
  analyzerVersion: 3,
  layoutVersion: 4,
  choreographyVersion: 6,
} as const;

export interface RepositorySource {
  provider: 'github' | 'synthetic' | 'artifact';
  owner: string;
  name: string;
  canonicalUrl: string;
  apiUrl: string;
  defaultBranch: string | null;
  selectedRef: string | null;
  selectedTipSha: Sha | null;
  fetchedAt: string;
  description?: string | null;
  createdAt?: string | null;
  pushedAt?: string | null;
}

export interface CommitStats {
  additions: number;
  deletions: number;
  filesChanged: number;
}

export interface CommitNode {
  sha: Sha;
  /** Preserve Git parent order — first parent has integration semantics. */
  parentShas: Sha[];
  authorIdentityId: string;
  committerIdentityId: string | null;
  authoredAtRaw: string | null;
  committedAtRaw: string | null;
  /** Causally corrected presentation timestamp (child never before parent). */
  presentationTime: UnixMs;
  messageSubject: string;
  messageBodyAvailable: boolean;
  githubUrl: string | null;
  stats?: CommitStats;
  flags: {
    isMerge: boolean;
    /** At least one parent lies outside the fetched window. */
    isBoundary: boolean;
    isTimeCorrected: boolean;
    isBot: boolean;
  };
  provenance: Provenance;
}

export interface ParentEdge {
  parentSha: Sha;
  childSha: Sha;
  parentIndex: number;
  provenance: Provenance;
}

export interface RefRecord {
  id: string;
  kind: 'branch' | 'tag' | 'release' | 'other';
  name: string;
  targetSha: Sha;
  current: boolean;
  sourceUrl: string | null;
  provenance: Provenance;
}

export interface ContributorIdentity {
  id: string;
  githubLogin: string | null;
  displayName: string;
  githubNumericId: number | null;
  avatarUrl: string | null;
  /** sRGB hex, derived deterministically from the identity key. */
  color: string;
  /** Small accessible glyph name used as the performer shape. */
  glyph: ContributorGlyph;
  isBot: boolean;
  aliases: string[];
  provenance: Provenance;
  commitCount: number;
}

export type ContributorGlyph = 'orb' | 'diamond' | 'triangle' | 'square' | 'ring' | 'star' | 'hex' | 'cross';

export interface ThreadAssignment {
  id: string;
  /** Oldest → newest. */
  commitShas: Sha[];
  startSha: Sha;
  endSha: Sha;
  /** The commit this thread peels away from (its first commit's first parent) — null for roots/boundaries. */
  baseSha: Sha | null;
  /** The merge commit this thread converges into, when it does. */
  mergeSha: Sha | null;
  laneId: string;
  knownRefIds: string[];
  role: 'primary' | 'merged' | 'current' | 'auxiliary';
  provenance: Provenance;
}

export interface ActivityBucket {
  historicalStart: UnixMs;
  historicalEnd: UnixMs;
  knownCommitCount: number;
  activeThreadCount: number | null;
  contributorCount: number | null;
  mergeCount: number;
  tagCount: number;
  changeMagnitude: number | null;
  topologyNovelty: number;
  rawIntensity: number;
  phraseIntensity: number;
  eraIntensity: number;
  coverage: Provenance;
}

export interface AggregateSpan {
  id: string;
  memberShas: Sha[];
  memberCount: number;
  /** [entry commit, exit commit] — both remain exact, individually rendered nodes. */
  boundaryShas: Sha[];
  historicalStart: UnixMs | null;
  historicalEnd: UnixMs | null;
  level: number;
  expandable: boolean;
  contributorIds: string[];
  provenance: Provenance;
}

export interface Era {
  id: string;
  label: string;
  historicalStart: UnixMs;
  historicalEnd: UnixMs;
  performanceStart: number;
  performanceEnd: number;
  intensity: number;
  description: string;
}

export type ChoreographyEventType =
  | 'REPO_BIRTH'
  | 'MULTI_ROOT_REVEAL'
  | 'COMMIT_STEP'
  | 'COMMIT_CLUSTER'
  | 'QUIET_GAP'
  | 'DIVERGENCE'
  | 'THREAD_ACTIVATE'
  | 'PARALLEL_PHRASE'
  | 'CONTRIBUTOR_ENTER'
  | 'CONTRIBUTOR_HANDOFF'
  | 'MERGE_APPROACH'
  | 'MERGE_IMPACT'
  | 'MAJOR_MERGE'
  | 'OCTOPUS_MERGE'
  | 'MERGE_STORM'
  | 'THREAD_DORMANT'
  | 'UNMERGED_TIP'
  | 'TAG_LANDMARK'
  | 'ERA_TRANSITION'
  | 'AGGREGATE_SPAN'
  | 'UNKNOWN_SPAN'
  | 'REPO_PRESENT';

export interface ChoreographyEvent {
  id: string;
  type: ChoreographyEventType;
  historicalTime: UnixMs | null;
  performanceStart: number;
  performanceImpact: number;
  performanceEnd: number;
  /** SHAs, thread ids, contributor ids or aggregate ids involved. */
  subjectIds: string[];
  salience: number;
  beat: number;
  variant: string;
  effectBudget: number;
  provenance: Provenance;
  /** Short factual caption for the event stream / transcript. */
  caption: string;
}

export interface CameraCue {
  time: number;
  /** World-space frame center. */
  x: number;
  y: number;
  /** World extents the renderer must fit (it picks the limiting axis for the viewport). */
  w: number;
  h: number;
  /** Planar roll in radians, capped and disabled under reduced motion. */
  rotation: number;
  /** Extra zoom multiplier applied on top of the frame (push-in at impacts). */
  punch: number;
  reasonEventId: string | null;
  /** Director state label for diagnostics and the accessible stream. */
  state: CameraState;
}

export type CameraState =
  | 'intimate'
  | 'split'
  | 'ensemble'
  | 'overview'
  | 'convergence'
  | 'impact'
  | 'release'
  | 'tableau';

export interface Coverage {
  completeness: Provenance;
  knownRanges: Array<[UnixMs, UnixMs]>;
  warnings: string[];
  /** Human sentence such as "412 commits loaded; earlier history is not available." */
  summary: string;
  knownCommitCount: number;
  boundaryCount: number;
  /** Number of commits GitHub reports, when known (may exceed loaded count). */
  reportedCommitCount: number | null;
}

/** Normalized dataset — the input to compilation. */
export interface Dataset {
  schemaVersion: number;
  source: RepositorySource;
  coverage: Coverage;
  commits: CommitNode[];
  edges: ParentEdge[];
  refs: RefRecord[];
  contributors: ContributorIdentity[];
  contentHash: string;
}

export interface PlaybackPreset {
  id: string;
  version: number;
  /** Target performance duration in seconds, or 0 for "natural". */
  targetDuration: number;
  reducedMotion: boolean;
  /** Threshold above which linear runs are aggregated. */
  aggregateAbove: number;
}

export interface CompileOptions {
  preset: PlaybackPreset;
  seed: string;
}

/* ---------- Compiled performance (output of the compile worker) ---------- */

export type NodeKind = 'commit' | 'merge' | 'root' | 'boundary' | 'aggregate';

export interface NodeGeom {
  idx: number;
  sha: Sha;
  x: number;
  y: number;
  threadIdx: number;
  /** Performance time at which the node lands. */
  impact: number;
  /** Beat index the impact was quantized to. */
  beat: number;
  salience: number;
  kind: NodeKind;
  contributorIdx: number;
  isSpine: boolean;
  isMerge: boolean;
  parentCount: number;
  tagLabels: string[];
  refLabels: string[];
  aggregateIdx: number | null;
  provenance: Provenance;
}

export type EdgeKind = 'thread' | 'divergence' | 'merge' | 'secondary' | 'aggregate' | 'unknown';

export interface EdgeGeom {
  idx: number;
  parent: number;
  child: number;
  parentIndex: number;
  kind: EdgeKind;
  /** Flattened polyline [x0,y0,x1,y1,...] sampled at uniform arc length. */
  pts: Float32Array;
  length: number;
  threadIdx: number;
  /** Travel window of the body that reveals the edge. */
  start: number;
  end: number;
  /** Contributor carried along the edge (arriving commit's author). */
  contributorIdx: number;
  /** Departing contributor when this edge is a handoff, else -1. */
  fromContributorIdx: number;
  body: 'performer' | 'pulse';
  salience: number;
  provenance: Provenance;
}

export interface ThreadGeom {
  idx: number;
  id: string;
  role: ThreadAssignment['role'];
  lane: number;
  side: number;
  nodeIdxs: number[];
  label: string | null;
  start: number;
  end: number;
  /** How the thread finishes: merged into a node, a live ref tip, or dormant. */
  ending: 'merged' | 'tip' | 'dormant';
  mergeNodeIdx: number | null;
  baseNodeIdx: number | null;
  provenance: Provenance;
}

export interface Landmark {
  time: number;
  historicalTime: UnixMs;
  kind: 'birth' | 'divergence' | 'merge' | 'tag' | 'era' | 'present' | 'unknown';
  label: string;
  nodeIdx: number | null;
  eventId: string;
}

export interface CompiledPerformance {
  engine: typeof ENGINE;
  seed: string;
  preset: PlaybackPreset;
  duration: number;
  source: RepositorySource;
  coverage: Coverage;
  nodes: NodeGeom[];
  edges: EdgeGeom[];
  threads: ThreadGeom[];
  events: ChoreographyEvent[];
  camera: CameraCue[];
  /** Monotone map historical → performance. */
  timeMap: Array<[UnixMs, number]>;
  tempoMap: Array<[number, number]>;
  activity: ActivityBucket[];
  /** Intensity sampled uniformly in performance time (0..1) for the timeline waveform. */
  waveform: Float32Array;
  eras: Era[];
  contributors: ContributorIdentity[];
  aggregates: AggregateSpan[];
  refs: RefRecord[];
  landmarks: Landmark[];
  transcript: string[];
  /** Bounds of all geometry. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Hash of the structural output (layout + events + camera). */
  planHash: string;
  stats: {
    commits: number;
    merges: number;
    roots: number;
    boundaries: number;
    threads: number;
    contributors: number;
    maxConcurrentThreads: number;
    aggregatedCommits: number;
  };
}

export interface GitDanceArtifact {
  schemaVersion: number;
  format: 'gitdance';
  engine: typeof ENGINE;
  dataset: Dataset;
  options?: CompileOptions;
  contentHash: string;
}
