export type Paper = {
  id: string;
  seq: number;
  track: string;
  number: number;
  title: string;
  abstract: string;
  authors: string[];
  emails: string[];
  forum: string | null;
  pdf_path: string | null;
};

export type Collection = {
  id: number;
  name: string;
  is_default: number;
  created_at: string;
};

/** A collection plus the counts the UI needs to size a batch against it. */
export type CollectionSummary = Collection & {
  total: number;
  contacted: number;
  /** Rows that came from a scraped paper — 0 for a hand-built list. */
  paper_backed: number;
  /** Eligible right now: primary address per paper / every address. */
  pending: number;
  pending_all: number;
  /** The same two, ignoring who has already been emailed (for a re-send). */
  resendable: number;
  resendable_all: number;
};

export type Recipient = {
  id: number;
  collection_id: number;
  paper_id: string | null;
  email: string;
  name: string;
  notes: string;
  position: number;
  seq: number;
  source: "import" | "manual";
  created_at: string;
};

export type PromptConfig = {
  id: number;
  name: string;
  is_active: number;
  model: string;
  reasoning: number;
  system_prompt: string;
  user_prompt: string;
  /** 0 = omit the system message from the model call. */
  use_system_prompt: number;
  /** 0 = skip the model entirely and send the template as written. */
  use_user_prompt: number;
  /** Stored filename in UPLOADS_DIR, '' when no image is set. */
  image_file: string;
  image_mime: string;
  /** The name the file was uploaded under — display only. */
  image_name: string;
  template: string;
  product_url: string;
  demo_url: string;
  /* Conference details, fixed per configuration and rendered verbatim. */
  conference_name: string;
  conference_website: string;
  conference_dates: string;
  conference_location: string;
  submission_deadline: string;
  notification_date: string;
  camera_ready_deadline: string;
  conference_topics: string;
  keynote_speakers: string;
  organizers: string;
  sender_name: string;
  sender_affiliation: string;
  sender_role: string;
  created_at: string;
  updated_at: string;
};

export type CampaignStatus =
  | "draft"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

export type Campaign = {
  id: number;
  name: string;
  prompt_config_id: number | null;
  schedule_id: number | null;
  collection_id: number | null;
  target_count: number;
  send_delay_ms: number;
  send_to_all: number;
  dry_run: number;
  /** 1 = include addresses that already received a successful send. */
  allow_resend: number;
  test_recipient: string;
  track_filter: string;
  status: CampaignStatus;
  sent: number;
  failed: number;
  skipped: number;
  error: string | null;
  /** Set when the breaker paused this batch; the scheduler resumes it after. */
  cooldown_until: string | null;
  /** How many cooldowns so far. At MAX_COOLDOWNS the batch gives up. */
  cooldown_count: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Send = {
  id: number;
  campaign_id: number | null;
  paper_id: string | null;
  email: string;
  subject: string;
  topic: string;
  queries: string;
  body: string;
  status: "sent" | "failed" | "dry";
  error: string | null;
  source: "app" | "import";
  /** Per-send token carried by the pixel and rewritten links. */
  track_id: string | null;
  created_at: string;
};

export type Schedule = {
  id: number;
  name: string;
  prompt_config_id: number | null;
  collection_id: number | null;
  batch_size: number;
  total_cap: number;
  sent_total: number;
  interval_minutes: number;
  days_of_week: string;
  window_start: string;
  window_end: string;
  send_delay_ms: number;
  dry_run: number;
  allow_resend: number;
  enabled: number;
  next_run_at: string | null;
  last_run_at: string | null;
  created_at: string;
};

/**
 * One address the runner is about to process. Everything from `paper_id` down
 * is null for a hand-added contact, which has `name` / `notes` instead.
 */
export type QueueItem = {
  recipient_id: number;
  email: string;
  name: string;
  notes: string;
  paper_id: string | null;
  title: string | null;
  abstract: string | null;
  authors: string | null;
  track: string | null;
};
