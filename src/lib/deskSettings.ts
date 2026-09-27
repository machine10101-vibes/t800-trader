import type { BotConfig } from "@/lib/types";

/**
 * A desk refresh must not put an unsaved slider back to the saved policy.
 * Once the draft matches the save, the form follows the book again.
 */
export function nextSettingsDraft(draft: BotConfig, saved: BotConfig, editing: boolean): BotConfig {
  return editing ? draft : saved;
}
