// Process exit codes shared by every sim cli subcommand.
export const CLI_EXIT_SUCCESS = 0 as const
/** Bad invocation or unusable input: unknown flag, missing/unreadable file, invalid topology. */
export const CLI_EXIT_USAGE_ERROR = 1 as const
/** The command ran but its check did not pass (grading failed, lint found a critical issue). */
export const CLI_EXIT_EVALUATION_FAILED = 2 as const
/** Alias of {@link CLI_EXIT_EVALUATION_FAILED} for non-grading checks (lint, validate). */
export const CLI_EXIT_CHECK_FAILED = CLI_EXIT_EVALUATION_FAILED
export const CLI_EXIT_INVALID_SUBMISSION = 3 as const
export const CLI_EXIT_EVALUATION_ERROR = 4 as const
